import { AppError } from '../lib/errors.js';

export const publicProductCustomizationInclude = {
  optionGroups: {
    where: { isAvailable: true, isArchived: false },
    include: {
      options: {
        where: { isAvailable: true, isArchived: false },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
};

export const adminProductCustomizationInclude = {
  optionGroups: {
    where: { isArchived: false },
    include: {
      options: {
        where: { isArchived: false },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
};

function normalizedSelections(item) {
  const selections = Array.isArray(item.selections) ? item.selections : [];
  const result = new Map();
  for (const selection of selections) {
    if (result.has(selection.groupId)) throw new AppError(400, 'DUPLICATE_CUSTOMIZATION_GROUP', 'A customization group was submitted more than once');
    result.set(selection.groupId, [...new Set(selection.optionIds || [])]);
  }
  return result;
}

function stockStatus(stock, threshold) {
  const value = Number(stock) || 0;
  if (value <= 0) return 'SOLD_OUT';
  if (value <= (Number(threshold) || 0)) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export function optionIsOrderable(option) {
  return option?.isAvailable !== false && option?.isArchived !== true && (!option?.trackStock || Number(option.stock) > 0);
}

export function productIsOrderable(product) {
  if (!product || product.isAvailable === false || Number(product.stock) <= 0) return false;
  for (const group of product.optionGroups || []) {
    if (group.isAvailable === false || group.isArchived === true || Number(group.minSelections || 0) <= 0) continue;
    const orderableChoices = (group.options || []).filter(optionIsOrderable).length;
    if (orderableChoices < Number(group.minSelections || 0)) return false;
  }
  return true;
}

export async function resolveCustomizedCartLines(db, items) {
  const productIds = [...new Set(items.map(item => item.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, isAvailable: true },
    include: publicProductCustomizationInclude,
  });
  if (products.length !== productIds.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'One or more products are unavailable');

  const productMap = new Map(products.map(product => [product.id, product]));
  const quantities = new Map();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  for (const [productId, quantity] of quantities) {
    const product = productMap.get(productId);
    const maxPerOrder = Math.max(1, Number(product.maxPerOrder) || 20);
    if (quantity > maxPerOrder) throw new AppError(400, 'MAX_PRODUCT_QUANTITY', `${product.name} is limited to ${maxPerOrder} per order`);
    if (product.stock < quantity) throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} has only ${Math.max(0, product.stock)} left`);
    if (!productIsOrderable(product)) throw new AppError(409, 'PRODUCT_UNAVAILABLE', `${product.name} is currently unavailable`);
  }

  const optionUsages = new Map();
  const lines = items.map(item => {
    const product = productMap.get(item.productId);
    const selectedByGroup = normalizedSelections(item);
    const activeGroupMap = new Map(product.optionGroups.map(group => [group.id, group]));

    for (const groupId of selectedByGroup.keys()) {
      if (!activeGroupMap.has(groupId)) throw new AppError(409, 'CUSTOMIZATION_CHANGED', `${product.name} customization options changed. Please review this item.`);
    }

    const customizations = [];
    let customizationTotalCents = 0;
    for (const group of product.optionGroups) {
      const selectedIds = selectedByGroup.get(group.id) || [];
      if (selectedIds.length < group.minSelections) {
        throw new AppError(400, 'CUSTOMIZATION_REQUIRED', `Choose ${group.minSelections === 1 ? 'an option' : `at least ${group.minSelections} options`} for ${group.name} on ${product.name}`);
      }
      if (selectedIds.length > group.maxSelections) {
        throw new AppError(400, 'TOO_MANY_CUSTOMIZATIONS', `Choose no more than ${group.maxSelections} option${group.maxSelections === 1 ? '' : 's'} for ${group.name} on ${product.name}`);
      }
      if (group.kind === 'VARIANT' && selectedIds.length > 1) {
        throw new AppError(400, 'INVALID_VARIANT_SELECTION', `Choose only one ${group.name} for ${product.name}`);
      }
      if (!selectedIds.length) continue;

      const optionMap = new Map(group.options.map(option => [option.id, option]));
      const selectedOptions = selectedIds.map(optionId => {
        const option = optionMap.get(optionId);
        if (!option) throw new AppError(409, 'CUSTOMIZATION_CHANGED', `${product.name} customization options changed. Please review this item.`);
        if (!optionIsOrderable(option)) throw new AppError(409, 'OPTION_SOLD_OUT', `${product.name} · ${option.name} is currently sold out`);
        customizationTotalCents += option.priceDeltaCents;
        const usage = optionUsages.get(option.id) || {
          option,
          groupId: group.id,
          productId: product.id,
          productName: product.name,
          quantity: 0,
        };
        usage.quantity += item.quantity;
        optionUsages.set(option.id, usage);
        return {
          optionId: option.id,
          name: option.name,
          priceDeltaCents: option.priceDeltaCents,
          trackStock: option.trackStock === true,
        };
      });
      customizations.push({ groupId: group.id, groupName: group.name, kind: group.kind, options: selectedOptions });
    }

    const specialInstructions = item.specialInstructions?.trim() || null;
    const unitPriceCents = product.priceCents + customizationTotalCents;
    return {
      product,
      productId: product.id,
      quantity: item.quantity,
      baseUnitPriceCents: product.priceCents,
      customizationTotalCents,
      unitPriceCents,
      lineTotalCents: unitPriceCents * item.quantity,
      customizations,
      customizationsJson: customizations.length ? JSON.stringify(customizations) : null,
      specialInstructions,
    };
  });

  for (const usage of optionUsages.values()) {
    if (usage.option.trackStock && usage.option.stock < usage.quantity) {
      throw new AppError(409, 'OPTION_INSUFFICIENT_STOCK', `${usage.productName} · ${usage.option.name} has only ${Math.max(0, usage.option.stock)} left`);
    }
  }

  return { products, productMap, quantities, optionUsages, lines };
}

export function parseOrderItemCustomizations(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeProductForClient(product) {
  const optionGroups = (product.optionGroups || []).map(group => ({
    ...group,
    options: (group.options || []).map(option => ({
      ...option,
      orderable: optionIsOrderable(option),
      stockStatus: option.trackStock ? stockStatus(option.stock, option.lowStockThreshold) : 'UNLIMITED',
      availableQuantity: option.trackStock ? option.stock : null,
    })),
  }));
  const enriched = { ...product, optionGroups };
  const orderable = productIsOrderable(enriched);
  return {
    ...enriched,
    orderable,
    stockStatus: product.isAvailable === false ? 'UNAVAILABLE' : stockStatus(product.stock, product.lowStockThreshold),
    maxOrderQuantity: orderable ? Math.max(0, Math.min(Number(product.stock) || 0, Math.max(1, Number(product.maxPerOrder) || 20))) : 0,
  };
}
