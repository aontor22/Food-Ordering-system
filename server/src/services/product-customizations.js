import { AppError } from '../lib/errors.js';

export const publicProductCustomizationInclude = {
  optionGroups: {
    where: { isAvailable: true },
    include: { options: { where: { isAvailable: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
};

export const adminProductCustomizationInclude = {
  optionGroups: {
    include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
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
    if (quantity > 20) throw new AppError(400, 'MAX_PRODUCT_QUANTITY', 'A product quantity cannot exceed 20 per order');
    const product = productMap.get(productId);
    if (product.stock < quantity) throw new AppError(409, 'INSUFFICIENT_STOCK', `${product.name} has insufficient stock`);
  }

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
        customizationTotalCents += option.priceDeltaCents;
        return { optionId: option.id, name: option.name, priceDeltaCents: option.priceDeltaCents };
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

  return { products, productMap, quantities, lines };
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
  return {
    ...product,
    optionGroups: (product.optionGroups || []).map(group => ({
      ...group,
      options: (group.options || []).map(option => ({ ...option })),
    })),
  };
}
