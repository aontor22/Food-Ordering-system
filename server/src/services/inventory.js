import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { parseOrderItemCustomizations } from './product-customizations.js';

const RETRYABLE_TRANSACTION_CODES = new Set(['P2034']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withSerializableRetry(work, { retries = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_TRANSACTION_CODES.has(error?.code) || attempt >= retries) throw error;
      await sleep(20 * (attempt + 1));
    }
  }
  throw lastError;
}

function inventoryAdjustmentData({
  targetType,
  quantityDelta,
  balanceAfter,
  reason,
  note = null,
  sourceType,
  sourceId = null,
  actorId = null,
  actorLabel = null,
  productId,
  optionId = null,
}) {
  return {
    targetType,
    quantityDelta,
    balanceAfter,
    reason,
    note,
    sourceType,
    sourceId,
    actorId,
    actorLabel,
    productId,
    optionId,
  };
}

export async function reserveInventory(tx, pricing, { sourceId }) {
  const adjustments = [];

  for (const [productId, quantity] of [...pricing.quantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const product = pricing.productMap.get(productId);
    const result = await tx.product.updateMany({
      where: {
        id: productId,
        isAvailable: true,
        inventoryVersion: product.inventoryVersion,
        stock: { gte: quantity },
      },
      data: {
        stock: { decrement: quantity },
        inventoryVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new AppError(409, 'STOCK_CHANGED', `${product.name} stock changed while placing the order. Please review your cart and try again.`);
    }
    const current = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
    adjustments.push(inventoryAdjustmentData({
      targetType: 'PRODUCT', quantityDelta: -quantity, balanceAfter: current.stock,
      reason: 'ORDER_RESERVED', sourceType: 'ORDER', sourceId, productId,
    }));
  }

  for (const usage of [...pricing.optionUsages.values()].sort((left, right) => left.option.id.localeCompare(right.option.id))) {
    if (!usage.option.trackStock) continue;
    const result = await tx.productOption.updateMany({
      where: {
        id: usage.option.id,
        groupId: usage.groupId,
        isArchived: false,
        isAvailable: true,
        trackStock: true,
        inventoryVersion: usage.option.inventoryVersion,
        stock: { gte: usage.quantity },
      },
      data: {
        stock: { decrement: usage.quantity },
        inventoryVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new AppError(409, 'OPTION_STOCK_CHANGED', `${usage.productName} · ${usage.option.name} stock changed while placing the order. Please review your cart and try again.`);
    }
    const current = await tx.productOption.findUnique({ where: { id: usage.option.id }, select: { stock: true } });
    adjustments.push(inventoryAdjustmentData({
      targetType: 'OPTION', quantityDelta: -usage.quantity, balanceAfter: current.stock,
      reason: 'ORDER_RESERVED', sourceType: 'ORDER', sourceId, productId: usage.productId, optionId: usage.option.id,
    }));
  }

  if (adjustments.length) await tx.inventoryAdjustment.createMany({ data: adjustments });
}

export async function restoreOrderInventory(tx, order, { sourceId = order.orderNumber, reason = 'ORDER_CANCELLED', actorId = null, actorLabel = null } = {}) {
  const productQuantities = new Map();
  const optionQuantities = new Map();

  for (const item of order.items || []) {
    productQuantities.set(item.productId, (productQuantities.get(item.productId) || 0) + item.quantity);
    for (const group of parseOrderItemCustomizations(item.customizationsJson)) {
      for (const option of group.options || []) {
        if (option.trackStock !== true || !option.optionId) continue;
        const current = optionQuantities.get(option.optionId) || { quantity: 0, productId: item.productId, name: option.name || 'Option' };
        current.quantity += item.quantity;
        optionQuantities.set(option.optionId, current);
      }
    }
  }

  const adjustments = [];
  for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity }, inventoryVersion: { increment: 1 } },
      select: { stock: true },
    });
    adjustments.push(inventoryAdjustmentData({
      targetType: 'PRODUCT', quantityDelta: quantity, balanceAfter: updated.stock,
      reason, sourceType: 'CANCELLATION', sourceId, actorId, actorLabel, productId,
    }));
  }

  for (const [optionId, usage] of [...optionQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const option = await tx.productOption.findUnique({
      where: { id: optionId },
      select: { id: true, group: { select: { productId: true } } },
    });
    if (!option || option.group.productId !== usage.productId) continue;
    const updated = await tx.productOption.update({
      where: { id: optionId },
      data: { stock: { increment: usage.quantity }, inventoryVersion: { increment: 1 } },
      select: { stock: true },
    });
    adjustments.push(inventoryAdjustmentData({
      targetType: 'OPTION', quantityDelta: usage.quantity, balanceAfter: updated.stock,
      reason, sourceType: 'CANCELLATION', sourceId, actorId, actorLabel,
      productId: usage.productId, optionId,
    }));
  }

  if (adjustments.length) await tx.inventoryAdjustment.createMany({ data: adjustments });
  return { restoredProducts: productQuantities.size, restoredOptions: optionQuantities.size };
}

export async function setInventoryLevel(tx, {
  targetType,
  productId,
  optionId = null,
  expectedVersion,
  newStock,
  reason,
  note = null,
  actorId = null,
  actorLabel = null,
}) {
  if (targetType === 'PRODUCT') {
    const current = await tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, stock: true, inventoryVersion: true } });
    if (!current) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const updated = await tx.product.updateMany({
      where: { id: current.id, inventoryVersion: expectedVersion },
      data: { stock: newStock, inventoryVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new AppError(409, 'INVENTORY_CHANGED', 'Inventory changed in another session. Refresh before applying this adjustment.');
    const target = await tx.product.findUnique({ where: { id: current.id }, select: { id: true, name: true, stock: true, inventoryVersion: true, lowStockThreshold: true } });
    const adjustment = await tx.inventoryAdjustment.create({ data: inventoryAdjustmentData({
      targetType: 'PRODUCT', quantityDelta: newStock - current.stock, balanceAfter: newStock,
      reason, note, sourceType: 'ADMIN', actorId, actorLabel, productId: current.id,
    }) });
    return { target, adjustment };
  }

  const current = await tx.productOption.findUnique({
    where: { id: optionId },
    select: {
      id: true, name: true, stock: true, trackStock: true, inventoryVersion: true, lowStockThreshold: true,
      group: { select: { productId: true, name: true, product: { select: { name: true } } } },
    },
  });
  if (!current || current.group.productId !== productId) throw new AppError(404, 'OPTION_NOT_FOUND', 'Product option not found');
  if (!current.trackStock) throw new AppError(409, 'OPTION_STOCK_NOT_TRACKED', 'Enable stock tracking for this option before adjusting its inventory.');
  const updated = await tx.productOption.updateMany({
    where: { id: current.id, inventoryVersion: expectedVersion, trackStock: true },
    data: { stock: newStock, inventoryVersion: { increment: 1 } },
  });
  if (updated.count !== 1) throw new AppError(409, 'INVENTORY_CHANGED', 'Inventory changed in another session. Refresh before applying this adjustment.');
  const target = await tx.productOption.findUnique({ where: { id: current.id }, select: { id: true, name: true, stock: true, inventoryVersion: true, lowStockThreshold: true, trackStock: true } });
  const adjustment = await tx.inventoryAdjustment.create({ data: inventoryAdjustmentData({
    targetType: 'OPTION', quantityDelta: newStock - current.stock, balanceAfter: newStock,
    reason, note, sourceType: 'ADMIN', actorId, actorLabel, productId, optionId: current.id,
  }) });
  return { target: { ...target, productName: current.group.product.name, groupName: current.group.name }, adjustment };
}
