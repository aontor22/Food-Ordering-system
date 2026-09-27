export function defaultSelectionsForProduct(product) {
  return (product?.optionGroups || []).map(group => {
    const available = (group.options || []).filter(option => option.isAvailable !== false);
    const defaults = available.filter(option => option.isDefault).map(option => option.id);
    const minimum = Math.max(0, Number(group.minSelections) || 0);
    const max = Math.max(1, Number(group.maxSelections) || 1);
    const fallback = defaults.length ? defaults : minimum > 0 ? available.slice(0, minimum).map(option => option.id) : [];
    return { groupId: group.id, optionIds: fallback.slice(0, max) };
  }).filter(selection => selection.optionIds.length);
}

export function normalizeSelections(selections = []) {
  return selections
    .filter(selection => selection?.groupId)
    .map(selection => ({ groupId: selection.groupId, optionIds: [...new Set(selection.optionIds || [])].sort() }))
    .filter(selection => selection.optionIds.length)
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
}

export function cartLineFingerprint({ productId, selections = [], specialInstructions = '' }) {
  return JSON.stringify({ productId, selections: normalizeSelections(selections), specialInstructions: String(specialInstructions || '').trim() });
}

export function productUnitPriceCents(product, selections = []) {
  if (!product) return 0;
  let cents = Number(product.priceCents) || 0;
  const selected = new Map(normalizeSelections(selections).map(selection => [selection.groupId, new Set(selection.optionIds)]));
  for (const group of product.optionGroups || []) {
    const ids = selected.get(group.id);
    if (!ids) continue;
    for (const option of group.options || []) if (ids.has(option.id)) cents += Number(option.priceDeltaCents) || 0;
  }
  return cents;
}

export function customizationDetails(product, selections = []) {
  const selected = new Map(normalizeSelections(selections).map(selection => [selection.groupId, new Set(selection.optionIds)]));
  const details = [];
  for (const group of product?.optionGroups || []) {
    const ids = selected.get(group.id);
    if (!ids?.size) continue;
    const options = (group.options || []).filter(option => ids.has(option.id));
    if (options.length) details.push({ groupId: group.id, groupName: group.name, kind: group.kind, options });
  }
  return details;
}

export function customizationSummary(product, selections = []) {
  return customizationDetails(product, selections)
    .map(group => `${group.groupName}: ${group.options.map(option => option.name).join(', ')}`)
    .join(' · ');
}

export function validateProductSelections(product, selections = []) {
  const selected = new Map(normalizeSelections(selections).map(selection => [selection.groupId, selection.optionIds]));
  for (const group of product?.optionGroups || []) {
    const count = selected.get(group.id)?.length || 0;
    const min = Number(group.minSelections) || 0;
    const max = Number(group.maxSelections) || 1;
    if (count < min) return `Choose ${min === 1 ? 'an option' : `at least ${min} options`} for ${group.name}.`;
    if (count > max) return `Choose no more than ${max} option${max === 1 ? '' : 's'} for ${group.name}.`;
  }
  return '';
}
