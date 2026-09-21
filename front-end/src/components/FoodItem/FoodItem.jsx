import { useContext, useState } from 'react';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency, formatDate } from '../../lib/format';
import { api } from '../../lib/api';
import Icon from '../ui/Icon';
import './FoodItem.css';

export default function FoodItem({ item }) {
  const { cartItems, addToCart, removeFromCart } = useContext(StoreContext);
  const quantity = cartItems[item._id] || 0;
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  const openReviews = async () => {
    setShowReviews(true);
    if (reviews) return;
    setReviewLoading(true); setReviewError('');
    try { setReviews(await api.getProductReviews(item._id)); }
    catch (error) { setReviewError(error.message); }
    finally { setReviewLoading(false); }
  };

  const ratingLabel = item.reviewCount ? `${Number(item.reviewRating).toFixed(1)} (${item.reviewCount})` : 'No reviews';

  return <>
    <article className="food-card">
      <div className="food-card-media">
        <img src={item.image} alt={item.name} loading="lazy" />
        <span className="food-category">{item.category}</span>
        <button className="food-rating" type="button" onClick={openReviews} aria-label={`${item.name}: ${ratingLabel}. View reviews`}><span>★</span>{item.reviewCount ? `${Number(item.reviewRating).toFixed(1)} · ${item.reviewCount}` : 'New'}</button>
      </div>
      <div className="food-card-body">
        <div className="food-card-heading"><h3>{item.name}</h3><strong>{formatCurrency(item.price)}</strong></div>
        <p>{item.description}</p>
        <div className="food-card-footer">
          <div className="food-card-meta"><span className="delivery-time"><Icon name="clock" size={16} />20–30 min</span><button className="food-review-link" type="button" onClick={openReviews}>{item.reviewCount ? `${item.reviewCount} review${item.reviewCount === 1 ? '' : 's'}` : 'No reviews yet'}</button></div>
          {quantity === 0 ? <button className="add-button" onClick={() => addToCart(item._id)} aria-label={`Add ${item.name} to cart`}><Icon name="plus" size={18} />Add</button>
            : <div className="quantity-control" aria-label={`${item.name} quantity`}>
              <button onClick={() => removeFromCart(item._id)} aria-label={`Remove one ${item.name}`}><Icon name="minus" size={16} /></button>
              <strong aria-live="polite">{quantity}</strong>
              <button onClick={() => addToCart(item._id)} aria-label={`Add one ${item.name}`}><Icon name="plus" size={16} /></button>
            </div>}
        </div>
      </div>
    </article>
    {showReviews && <div className="food-reviews-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && setShowReviews(false)}>
      <section className="food-reviews-modal" role="dialog" aria-modal="true" aria-labelledby={`reviews-${item._id}`}>
        <header><div><span>{item.category}</span><h2 id={`reviews-${item._id}`}>{item.name} reviews</h2>{reviews?.reviewCount > 0 && <p><strong>★ {reviews.averageRating.toFixed(1)}</strong> from {reviews.reviewCount} verified order review{reviews.reviewCount === 1 ? '' : 's'}</p>}</div><button type="button" onClick={() => setShowReviews(false)} aria-label="Close reviews"><Icon name="close" /></button></header>
        <div className="food-reviews-body">
          {reviewLoading && <p className="reviews-state">Loading reviews…</p>}
          {reviewError && <p className="form-error">{reviewError}</p>}
          {!reviewLoading && reviews && !reviews.reviews.length && <div className="reviews-state"><Icon name="star" size={28} /><strong>No reviews yet</strong><p>Customers can review this dish after a delivered order.</p></div>}
          {reviews?.reviews.map(review => <article className="public-review" key={review.id}><div><strong>{review.user.name}</strong><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><small>{formatDate(review.createdAt)}</small>{review.comment && <p>{review.comment}</p>}</article>)}
        </div>
      </section>
    </div>}
  </>;
}
