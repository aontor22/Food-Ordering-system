import { formatCurrency } from '../../lib/format';
import Icon from '../ui/Icon';

export default function OrderItemCustomization({ item, currency, compact = false }) {
  const groups = Array.isArray(item?.customizations) ? item.customizations : [];
  if (!groups.length && !item?.specialInstructions) return null;
  return <div className={`order-item-customization ${compact ? 'is-compact' : ''}`}>
    {groups.map(group => <div key={group.groupId || group.groupName} className="order-item-customization-group">
      <strong>{group.groupName}</strong>
      <span>{(group.options || []).map(option => <span key={option.optionId || option.name}>{option.name}{option.priceDeltaCents > 0 ? ` (+${formatCurrency(option.priceDeltaCents / 100, currency)})` : ''}</span>)}</span>
    </div>)}
    {item.specialInstructions && <p><Icon name="edit" size={13} /><span><strong>Kitchen note:</strong> {item.specialInstructions}</span></p>}
  </div>;
}
