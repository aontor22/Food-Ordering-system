import { AppError } from '../lib/errors.js';
import { parseOrderItemCustomizations, resolveCustomizedCartLines } from './product-customizations.js';

function toCartLine(item) {
  const selections = parseOrderItemCustomizations(item.customizationsJson)
    .map(group => ({
      groupId: group.groupId,
      optionIds: (group.options || []).map(option => option.optionId).filter(Boolean),
    }))
    .filter(selection => selection.groupId && selection.optionIds.length);
  return {
    productId: item.productId,
    quantity: item.quantity,
    selections,
    ...(item.specialInstructions ? { specialInstructions: item.specialInstructions } : {}),
  };
}

function reorderIssue(item, error) {
  return {
    orderItemId: item.id,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    code: error.code || 'ITEM_UNAVAILABLE',
    message: error.message || `${item.productName} is not available for reorder`,
  };
}

function isAvailabilityError(error) {
  return error instanceof AppError && Number(error.status) >= 400 && Number(error.status) < 500;
}

export async function prepareReorderCart(db, order) {
  const sourceItems = (order.items || []).slice(0, 50);
  if (!sourceItems.length) return { cartItems: [], skippedItems: [], status: 'EMPTY' };
  const candidates = sourceItems.map(toCartLine);

  try {
    await resolveCustomizedCartLines(db, candidates);
    return { cartItems: candidates, skippedItems: [], status: 'FULL' };
  } catch (error) {
    if (!isAvailabilityError(error)) throw error;
  }

  const accepted = [];
  const skippedItems = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const sourceItem = sourceItems[index];
    const candidate = candidates[index];
    try {
      await resolveCustomizedCartLines(db, [...accepted, candidate]);
      accepted.push(candidate);
    } catch (error) {
      if (!isAvailabilityError(error)) throw error;
      skippedItems.push(reorderIssue(sourceItem, error));
    }
  }

  return {
    cartItems: accepted,
    skippedItems,
    status: accepted.length ? 'PARTIAL' : 'UNAVAILABLE',
  };
}
