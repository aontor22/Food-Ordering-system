import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { approveSslCommerzRiskPayment, getGatewayConfiguration, requestSslCommerzRefund, reconcileSslCommerzPayment, reconcileSslCommerzRefund, serializePayment } from '../services/payment.js';
import { validateChannel, reviewManualPayment, refundManualPayment } from '../services/manual-payment.js';
import { config } from '../config.js';
import { awardDeliveredOrderPoints, getLoyaltySettings, restoreCancelledOrderPoints } from '../services/loyalty.js';
import { cloudinaryConfigured, cloudinaryFolder, createCloudinaryUploadSignature, destroyCloudinaryImage, optimizeCloudinaryUrl, ownsCloudinaryPublicId } from '../lib/cloudinary.js';
import { migrateLegacyProductImages } from '../services/product-media.js';
import { getStoreAvailability, getStoreOperationsConfig, isLocalDateTimeKey, isRealDateKey, isValidTimezone, saveStoreOperations, timeToMinute } from '../services/store-availability.js';
import { findDeliveryPostalOverlap, listAllDeliveryZones, normalizePostalCodes, serializeDeliveryZone } from '../services/delivery-zones.js';
import { getFulfillmentAdminConfig } from '../services/fulfillment-scheduling.js';
import { KITCHEN_STATUSES, allowedOrderTransitions, etaUpdateData, kitchenLaneForStatus, openOrderSseStream, publishOrderChange, trackingEventData, trackingTimestampData } from '../services/order-tracking.js';
import { notificationCapabilities, processPendingNotifications, retryNotificationDelivery, safeEnqueueOrderNotification } from '../services/notifications.js';
import { serializeOrderForClient, stripOrderSecrets } from '../services/order-view.js';
import { adminProductCustomizationInclude, serializeProductForClient } from '../services/product-customizations.js';
import { restoreOrderInventory, setInventoryLevel, withSerializableRetry } from '../services/inventory.js';
import { getAdminAnalytics, getAdminAnalyticsCsv } from '../services/admin-analytics.js';
import { buildOrderDocument, orderDocumentFilename, orderDocumentInclude, renderOrderDocumentHtml } from '../services/order-documents.js';
import { refundReconciliation } from '../services/cancellation-policy.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const empty = z.any();
const imageUrl = z.string().trim().max(500).nullable().optional().refine(
  value => !value || value.startsWith('/') || /^https?:\/\//i.test(value),
  'Image URL must be an HTTP(S) URL or a root-relative path',
);
const imagePublicId = z.string().trim().min(1).max(255).nullable().optional();
const optionInput = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  priceDeltaCents: z.number().int().nonnegative().max(10_000_000).default(0),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isAvailable: z.boolean().default(true),
  trackStock: z.boolean().default(false),
  stock: z.number().int().nonnegative().max(1_000_000).default(0),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).default(5),
});
const optionGroupInput = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['VARIANT', 'ADDON']).default('ADDON'),
  minSelections: z.number().int().min(0).max(20).default(0),
  maxSelections: z.number().int().min(1).max(20).default(1),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isAvailable: z.boolean().default(true),
  options: z.array(optionInput).min(1).max(30),
}).superRefine((group, ctx) => {
  const availableOptions = group.options.filter(option => option.isAvailable);
  if (group.minSelections > group.maxSelections) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum selections cannot exceed maximum selections' });
  if (group.maxSelections > group.options.length) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Maximum selections cannot exceed the number of options' });
  if (group.isAvailable && group.minSelections > availableOptions.length) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum selections cannot exceed the number of active options' });
  if (group.kind === 'VARIANT' && group.maxSelections !== 1) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Variant groups allow exactly one selection at most' });
  if (group.kind === 'VARIANT' && group.minSelections > 1) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Variant groups cannot require more than one selection' });
  if (group.options.filter(option => option.isDefault).length > 1 && group.maxSelections === 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Single-select groups can have only one default option' });
  if (group.options.some(option => option.isDefault && !option.isAvailable)) ctx.addIssue({ code: 'custom', path: ['options'], message: 'A default option must be active' });
});
const optionGroupsInput = z.array(optionGroupInput).max(12).superRefine((groups, ctx) => {
  const groupIds = groups.map(group => group.id).filter(Boolean);
  if (new Set(groupIds).size !== groupIds.length) ctx.addIssue({ code: 'custom', message: 'Customization group IDs must be unique' });
  const optionIds = groups.flatMap(group => group.options.map(option => option.id).filter(Boolean));
  if (new Set(optionIds).size !== optionIds.length) ctx.addIssue({ code: 'custom', message: 'Customization option IDs must be unique' });
});
const productFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(500),
  category: z.string().trim().min(2).max(50),
  imageUrl,
  imagePublicId,
  priceCents: z.number().int().positive().max(10_000_000),
  stock: z.number().int().nonnegative().max(1_000_000),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).default(10),
  maxPerOrder: z.number().int().min(1).max(20).default(20),
  isVegetarian: z.boolean().default(false),
  isVegan: z.boolean().default(false),
  isHalal: z.boolean().default(false),
  isGlutenFree: z.boolean().default(false),
  isAvailable: z.boolean(),
  optionGroups: optionGroupsInput.optional(),
};
const productCreate = z.object({
  body: z.object({ id: z.string().trim().min(1).max(50).optional(), ...productFields }),
  params: empty,
  query: empty,
});
const productUpdate = z.object({
  body: z.object(productFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany({
    include: { ...adminProductCustomizationInclude, _count: { select: { wishlistItems: true } } },
    orderBy: [{ isAvailable: 'desc' }, { updatedAt: 'desc' }],
  });
  res.json({ products: products.map(({ _count, ...product }) => ({ ...product, wishlistCount: _count.wishlistItems })) });
});

function normalizeDietaryClassification(values, existing = {}) {
  const next = { ...values };
  const vegan = next.isVegan !== undefined ? next.isVegan : existing.isVegan;
  const vegetarian = next.isVegetarian !== undefined ? next.isVegetarian : existing.isVegetarian;
  if (vegan === true && vegetarian !== true) next.isVegetarian = true;
  if (next.isVegetarian === false && existing.isVegan === true && next.isVegan === undefined) next.isVegan = false;
  return next;
}

function normalizeProductMedia(values) {
  const next = { ...values };
  if ('imagePublicId' in next && next.imagePublicId) {
    if (!cloudinaryConfigured()) throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary is not configured on the server');
    if (!ownsCloudinaryPublicId(next.imagePublicId)) throw new AppError(400, 'INVALID_CLOUDINARY_ASSET', 'Product image is outside the configured Cloudinary folder');
    if (!next.imageUrl || !/^https:\/\/res\.cloudinary\.com\//i.test(next.imageUrl)) throw new AppError(400, 'INVALID_CLOUDINARY_URL', 'Cloudinary product images require a Cloudinary HTTPS URL');
    next.imageUrl = optimizeCloudinaryUrl(next.imageUrl);
  }
  if ('imageUrl' in next && !next.imageUrl) next.imageUrl = null;
  if ('imagePublicId' in next && !next.imagePublicId) next.imagePublicId = null;
  return next;
}

function generatedCustomizationId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

async function syncProductCustomizations(tx, productId, groups) {
  const existingGroups = await tx.productOptionGroup.findMany({ where: { productId }, include: { options: true } });
  const existingGroupMap = new Map(existingGroups.map(group => [group.id, group]));

  for (const group of existingGroups) {
    await tx.productOptionGroup.update({ where: { id: group.id }, data: { isArchived: true, isAvailable: false } });
    if (group.options.length) {
      await tx.productOption.updateMany({ where: { groupId: group.id }, data: { isArchived: true, isAvailable: false, isDefault: false } });
    }
  }

  for (const [groupIndex, group] of (groups || []).entries()) {
    const groupId = group.id || generatedCustomizationId('grp');
    const existingGroup = existingGroupMap.get(groupId);
    if (group.id && !existingGroup) {
      const collision = await tx.productOptionGroup.findUnique({ where: { id: group.id }, select: { productId: true } });
      if (collision) throw new AppError(409, 'CUSTOMIZATION_ID_CONFLICT', 'A customization group ID belongs to another product');
    }

    if (existingGroup) {
      await tx.productOptionGroup.update({
        where: { id: groupId },
        data: {
          name: group.name,
          kind: group.kind,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder ?? groupIndex,
          isAvailable: group.isAvailable,
          isArchived: false,
        },
      });
    } else {
      await tx.productOptionGroup.create({
        data: {
          id: groupId,
          productId,
          name: group.name,
          kind: group.kind,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          sortOrder: group.sortOrder ?? groupIndex,
          isAvailable: group.isAvailable,
          isArchived: false,
        },
      });
    }

    const existingOptions = new Map((existingGroup?.options || []).map(option => [option.id, option]));
    for (const [optionIndex, option] of group.options.entries()) {
      const optionId = option.id || generatedCustomizationId('opt');
      const existingOption = existingOptions.get(optionId);
      if (option.id && !existingOption) {
        const collision = await tx.productOption.findUnique({ where: { id: option.id }, select: { groupId: true } });
        if (collision) throw new AppError(409, 'CUSTOMIZATION_ID_CONFLICT', 'A customization option ID belongs to another group');
      }
      const common = {
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        isDefault: option.isDefault,
        sortOrder: option.sortOrder ?? optionIndex,
        isAvailable: option.isAvailable,
        isArchived: false,
        trackStock: option.trackStock === true,
        lowStockThreshold: option.lowStockThreshold ?? 5,
      };
      if (existingOption) {
        await tx.productOption.update({ where: { id: optionId }, data: common });
      } else {
        await tx.productOption.create({
          data: {
            id: optionId,
            groupId,
            ...common,
            stock: option.trackStock ? (option.stock || 0) : 0,
          },
        });
      }
    }
  }
}

router.post('/products', validate(productCreate), async (req, res, next) => {
  try {
    const { id, optionGroups = [], ...rawValues } = req.validated.body;
    const values = normalizeProductMedia(normalizeDietaryClassification(rawValues));
    const productId = id || `prd_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const product = await withSerializableRetry(async tx => {
      await tx.product.create({ data: { id: productId, ...values } });
      await syncProductCustomizations(tx, productId, optionGroups);
      const created = await tx.product.findUnique({ where: { id: productId }, include: adminProductCustomizationInclude });
      const openingAdjustments = [{
        targetType: 'PRODUCT', quantityDelta: created.stock, balanceAfter: created.stock, reason: 'INITIAL_STOCK', sourceType: 'SYSTEM',
        actorId: req.auth.sub, actorLabel: req.auth.email || 'Administrator', productId: created.id,
      }];
      for (const group of created.optionGroups) for (const option of group.options) if (option.trackStock) openingAdjustments.push({
        targetType: 'OPTION', quantityDelta: option.stock, balanceAfter: option.stock, reason: 'INITIAL_STOCK', sourceType: 'SYSTEM',
        actorId: req.auth.sub, actorLabel: req.auth.email || 'Administrator', productId: created.id, optionId: option.id,
      });
      await tx.inventoryAdjustment.createMany({ data: openingAdjustments });
      return created;
    });
    await audit(req, 'PRODUCT_CREATED', 'Product', product.id, { imageStorage: product.imagePublicId ? 'cloudinary' : 'external_or_local', customizationGroups: product.optionGroups.length });
    res.status(201).json({ product });
  } catch (error) { next(error); }
});

router.patch('/products/:id', validate(productUpdate), async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({ where: { id: req.validated.params.id } });
    if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const { optionGroups, stock: submittedStock, ...rawValues } = req.validated.body;
    if (submittedStock !== undefined && submittedStock !== existing.stock) {
      throw new AppError(409, 'USE_INVENTORY_ADJUSTMENT', 'Use Inventory to change stock so concurrent orders cannot be overwritten.');
    }
    const values = normalizeProductMedia(normalizeDietaryClassification(rawValues, existing));
    const product = await withSerializableRetry(async tx => {
      if (Object.keys(values).length) await tx.product.update({ where: { id: existing.id }, data: values });
      if (optionGroups) await syncProductCustomizations(tx, existing.id, optionGroups);
      return tx.product.findUnique({ where: { id: existing.id }, include: adminProductCustomizationInclude });
    });
    if (existing.imagePublicId && existing.imagePublicId !== product.imagePublicId) {
      try { await destroyCloudinaryImage(existing.imagePublicId); }
      catch (cleanupError) { req.log?.warn({ err: cleanupError, publicId: existing.imagePublicId }, 'old product image cleanup failed'); }
    }
    await audit(req, 'PRODUCT_UPDATED', 'Product', product.id, { fields: Object.keys(req.validated.body), imageStorage: product.imagePublicId ? 'cloudinary' : 'external_or_local', customizationGroups: product.optionGroups.length });
    res.json({ product });
  } catch (error) { next(error); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.update({ where: { id: req.params.id }, data: { isAvailable: false } });
    await audit(req, 'PRODUCT_ARCHIVED', 'Product', product.id);
    res.status(204).end();
  } catch (error) { next(error); }
});


const inventoryAdjustmentSchema = z.object({
  body: z.object({
    targetType: z.enum(['PRODUCT', 'OPTION']),
    productId: z.string().min(1).max(100),
    optionId: z.string().min(1).max(100).optional(),
    expectedVersion: z.number().int().nonnegative(),
    newStock: z.number().int().nonnegative().max(1_000_000),
    reason: z.enum(['RESTOCK', 'STOCK_COUNT', 'WASTE', 'DAMAGE', 'CORRECTION', 'OTHER']),
    note: z.string().trim().max(240).optional().transform(value => value || null),
  }).superRefine((value, ctx) => {
    if (value.targetType === 'OPTION' && !value.optionId) ctx.addIssue({ code: 'custom', path: ['optionId'], message: 'Option is required' });
  }),
  params: empty,
  query: empty,
});

router.get('/inventory', async (_req, res) => {
  const [products, adjustments] = await Promise.all([
    prisma.product.findMany({
      include: adminProductCustomizationInclude,
      orderBy: [{ isAvailable: 'desc' }, { name: 'asc' }],
    }),
    prisma.inventoryAdjustment.findMany({
      include: {
        product: { select: { id: true, name: true } },
        option: { select: { id: true, name: true, group: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    }),
  ]);
  const serialized = products.map(serializeProductForClient);
  const trackedOptions = serialized.flatMap(product => product.optionGroups.flatMap(group => group.options
    .filter(option => option.trackStock)
    .map(option => ({ ...option, productId: product.id, productName: product.name, groupName: group.name }))));
  const lowStockProducts = serialized.filter(product => product.isAvailable && product.stock > 0 && product.stock <= product.lowStockThreshold).length;
  const soldOutProducts = serialized.filter(product => product.isAvailable && product.stock <= 0).length;
  const lowStockOptions = trackedOptions.filter(option => option.isAvailable && option.stock > 0 && option.stock <= option.lowStockThreshold).length;
  const soldOutOptions = trackedOptions.filter(option => option.isAvailable && option.stock <= 0).length;
  res.json({
    products: serialized,
    summary: {
      productCount: serialized.length,
      trackedOptionCount: trackedOptions.length,
      lowStockProducts,
      soldOutProducts,
      lowStockOptions,
      soldOutOptions,
    },
    adjustments,
  });
});

router.post('/inventory/adjust', validate(inventoryAdjustmentSchema), async (req, res, next) => {
  try {
    const result = await withSerializableRetry(tx => setInventoryLevel(tx, {
      ...req.validated.body,
      actorId: req.auth.sub,
      actorLabel: req.auth.email || 'Administrator',
    }));
    await audit(req, 'INVENTORY_ADJUSTED', req.validated.body.targetType === 'PRODUCT' ? 'Product' : 'ProductOption', req.validated.body.optionId || req.validated.body.productId, {
      productId: req.validated.body.productId,
      optionId: req.validated.body.optionId || null,
      newStock: req.validated.body.newStock,
      reason: req.validated.body.reason,
      quantityDelta: result.adjustment.quantityDelta,
    });
    res.json(result);
  } catch (error) { next(error); }
});

router.get('/media', async (_req, res) => {
  const legacyImageCount = await prisma.product.count({ where: { imagePublicId: null, imageUrl: { startsWith: '/' } } });
  res.json({ configured: cloudinaryConfigured(), folder: cloudinaryFolder(), legacyImageCount, maxUploadBytes: 8 * 1024 * 1024 });
});

router.post('/media/signature', async (_req, res, next) => {
  try { res.json(createCloudinaryUploadSignature()); }
  catch (error) { next(error); }
});

router.post('/media/cleanup', validate(z.object({
  body: z.object({ publicId: z.string().trim().min(1).max(255) }), params: empty, query: empty,
})), async (req, res, next) => {
  try {
    const linked = await prisma.product.count({ where: { imagePublicId: req.validated.body.publicId } });
    if (linked) throw new AppError(409, 'IMAGE_IN_USE', 'This Cloudinary image is already linked to a product');
    const result = await destroyCloudinaryImage(req.validated.body.publicId);
    res.json({ result: result.result || 'ok' });
  } catch (error) { next(error); }
});

router.post('/media/migrate-legacy', async (req, res, next) => {
  try {
    if (!cloudinaryConfigured()) throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary is not configured on the server');
    const result = await migrateLegacyProductImages(prisma, { logger: req.log || console });
    await audit(req, 'PRODUCT_IMAGES_MIGRATED', 'Product', 'cloudinary', result);
    res.json(result);
  } catch (error) { next(error); }
});

router.get('/orders', async (_req, res) => {
  const orders = await prisma.order.findMany({
    include: { items: true, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } }, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ orders: orders.map(serializeOrderForClient) });
});

router.get('/orders/:id/documents/:type', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderDocumentInclude });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const document = await buildOrderDocument(prisma, order, req.params.type);
    const download = String(req.query.download || '') === '1';
    const autoPrint = String(req.query.print || '') === '1';
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.type('html');
    res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${orderDocumentFilename(document)}"`);
    if (download) await audit(req, 'ORDER_DOCUMENT_EXPORTED', 'Order', order.id, { type: document.type, documentNumber: document.documentNumber });
    res.send(renderOrderDocumentHtml(document, { autoPrint }));
  } catch (error) { next(error); }
});

router.get('/orders/live', (req, res) => {
  openOrderSseStream(req, res, {
    loadSnapshot: async () => {
      const orders = await prisma.order.findMany({
        include: { items: true, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } }, user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 250,
      });
      const serialized = orders.map(serializeOrderForClient);
      return {
        data: { orders: serialized },
        signature: serialized.map(order => [order.id, order.status, order.paymentStatus, order.updatedAt, order.payment?.updatedAt, order.trackingEvents?.at(-1)?.createdAt, order.estimatedReadyAt, order.estimatedDeliveryAt]),
      };
    },
  });
});

const kitchenOrderInclude = {
  items: true,
  payment: true,
  trackingEvents: { orderBy: { createdAt: 'asc' } },
  user: { select: { id: true, name: true, email: true } },
};

async function loadKitchenOrders() {
  const orders = await prisma.order.findMany({
    where: { status: { in: KITCHEN_STATUSES } },
    include: kitchenOrderInclude,
    orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
  return orders.map(order => ({ ...serializeOrderForClient(order), kitchenLane: kitchenLaneForStatus(order.status) }));
}

router.get('/kitchen', async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ orders: await loadKitchenOrders() });
});

router.get('/kitchen/live', (req, res) => {
  openOrderSseStream(req, res, {
    loadSnapshot: async () => {
      const orders = await loadKitchenOrders();
      return {
        data: { orders },
        signature: orders.map(order => [order.id, order.status, order.statusUpdatedAt, order.estimatedReadyAt, order.readyAt, order.trackingEvents?.at(-1)?.createdAt]),
      };
    },
  });
});
const statusUpdate = z.object({
  body: z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
    estimateMinutes: z.number().int().min(5).max(240).optional(),
    note: z.string().trim().max(240).optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

const etaUpdate = z.object({
  body: z.object({ minutes: z.number().int().min(5).max(240), note: z.string().trim().max(240).optional() }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.patch('/orders/:id/status', validate(statusUpdate), async (req, res, next) => {
  try {
    let previousStatus;
    let pointsAwarded = 0;
    let pointsRestored = 0;
    const order = await withSerializableRetry(async transaction => {
      const existing = await transaction.order.findUnique({ where: { id: req.validated.params.id }, include: { items: true, payment: true } });
      if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
      const nextStatus = req.validated.body.status;
      previousStatus = existing.status;
      if (!allowedOrderTransitions(existing).includes(nextStatus)) {
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Order cannot move from ${existing.status} to ${nextStatus}`);
      }
      if (nextStatus === 'CANCELLED' && !req.validated.body.note?.trim()) throw new AppError(400, 'CANCELLATION_REASON_REQUIRED', 'Add a cancellation reason for the audit trail');
      if (nextStatus === 'CANCELLED' && existing.paymentStatus === 'PAID') {
        throw new AppError(409, 'REFUND_REQUIRED', 'Record the refund before cancelling this paid order');
      }
      if (existing.paymentMethod !== 'COD' && existing.paymentStatus !== 'PAID' && nextStatus !== 'CANCELLED') {
        throw new AppError(409, 'PAYMENT_REQUIRED', 'Payment must be verified before fulfilment can begin');
      }
      if (nextStatus === 'CANCELLED' && existing.paymentMethod === 'MANUAL' && existing.paymentStatus === 'REVIEW') throw new AppError(409, 'PAYMENT_UNDER_REVIEW', 'Review the submitted payment before cancelling');
      if (nextStatus === 'CANCELLED' && existing.payment?.provider === 'SSLCOMMERZ' && ['PROCESSING', 'REVIEW', 'REFUND_PENDING'].includes(existing.payment.status)) throw new AppError(409, 'PAYMENT_PROCESSING', 'Wait for gateway payment/refund verification before cancelling');
      const settleCod = nextStatus === 'DELIVERED' && existing.paymentMethod === 'COD' && existing.paymentStatus !== 'REFUNDED';

      if (nextStatus === 'CANCELLED') {
        await restoreOrderInventory(transaction, existing, { sourceId: existing.orderNumber, reason: 'ORDER_CANCELLED_BY_ADMIN', actorId: req.auth.sub, actorLabel: req.auth.email || 'Administrator' });
        if (existing.payment) await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'CANCELLED', failureReason: 'Order cancelled by administrator' } });
      }
      if (settleCod && existing.payment) {
        await transaction.payment.updateMany({ where: { id: existing.payment.id, status: { notIn: ['PAID', 'REFUNDED'] } }, data: { status: 'PAID', paidAt: new Date(), failureReason: null } });
      }

      let updated = await transaction.order.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          ...trackingTimestampData(nextStatus, existing, { estimateMinutes: req.validated.body.estimateMinutes }),
          ...(settleCod ? { paymentStatus: 'PAID' } : {}),
          ...(nextStatus === 'CANCELLED' && !['PAID', 'REFUNDED'].includes(existing.paymentStatus) ? { paymentStatus: 'CANCELLED' } : {}),
          ...(nextStatus === 'CANCELLED' ? { cancellationReason: req.validated.body.note.trim(), cancelledBy: 'ADMIN' } : {}),
          trackingEvents: { create: trackingEventData(nextStatus, {
            actorType: 'ADMIN', actorLabel: req.auth.email || 'Restaurant team', note: req.validated.body.note || null,
          }) },
        },
      });
      if (nextStatus === 'DELIVERED') {
        const result = await awardDeliveredOrderPoints(transaction, { ...existing, ...updated });
        pointsAwarded = result.awarded;
      }
      if (nextStatus === 'CANCELLED') {
        const result = await restoreCancelledOrderPoints(transaction, { ...existing, ...updated });
        pointsRestored = result.restored;
      }
      return transaction.order.findUnique({
        where: { id: existing.id },
        include: { items: true, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } }, user: { select: { id: true, name: true, email: true, pointsBalance: true } } },
      });
    });
    await audit(req, 'ORDER_STATUS_UPDATED', 'Order', order.id, { from: previousStatus, to: order.status, pointsAwarded, pointsRestored });
    publishOrderChange(order);
    await safeEnqueueOrderNotification(order.id, order.status, {}, req.log);
    res.json({ order: serializeOrderForClient(order), pointsAwarded, pointsRestored });
  } catch (error) { next(error); }
});

router.patch('/orders/:id/eta', validate(etaUpdate), async (req, res, next) => {
  try {
    const order = await prisma.$transaction(async transaction => {
      const existing = await transaction.order.findUnique({ where: { id: req.validated.params.id } });
      if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
      let update;
      try { update = etaUpdateData(existing, req.validated.body.minutes); }
      catch (error) { throw new AppError(409, error.code || 'ETA_NOT_AVAILABLE', error.message); }
      if (req.validated.body.note) update.event.note = `${update.event.note} ${req.validated.body.note}`.slice(0, 240);
      await transaction.order.update({
        where: { id: existing.id },
        data: { ...update.data, trackingEvents: { create: { ...update.event, actorLabel: req.auth.email || 'Restaurant team' } } },
      });
      return transaction.order.findUnique({
        where: { id: existing.id },
        include: { items: true, payment: true, trackingEvents: { orderBy: { createdAt: 'asc' } }, user: { select: { id: true, name: true, email: true, pointsBalance: true } } },
      });
    });
    await audit(req, 'ORDER_ETA_UPDATED', 'Order', order.id, { status: order.status, minutes: req.validated.body.minutes });
    publishOrderChange(order);
    const latestEvent = order.trackingEvents?.at(-1);
    await safeEnqueueOrderNotification(order.id, `ETA:${latestEvent?.id || Date.now()}`, { etaNote: latestEvent?.note || null }, req.log);
    res.json({ order: serializeOrderForClient(order) });
  } catch (error) { next(error); }
});

router.get('/refund-reconciliation', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payments = await prisma.payment.findMany({
      where: { OR: [
        { status: { in: ['PROCESSING', 'REVIEW', 'REFUND_PENDING', 'PAID', 'REFUNDED'] }, order: { cancellationRequestedAt: { not: null } } },
        { status: 'REFUND_PENDING' },
      ] },
      include: { order: { select: { id: true, orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, cancellationRequestedAt: true, cancellationRequestReason: true, email: true, firstName: true, lastName: true, totalCents: true } } },
      orderBy: { updatedAt: 'asc' }, take: 250,
    });
    res.json({ items: payments.map(payment => ({ payment: serializePayment(payment), order: payment.order, reconciliation: refundReconciliation(payment, payment.order) })) });
  } catch (error) { next(error); }
});

router.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({
    include: { manualSubmissions: { orderBy: { createdAt: 'desc' } }, order: { include: { user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ payments: payments.map(payment => ({ ...serializePayment(payment), order: stripOrderSecrets(payment.order) })), gateway: getGatewayConfiguration() });
});

router.get('/payment-channels', async (_req, res) => {
  res.json({ currency: config.PAYMENT_CURRENCY, channels: await prisma.manualPaymentChannel.findMany({ orderBy: { createdAt: 'asc' } }) });
});
router.post('/payment-channels', async (req, res, next) => {
  try {
    const data = validateChannel(req.body);
    const channel = await prisma.manualPaymentChannel.create({ data });
    await audit(req, 'PAYMENT_CHANNEL_CREATED', 'ManualPaymentChannel', channel.id);
    res.status(201).json({ channel });
  } catch (error) { next(error); }
});
router.patch('/payment-channels/:id', async (req, res, next) => {
  try {
    const data = validateChannel(req.body);
    const channel = await prisma.manualPaymentChannel.update({ where: { id: req.params.id }, data });
    await audit(req, 'PAYMENT_CHANNEL_UPDATED', 'ManualPaymentChannel', channel.id);
    res.json({ channel });
  } catch (error) { next(error); }
});
router.post('/payments/:id/manual-review', async (req, res, next) => {
  try {
    const payment = await reviewManualPayment(req.params.id, req.body, req);
    const paymentLink = payment.status === 'PAID' ? await prisma.payment.findUnique({ where: { id: req.params.id }, select: { orderId: true } }) : null;
    const order = paymentLink ? await prisma.order.findUnique({ where: { id: paymentLink.orderId } }) : null;
    if (order?.status === 'CONFIRMED') await safeEnqueueOrderNotification(order.id, 'CONFIRMED', {}, req.log);
    res.json({ payment });
  } catch (error) { next(error); }
});
router.post('/payments/:id/manual-refunded', async (req, res, next) => {
  try { res.json({ payment: await refundManualPayment(req.params.id, req.body, req) }); }
  catch (error) { next(error); }
});

router.post('/payments/:id/check', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.provider !== 'SSLCOMMERZ') throw new AppError(409, 'NOT_GATEWAY_PAYMENT', 'This payment does not use SSLCOMMERZ');
    if (payment.status === 'REFUND_PENDING') await reconcileSslCommerzRefund(payment.id);
    else await reconcileSslCommerzPayment(payment.transactionId);
    const linkedOrder = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (linkedOrder?.status === 'CONFIRMED') await safeEnqueueOrderNotification(linkedOrder.id, 'CONFIRMED', {}, req.log);
    await audit(req, 'PAYMENT_STATUS_CHECKED', 'Payment', payment.id, { phase: payment.status === 'REFUND_PENDING' ? 'refund' : 'payment' });
    res.json({ payment: serializePayment(await prisma.payment.findUnique({ where: { id: payment.id } })) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/gateway-risk-approve', async (req, res, next) => {
  try {
    const payment = await approveSslCommerzRiskPayment(req.params.id);
    const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (order?.status === 'CONFIRMED') await safeEnqueueOrderNotification(order.id, 'CONFIRMED', {}, req.log);
    await audit(req, 'GATEWAY_RISK_PAYMENT_ACCEPTED_BY_ADMIN', 'Payment', payment.id);
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/gateway-refund', validate(z.object({
  body: z.object({ reason: z.string().trim().min(5).max(255) }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const payment = await requestSslCommerzRefund(req.validated.params.id, req.validated.body.reason);
    await audit(req, 'GATEWAY_REFUND_REQUESTED_BY_ADMIN', 'Payment', payment.id, { reason: req.validated.body.reason, amountCents: payment.refundAmountCents || payment.amountCents });
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/cash-received', async (req, res, next) => {
  try {
    const payment = await prisma.$transaction(async transaction => {
    const existing = await transaction.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
    if (!existing) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (existing.provider !== 'COD') throw new AppError(409, 'GATEWAY_VERIFICATION_REQUIRED', 'Online payments can only be confirmed by the payment gateway');
    if (existing.order.status === 'CANCELLED') throw new AppError(409, 'ORDER_CANCELLED', 'A cancelled order cannot be marked as paid');
    if (existing.status === 'PAID') return existing;
    if (existing.status === 'REFUNDED') throw new AppError(409, 'PAYMENT_REFUNDED', 'A refunded payment cannot be collected again');
      const updated = await transaction.payment.update({ where: { id: existing.id }, data: { status: 'PAID', paidAt: new Date(), failureReason: null } });
      await transaction.order.update({ where: { id: existing.orderId }, data: { paymentStatus: 'PAID' } });
      return updated;
    });
    await audit(req, 'CASH_PAYMENT_CONFIRMED', 'Payment', payment.id, { orderId: payment.orderId });
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.post('/payments/:id/cash-refunded', async (req, res, next) => {
  try {
    const payment = await prisma.$transaction(async transaction => {
    const existing = await transaction.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
    if (!existing) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (existing.provider !== 'COD' || existing.status !== 'PAID') throw new AppError(409, 'MANUAL_REFUND_NOT_ALLOWED', 'Only a paid cash-on-delivery transaction can be manually refunded');
      const updated = await transaction.payment.update({ where: { id: existing.id }, data: { status: 'REFUNDED', failureReason: null } });
      await transaction.order.update({ where: { id: existing.orderId }, data: { paymentStatus: 'REFUNDED' } });
      return updated;
    });
    await audit(req, 'CASH_PAYMENT_REFUNDED', 'Payment', payment.id, { orderId: payment.orderId });
    res.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, isActive: true, pointsBalance: true, createdAt: true,
      _count: { select: { orders: true, wishlistItems: true } },
      orders: { where: { status: 'DELIVERED' }, select: { totalCents: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    users: users.map(({ orders, _count, ...user }) => ({
      ...user,
      orderCount: _count.orders,
      wishlistCount: _count.wishlistItems,
      lifetimeValueCents: orders.reduce((total, order) => total + order.totalCents, 0),
    })),
  });
});

const userUpdate = z.object({
  body: z.object({ isActive: z.boolean() }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
});

router.patch('/users/:id', validate(userUpdate), async (req, res, next) => {
  try {
    if (req.validated.params.id === req.auth.sub && !req.validated.body.isActive) {
      throw new AppError(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own administrator account');
    }
    const existing = await prisma.user.findUnique({ where: { id: req.validated.params.id } });
    if (!existing) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (existing.role === 'ADMIN' && !req.validated.body.isActive) {
      throw new AppError(409, 'ADMIN_PROTECTED', 'Administrator accounts cannot be disabled from this screen');
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: req.validated.body.isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    if (!user.isActive) await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, user.isActive ? 'USER_ENABLED' : 'USER_DISABLED', 'User', user.id);
    res.json({ user });
  } catch (error) { next(error); }
});



const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM time');
const storeOperationsUpdate = z.object({
  body: z.object({
    timezone: z.string().trim().min(1).max(80).refine(isValidTimezone, 'Use a valid IANA timezone such as Asia/Dhaka'),
    acceptingOrders: z.boolean(),
    temporaryClosed: z.boolean(),
    temporaryClosedReason: z.union([z.string().trim().max(160), z.null()]).optional().transform(value => value || null),
    temporaryClosedUntilLocal: z.union([z.string().trim().max(16), z.null()]).optional().transform(value => value || null).refine(isLocalDateTimeKey, 'Temporary reopening time must be YYYY-MM-DDTHH:MM'),
    customerCancelWindowMinutes: z.number().int().min(0).max(120),
    scheduledCancelLeadMinutes: z.number().int().min(0).max(10080),
    hours: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      isClosed: z.boolean(),
      open24Hours: z.boolean(),
      openTime: hhmm,
      closeTime: hhmm,
    })).length(7).refine(items => new Set(items.map(item => item.dayOfWeek)).size === 7, 'Weekly hours must include each day exactly once'),
  }),
  params: empty,
  query: empty,
});

router.get('/store-operations', async (_req, res, next) => {
  try { res.json(await getStoreOperationsConfig()); }
  catch (error) { next(error); }
});

router.patch('/store-operations', validate(storeOperationsUpdate), async (req, res, next) => {
  try {
    const values = req.validated.body;
    const normalizedHours = values.hours.map(hour => {
      const openMinute = timeToMinute(hour.openTime);
      const closeMinute = timeToMinute(hour.closeTime);
      if (!hour.isClosed && !hour.open24Hours && openMinute === closeMinute) {
        throw new AppError(400, 'INVALID_OPENING_WINDOW', 'Opening and closing time cannot be the same unless Open 24 hours is enabled');
      }
      return { dayOfWeek: hour.dayOfWeek, isClosed: hour.isClosed, open24Hours: hour.open24Hours, openMinute, closeMinute };
    });
    await prisma.$transaction(async transaction => saveStoreOperations(transaction, { ...values, hours: normalizedHours }));
    await audit(req, 'STORE_OPERATIONS_UPDATED', 'RestaurantSetting', 'default', {
      timezone: values.timezone,
      acceptingOrders: values.acceptingOrders,
      temporaryClosed: values.temporaryClosed,
      temporaryClosedUntilLocal: values.temporaryClosedUntilLocal,
      customerCancelWindowMinutes: values.customerCancelWindowMinutes,
      scheduledCancelLeadMinutes: values.scheduledCancelLeadMinutes,
      hours: normalizedHours,
    });
    res.json(await getStoreOperationsConfig());
  } catch (error) { next(error); }
});

router.post('/store-closures', validate(z.object({
  body: z.object({
    dateKey: z.string().trim().refine(isRealDateKey, 'Use a valid YYYY-MM-DD date'),
    reason: z.union([z.string().trim().max(160), z.null()]).optional().transform(value => value || null),
  }),
  params: empty,
  query: empty,
})), async (req, res, next) => {
  try {
    const closure = await prisma.restaurantClosure.upsert({
      where: { dateKey: req.validated.body.dateKey },
      update: { reason: req.validated.body.reason },
      create: req.validated.body,
    });
    await audit(req, 'STORE_CLOSURE_SAVED', 'RestaurantClosure', closure.id, { dateKey: closure.dateKey, reason: closure.reason });
    res.status(201).json({ closure, ...(await getStoreOperationsConfig()) });
  } catch (error) { next(error); }
});

router.delete('/store-closures/:id', async (req, res, next) => {
  try {
    const closure = await prisma.restaurantClosure.findUnique({ where: { id: req.params.id } });
    if (!closure) throw new AppError(404, 'STORE_CLOSURE_NOT_FOUND', 'Closure not found');
    await prisma.restaurantClosure.delete({ where: { id: closure.id } });
    await audit(req, 'STORE_CLOSURE_REMOVED', 'RestaurantClosure', closure.id, { dateKey: closure.dateKey });
    res.status(204).end();
  } catch (error) { next(error); }
});


const deliveryZoneFields = {
  name: z.string().trim().min(2).max(80),
  description: z.union([z.string().trim().max(240), z.null()]).optional().transform(value => value || null),
  postalCodes: z.array(z.string().trim().min(1).max(20)).max(100).default([]),
  feeCents: z.number().int().nonnegative().max(100_000_000),
  minimumOrderCents: z.number().int().nonnegative().max(100_000_000),
  freeDeliveryThresholdCents: z.union([z.number().int().nonnegative().max(100_000_000), z.null()]).optional().transform(value => value === 0 ? null : value ?? null),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
};
const deliveryZoneCreate = z.object({ body: z.object(deliveryZoneFields), params: empty, query: empty });
const deliveryZoneUpdate = z.object({
  body: z.object(deliveryZoneFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
  params: z.object({ id: z.string().min(1) }), query: empty,
});

function normalizeDeliveryZoneData(values, existing = null) {
  const merged = { ...(existing || {}), ...values };
  if (merged.freeDeliveryThresholdCents != null && merged.freeDeliveryThresholdCents < merged.minimumOrderCents) {
    throw new AppError(400, 'INVALID_FREE_DELIVERY_THRESHOLD', 'Free-delivery threshold cannot be lower than the minimum order');
  }
  const data = { ...values };
  if ('postalCodes' in values) data.postalCodes = normalizePostalCodes(values.postalCodes.join(',')) || null;
  return data;
}

async function ensureZoneCanBeDisabled(id, nextActive) {
  if (nextActive !== false) return;
  const activeCount = await prisma.deliveryZone.count({ where: { active: true, id: { not: id } } });
  if (!activeCount) throw new AppError(409, 'LAST_DELIVERY_ZONE', 'Keep at least one delivery zone active. Disable delivery from Scheduling if you only want pickup.');
}

async function ensurePostalCodesUnique(postalCodes, id = null, active = true) {
  if (!active || !postalCodes?.length) return;
  const overlap = await findDeliveryPostalOverlap(prisma, postalCodes, id);
  if (overlap) throw new AppError(409, 'POSTAL_CODE_OVERLAP', `Postal code ${overlap.postalCode} is already assigned to ${overlap.zone.name}`);
}

router.get('/delivery-zones', async (_req, res, next) => {
  try {
    const zones = await listAllDeliveryZones();
    res.json({
      currency: config.PAYMENT_CURRENCY,
      zones,
      stats: { total: zones.length, active: zones.filter(zone => zone.active).length, postalMapped: zones.filter(zone => zone.postalCodes.length).length },
    });
  } catch (error) { next(error); }
});

router.post('/delivery-zones', validate(deliveryZoneCreate), async (req, res, next) => {
  try {
    const values = req.validated.body;
    await ensurePostalCodesUnique(values.postalCodes, null, values.active);
    const data = normalizeDeliveryZoneData(values);
    const zone = await prisma.deliveryZone.create({ data });
    await audit(req, 'DELIVERY_ZONE_CREATED', 'DeliveryZone', zone.id, { name: zone.name, feeCents: zone.feeCents, minimumOrderCents: zone.minimumOrderCents });
    res.status(201).json({ zone: serializeDeliveryZone(zone) });
  } catch (error) { next(error); }
});

router.patch('/delivery-zones/:id', validate(deliveryZoneUpdate), async (req, res, next) => {
  try {
    const existing = await prisma.deliveryZone.findUnique({ where: { id: req.validated.params.id } });
    if (!existing) throw new AppError(404, 'DELIVERY_ZONE_NOT_FOUND', 'Delivery zone not found');
    const nextActive = req.validated.body.active ?? existing.active;
    await ensureZoneCanBeDisabled(existing.id, nextActive);
    const nextPostalCodes = req.validated.body.postalCodes ?? String(existing.postalCodes || '').split(',').filter(Boolean);
    await ensurePostalCodesUnique(nextPostalCodes, existing.id, nextActive);
    const data = normalizeDeliveryZoneData(req.validated.body, existing);
    const zone = await prisma.deliveryZone.update({ where: { id: existing.id }, data });
    await audit(req, 'DELIVERY_ZONE_UPDATED', 'DeliveryZone', zone.id, { name: zone.name, active: zone.active, feeCents: zone.feeCents, minimumOrderCents: zone.minimumOrderCents });
    res.json({ zone: serializeDeliveryZone(zone) });
  } catch (error) { next(error); }
});

router.delete('/delivery-zones/:id', async (req, res, next) => {
  try {
    const existing = await prisma.deliveryZone.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'DELIVERY_ZONE_NOT_FOUND', 'Delivery zone not found');
    await ensureZoneCanBeDisabled(existing.id, false);
    const zone = await prisma.deliveryZone.update({ where: { id: existing.id }, data: { active: false } });
    await audit(req, 'DELIVERY_ZONE_ARCHIVED', 'DeliveryZone', zone.id, { name: zone.name });
    res.status(204).end();
  } catch (error) { next(error); }
});


const fulfillmentSettingsUpdate = z.object({
  body: z.object({
    deliveryEnabled: z.boolean(),
    pickupEnabled: z.boolean(),
    asapEnabled: z.boolean(),
    scheduledEnabled: z.boolean(),
    deliveryLeadMinutes: z.number().int().min(0).max(720),
    pickupLeadMinutes: z.number().int().min(0).max(720),
    slotIntervalMinutes: z.number().int().min(15).max(180),
    daysAhead: z.number().int().min(1).max(30),
    defaultSlotCapacity: z.number().int().min(1).max(500),
    pickupAddress: z.union([z.string().trim().max(300), z.null()]).optional().transform(value => value || null),
    pickupInstructions: z.union([z.string().trim().max(500), z.null()]).optional().transform(value => value || null),
  }).refine(value => value.deliveryEnabled || value.pickupEnabled, 'Keep at least one fulfilment method enabled')
    .refine(value => value.asapEnabled || value.scheduledEnabled, 'Keep ASAP or scheduled ordering enabled'),
  params: empty,
  query: empty,
});

router.get('/fulfillment', async (_req, res, next) => {
  try { res.json(await getFulfillmentAdminConfig()); }
  catch (error) { next(error); }
});

router.patch('/fulfillment', validate(fulfillmentSettingsUpdate), async (req, res, next) => {
  try {
    const settings = await prisma.fulfillmentSetting.upsert({
      where: { id: 'default' },
      update: req.validated.body,
      create: { id: 'default', ...req.validated.body },
    });
    await audit(req, 'FULFILLMENT_SETTINGS_UPDATED', 'FulfillmentSetting', settings.id, req.validated.body);
    res.json(await getFulfillmentAdminConfig());
  } catch (error) { next(error); }
});

const slotOverrideSchema = z.object({
  body: z.object({
    dateKey: z.string().trim().refine(isRealDateKey, 'Use a valid YYYY-MM-DD date'),
    timeKey: hhmm,
    fulfillmentType: z.enum(['DELIVERY', 'PICKUP']),
    capacity: z.union([z.number().int().min(1).max(500), z.null()]).optional().default(null),
    disabled: z.boolean().default(false),
    note: z.union([z.string().trim().max(160), z.null()]).optional().transform(value => value || null),
  }),
  params: empty,
  query: empty,
});

router.post('/fulfillment/slot-overrides', validate(slotOverrideSchema), async (req, res, next) => {
  try {
    const values = req.validated.body;
    const override = await prisma.fulfillmentSlotOverride.upsert({
      where: { dateKey_timeKey_fulfillmentType: { dateKey: values.dateKey, timeKey: values.timeKey, fulfillmentType: values.fulfillmentType } },
      update: values,
      create: values,
    });
    await audit(req, 'FULFILLMENT_SLOT_OVERRIDE_SAVED', 'FulfillmentSlotOverride', override.id, values);
    res.status(201).json({ override });
  } catch (error) { next(error); }
});

router.delete('/fulfillment/slot-overrides/:id', async (req, res, next) => {
  try {
    const existing = await prisma.fulfillmentSlotOverride.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'SLOT_OVERRIDE_NOT_FOUND', 'Slot override not found');
    await prisma.fulfillmentSlotOverride.delete({ where: { id: existing.id } });
    await audit(req, 'FULFILLMENT_SLOT_OVERRIDE_REMOVED', 'FulfillmentSlotOverride', existing.id, { dateKey: existing.dateKey, timeKey: existing.timeKey, fulfillmentType: existing.fulfillmentType });
    res.status(204).end();
  } catch (error) { next(error); }
});

const loyaltyUpdate = z.object({
  body: z.object({
    enabled: z.boolean(),
    pointsPerOrder: z.number().int().min(0).max(100_000),
    minimumRedeemPoints: z.number().int().min(1).max(1_000_000),
    pointValueCents: z.number().int().min(1).max(10_000_000),
  }),
  params: empty,
  query: empty,
});

router.get('/loyalty', async (_req, res) => {
  const [settings, balanceAggregate, customerCount, transactionGroups] = await Promise.all([
    getLoyaltySettings(),
    prisma.user.aggregate({ where: { role: 'CUSTOMER' }, _sum: { pointsBalance: true } }),
    prisma.user.count({ where: { role: 'CUSTOMER', pointsBalance: { gt: 0 } } }),
    prisma.loyaltyTransaction.groupBy({ by: ['type'], _sum: { points: true }, _count: { type: true } }),
  ]);
  const byType = Object.fromEntries(transactionGroups.map(group => [group.type, group]));
  res.json({
    settings: { ...settings, currency: config.PAYMENT_CURRENCY },
    stats: {
      outstandingPoints: balanceAggregate._sum.pointsBalance || 0,
      customersWithPoints: customerCount,
      pointsEarned: byType.EARN?._sum.points || 0,
      pointsRedeemed: Math.abs(byType.REDEEM?._sum.points || 0),
      pointsRestored: byType.RESTORE?._sum.points || 0,
    },
  });
});

router.patch('/loyalty', validate(loyaltyUpdate), async (req, res, next) => {
  try {
    const settings = await prisma.loyaltySetting.upsert({
      where: { id: 'default' },
      update: req.validated.body,
      create: { id: 'default', ...req.validated.body },
    });
    await audit(req, 'LOYALTY_SETTINGS_UPDATED', 'LoyaltySetting', settings.id, req.validated.body);
    res.json({ settings: { ...settings, currency: config.PAYMENT_CURRENCY } });
  } catch (error) { next(error); }
});

router.get('/reviews', async (_req, res) => {
  const reviews = await prisma.review.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      product: { select: { id: true, name: true, imageUrl: true } },
      order: { select: { id: true, orderNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({ reviews });
});

router.patch('/reviews/:id', validate(z.object({
  body: z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']) }),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const review = await prisma.review.update({ where: { id: req.validated.params.id }, data: { status: req.validated.body.status } });
    await audit(req, 'REVIEW_MODERATED', 'Review', review.id, { status: review.status });
    res.json({ review });
  } catch (error) { next(error); }
});

router.delete('/reviews/:id', async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    await prisma.review.delete({ where: { id: review.id } });
    await audit(req, 'REVIEW_REMOVED_BY_ADMIN', 'Review', review.id, { productId: review.productId, userId: review.userId });
    res.status(204).end();
  } catch (error) { next(error); }
});

const couponFields = {
  code: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).transform(value => value.toUpperCase()),
  percentOff: z.number().int().min(1).max(100),
  minimumCents: z.number().int().nonnegative().max(100_000_000),
  active: z.boolean(),
  expiresAt: z.union([z.iso.datetime(), z.literal(''), z.null()]).optional().transform(value => value ? new Date(value) : null),
};

router.get('/coupons', async (_req, res) => {
  res.json({ coupons: await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }) });
});

router.post('/coupons', validate(z.object({ body: z.object(couponFields), params: empty, query: empty })), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.create({ data: req.validated.body });
    await audit(req, 'COUPON_CREATED', 'Coupon', coupon.id, { code: coupon.code });
    res.status(201).json({ coupon });
  } catch (error) { next(error); }
});

router.patch('/coupons/:id', validate(z.object({
  body: z.object(couponFields).partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
  params: z.object({ id: z.string().min(1) }),
  query: empty,
})), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.update({ where: { id: req.validated.params.id }, data: req.validated.body });
    await audit(req, 'COUPON_UPDATED', 'Coupon', coupon.id, req.validated.body);
    res.json({ coupon });
  } catch (error) { next(error); }
});

router.delete('/coupons/:id', async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data: { active: false } });
    await audit(req, 'COUPON_DISABLED', 'Coupon', coupon.id, { code: coupon.code });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/audit-logs', async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ logs });
});

const analyticsRangeFields = {
  days: z.coerce.number().int().refine(value => [7, 30, 90].includes(value), 'Use 7, 30, or 90 days').optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};
const analyticsRangeRefinement = (value, ctx) => {
  if ((value.from && !value.to) || (!value.from && value.to)) ctx.addIssue({ code: 'custom', message: 'Provide both from and to dates' });
  if (value.days && (value.from || value.to)) ctx.addIssue({ code: 'custom', message: 'Use either a preset day range or custom dates, not both' });
};
const analyticsRangeQuery = z.object(analyticsRangeFields).superRefine(analyticsRangeRefinement);
const analyticsExportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/analytics', validate(z.object({ body: empty, params: empty, query: analyticsRangeQuery })), async (req, res, next) => {
  try {
    const analytics = await getAdminAnalytics(req.validated.query);
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.json(analytics);
  } catch (error) { next(error); }
});

router.get('/analytics/export', analyticsExportLimiter, validate(z.object({
  body: empty,
  params: empty,
  query: z.object({ ...analyticsRangeFields, type: z.enum(['daily-sales', 'orders', 'products', 'customers']) }).superRefine(analyticsRangeRefinement),
})), async (req, res, next) => {
  try {
    const { type, ...range } = req.validated.query;
    const result = await getAdminAnalyticsCsv(type, range);
    await audit(req, 'ANALYTICS_CSV_EXPORTED', 'Analytics', type, { type, range: result.range, rowCount: result.rowCount });
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.csv);
  } catch (error) { next(error); }
});

router.get('/dashboard', async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [customers, orders, products, wishlistSaves, revenue, todayOrders, pendingOrders, lowStockRows, recentOrders, statusGroups, deliveredThisWeek, topItems, storeStatus] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count(),
    prisma.product.count({ where: { isAvailable: true } }),
    prisma.wishlistItem.count(),
    prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { totalCents: true } }),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] } } }),
    prisma.product.findMany({ where: { isAvailable: true }, select: { stock: true, lowStockThreshold: true } }),
    prisma.order.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.order.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.order.findMany({ where: { status: 'DELIVERED', createdAt: { gte: sevenDaysAgo } }, select: { totalCents: true, createdAt: true } }),
    prisma.orderItem.groupBy({ by: ['productName'], _sum: { quantity: true, lineTotalCents: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5 }),
    getStoreAvailability(),
  ]);

  const revenueByDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo);
    date.setDate(date.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      revenueCents: deliveredThisWeek.filter(order => order.createdAt.toISOString().slice(0, 10) === key).reduce((sum, order) => sum + order.totalCents, 0),
    };
  });

  const lowStock = lowStockRows.filter(product => product.stock <= product.lowStockThreshold).length;

  res.json({
    metrics: { customers, orders, products, wishlistSaves, revenueCents: revenue._sum.totalCents || 0, todayOrders, pendingOrders, lowStock },
    recentOrders: recentOrders.map(stripOrderSecrets),
    ordersByStatus: statusGroups.map(group => ({ status: group.status, count: group._count.status })),
    revenueByDay,
    topProducts: topItems.map(item => ({ name: item.productName, quantity: item._sum.quantity || 0, revenueCents: item._sum.lineTotalCents || 0 })),
    storeStatus,
  });
});


router.get('/notifications', async (_req, res) => {
  const [byStatus, byChannel, subscriptionCount, recent] = await Promise.all([
    prisma.notificationDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.notificationDelivery.groupBy({ by: ['channel'], _count: { _all: true } }),
    prisma.pushSubscription.count(),
    prisma.notificationDelivery.findMany({
      include: { user: { select: { id: true, name: true, email: true } }, order: { select: { id: true, orderNumber: true } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    }),
  ]);
  res.json({
    capabilities: notificationCapabilities(),
    subscriptionCount,
    byStatus: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])),
    byChannel: Object.fromEntries(byChannel.map(row => [row.channel, row._count._all])),
    recent,
  });
});

router.post('/notifications/process', async (req, res, next) => {
  try {
    const result = await processPendingNotifications({ limit: 50 });
    await audit(req, 'NOTIFICATION_QUEUE_PROCESSED', 'NotificationDelivery', null, result);
    res.json(result);
  } catch (error) { next(error); }
});

router.post('/notifications/:id/retry', async (req, res, next) => {
  try {
    const existing = await prisma.notificationDelivery.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification delivery not found');
    if (existing.status === 'SENT') throw new AppError(409, 'NOTIFICATION_ALREADY_SENT', 'This notification was already sent');
    const delivery = await retryNotificationDelivery(existing.id);
    await audit(req, 'NOTIFICATION_RETRY_QUEUED', 'NotificationDelivery', delivery.id, { channel: delivery.channel, eventType: delivery.eventType });
    res.json({ delivery });
  } catch (error) { next(error); }
});

export default router;
