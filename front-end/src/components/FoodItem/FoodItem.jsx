import { useContext } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency } from '../../lib/format';
import Icon from '../ui/Icon';
import './FoodItem.css';

export default function FoodItem({ item }) {
  const { cartItems, addToCart, removeFromCart } = useContext(StoreContext);
  const quantity = cartItems[item._id] || 0;
  return <article className="food-card">
    <div className="food-card-media">
      <img src={item.image} alt={item.name} loading="lazy" />
      <span className="food-category">{item.category}</span>
      <span className="food-rating" aria-label="Rated 4.8 out of 5">★ 4.8</span>
    </div>
    <div className="food-card-body">
      <div className="food-card-heading"><h3>{item.name}</h3><strong>{formatCurrency(item.price)}</strong></div>
      <p>{item.description}</p>
      <div className="food-card-footer">
        <span className="delivery-time"><Icon name="clock" size={16} />20–30 min</span>
        {quantity === 0 ? <button className="add-button" onClick={() => addToCart(item._id)} aria-label={`Add ${item.name} to cart`}><Icon name="plus" size={18} />Add</button>
          : <div className="quantity-control" aria-label={`${item.name} quantity`}>
            <button onClick={() => removeFromCart(item._id)} aria-label={`Remove one ${item.name}`}><Icon name="minus" size={16} /></button>
            <strong aria-live="polite">{quantity}</strong>
            <button onClick={() => addToCart(item._id)} aria-label={`Add one ${item.name}`}><Icon name="plus" size={16} /></button>
          </div>}
      </div>
    </div>
  </article>;
}
