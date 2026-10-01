import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/format';
import { defaultSelectionsForProduct, normalizeSelections, optionIsOrderable, productUnitPriceCents, selectedConfigurationLimit, validateProductSelections } from '../../lib/productCustomizations';
import Icon from '../ui/Icon';
import './ProductCustomizer.css';

function initialSelectionMap(product, line) {
  const source = line?.selections?.length ? line.selections : defaultSelectionsForProduct(product);
  return Object.fromEntries(source.map(selection => [selection.groupId, [...selection.optionIds]]));
}

export default function ProductCustomizer({ product, line = null, maxQuantity = 20, reservedOptionQuantity = () => 0, onClose, onSave }) {
  const [selections, setSelections] = useState(() => initialSelectionMap(product, line));
  const [specialInstructions, setSpecialInstructions] = useState(line?.specialInstructions || '');
  const safeMaxQuantity = Math.max(0, Math.min(1000, Number(maxQuantity) || 0));
  const [quantity, setQuantity] = useState(Math.max(1, Math.min(Math.max(1, safeMaxQuantity), Number(line?.quantity) || 1)));
  const [error, setError] = useState('');

  const normalized = useMemo(() => normalizeSelections(Object.entries(selections).map(([groupId, optionIds]) => ({ groupId, optionIds }))), [selections]);
  const unitPriceCents = useMemo(() => productUnitPriceCents(product, normalized), [product, normalized]);
  const configurationLimit = useMemo(
    () => Math.min(safeMaxQuantity, selectedConfigurationLimit(product, normalized, reservedOptionQuantity)),
    [product, normalized, safeMaxQuantity, reservedOptionQuantity],
  );

  useEffect(() => {
    if (configurationLimit > 0) setQuantity(value => Math.min(Math.max(1, value), configurationLimit));
  }, [configurationLimit]);

  const selectOption = (group, option, checked) => {
    if (option && !optionIsOrderable(option)) { setError(`${option.name} is currently sold out.`); return; }
    const optionId = option?.id || '';
    setError('');
    setSelections(previous => {
      const current = previous[group.id] || [];
      let next;
      if (group.kind === 'VARIANT') next = optionId ? [optionId] : [];
      else if (checked) {
        if (current.length >= group.maxSelections) {
          setError(`Choose no more than ${group.maxSelections} option${group.maxSelections === 1 ? '' : 's'} for ${group.name}.`);
          return previous;
        }
        next = [...new Set([...current, optionId])];
      } else next = current.filter(id => id !== optionId);
      return { ...previous, [group.id]: next };
    });
  };

  const save = () => {
    const validation = validateProductSelections(product, normalized);
    if (validation) { setError(validation); return; }
    if (configurationLimit <= 0) { setError('This configuration is sold out. Choose another option.'); return; }
    if (quantity > configurationLimit) { setError(`Only ${configurationLimit} available for this configuration.`); return; }
    onSave({
      ...(line?.lineId ? { lineId: line.lineId } : {}),
      productId: product._id || product.id,
      quantity,
      selections: normalized,
      specialInstructions: specialInstructions.trim(),
    });
  };

  return <div className="customizer-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="product-customizer" role="dialog" aria-modal="true" aria-labelledby={`customizer-${product._id || product.id}`}>
      <header className="customizer-head">
        <div className="customizer-product">
          {product.image && <img src={product.image} alt="" />}
          <div><span>{product.category}</span><h2 id={`customizer-${product._id || product.id}`}>{product.name}</h2><p>Base price {formatCurrency(product.priceCents / 100)}</p></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close customization"><Icon name="close" /></button>
      </header>

      <div className="customizer-body">
        {(product.optionGroups || []).map(group => <fieldset className="customizer-group" key={group.id}>
          <legend><span>{group.name}</span><small>{group.minSelections > 0 ? 'Required' : 'Optional'}{group.maxSelections > 1 ? ` · choose up to ${group.maxSelections}` : ''}</small></legend>
          <div className="customizer-options">
            {group.kind === 'VARIANT' && group.minSelections === 0 && <label className={`customizer-option ${(selections[group.id] || []).length === 0 ? 'is-selected' : ''}`}>
              <input type="radio" name={`customizer-${group.id}`} checked={(selections[group.id] || []).length === 0} onChange={() => selectOption(group, null, true)} />
              <span className="customizer-control" /><strong>No preference</strong><small>Included</small>
            </label>}
            {(group.options || []).map(option => {
              const selected = (selections[group.id] || []).includes(option.id);
              const inputType = group.kind === 'VARIANT' ? 'radio' : 'checkbox';
              const orderable = optionIsOrderable(option);
              const stockCopy = option.trackStock
                ? option.stock <= 0 ? 'Sold out' : option.stock <= option.lowStockThreshold ? `Only ${option.stock} left` : null
                : null;
              return <label className={`customizer-option ${selected ? 'is-selected' : ''} ${!orderable ? 'is-disabled' : ''}`} key={option.id}>
                <input
                  type={inputType}
                  name={`customizer-${group.id}`}
                  checked={selected}
                  disabled={!orderable}
                  onChange={event => selectOption(group, option, event.target.checked)}
                />
                <span className="customizer-control" />
                <strong>{option.name}</strong>
                <small>{stockCopy || (option.priceDeltaCents > 0 ? `+${formatCurrency(option.priceDeltaCents / 100)}` : 'Included')}</small>
              </label>;
            })}
          </div>
        </fieldset>)}

        <div className="customizer-instructions">
          <label htmlFor="special-instructions">Special instructions <span>(optional)</span></label>
          <textarea id="special-instructions" maxLength="300" value={specialInstructions} onChange={event => setSpecialInstructions(event.target.value)} placeholder="e.g. no onions, sauce on the side, less spicy" />
          <small>{specialInstructions.length}/300 · Requests are sent to the kitchen but cannot guarantee allergen-free preparation.</small>
        </div>
        {configurationLimit > 0 && configurationLimit <= 5 && <p className="customizer-stock-note"><Icon name="alert" size={15} />Only {configurationLimit} available for this configuration.</p>}
        {configurationLimit <= 0 && <p className="form-error" role="alert">This configuration is sold out. Choose another option.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>

      <footer className="customizer-footer">
        <div className="customizer-quantity" aria-label="Quantity">
          <button type="button" onClick={() => setQuantity(value => Math.max(1, value - 1))} disabled={quantity <= 1 || configurationLimit <= 0}><Icon name="minus" size={15} /></button>
          <strong>{quantity}</strong>
          <button type="button" onClick={() => setQuantity(value => Math.min(configurationLimit, value + 1))} disabled={configurationLimit <= 0 || quantity >= configurationLimit}><Icon name="plus" size={15} /></button>
        </div>
        <button className="button button-primary customizer-add" type="button" onClick={save} disabled={configurationLimit <= 0}><span>{line ? 'Update item' : 'Add to cart'}</span><strong>{formatCurrency(unitPriceCents * quantity / 100)}</strong></button>
      </footer>
    </section>
  </div>;
}
