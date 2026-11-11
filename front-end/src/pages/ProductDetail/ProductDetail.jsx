import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { StoreContext } from '../../context/StoreContext';
import { formatCurrency, formatDate } from '../../lib/format';
import { dietaryLabels } from '../../lib/productDiscovery';
import { productPurchaseLimit } from '../../lib/productCustomizations';
import { applySeo, productJsonLd } from '../../lib/seo';
import ProductCustomizer from '../../components/ProductCustomizer/ProductCustomizer';
import Icon from '../../components/ui/Icon';
import './ProductDetail.css';

function productImageUrl(imageUrl) {
  const legacy = typeof imageUrl === 'string' && imageUrl.match(/^\/food_(\d+)\.(?:png|jpe?g|webp|avif)$/i);
  return legacy ? `/seed-food/food_${legacy[1]}.webp` : imageUrl || '/favicon-512.png';
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { cartProductQuantity, cartOptionQuantity, addToCart, isWishlisted, toggleWishlist, wishlistBusy } = useContext(StoreContext);
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [wishlistError, setWishlistError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setProduct(null); setReviews(null);
    api.getProductBySlug(slug).then(data => {
      if (!active) return;
      const next = { ...data.product, _id: data.product.id, image: productImageUrl(data.product.imageUrl), price: data.product.price ?? data.product.priceCents / 100 };
      setProduct(next);
      return api.getProductReviews(next.id).then(value => { if (active) setReviews(value); }).catch(() => {});
    }).catch(requestError => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!error) return;
    applySeo({ title: 'Dish unavailable — Tomato', description: 'This Tomato menu item is not currently available.', canonicalPath: `/menu/${slug}`, robots: 'noindex,follow' });
  }, [error, slug]);

  useEffect(() => {
    if (!product) return;
    const description = String(product.description || '').slice(0, 160);
    applySeo({
      title: `${product.name} — Order from Tomato`,
      description,
      canonicalPath: `/menu/${product.slug}`,
      image: product.image,
      type: 'product',
      robots: 'index,follow,max-image-preview:large',
      jsonLd: productJsonLd(product),
    });
  }, [product]);

  const quantity = product ? cartProductQuantity(product.id) : 0;
  const purchaseLimit = product ? productPurchaseLimit(product) : 0;
  const soldOut = purchaseLimit <= 0;
  const labels = useMemo(() => product ? dietaryLabels(product) : [], [product]);

  const toggleSaved = async () => {
    if (!product) return;
    setWishlistError('');
    try { await toggleWishlist(product); }
    catch (requestError) { setWishlistError(requestError.message); }
  };

  if (loading) return <section className="product-detail-shell"><div className="product-detail-loading"><span className="mini-spinner" /><p>Loading dish…</p></div></section>;
  if (error || !product) return <section className="product-detail-shell"><div className="product-detail-error"><Icon name="alert" size={28} /><h1>Dish unavailable</h1><p>{error || 'This menu item is not currently available.'}</p><Link className="button button-primary" to="/#dishes">Back to menu</Link></div></section>;

  return <>
    <section className="product-detail-shell">
      <nav className="product-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/#dishes">Menu</Link><span>/</span><span>{product.name}</span></nav>
      <div className="product-detail-grid">
        <div className="product-detail-media"><img src={product.image} alt={product.name} /><span>{product.category}</span></div>
        <div className="product-detail-copy">
          <div className="product-detail-kicker">{product.category}</div>
          <div className="product-detail-title-row"><h1>{product.name}</h1><button type="button" className={`product-detail-save ${isWishlisted(product.id) ? 'is-saved' : ''}`} onClick={toggleSaved} disabled={wishlistBusy.includes(product.id)} aria-pressed={isWishlisted(product.id)}><Icon name={isWishlisted(product.id) ? 'heartFilled' : 'heart'} />{isWishlisted(product.id) ? 'Saved' : 'Save'}</button></div>
          <div className="product-detail-rating"><span>★</span><strong>{product.reviewCount ? Number(product.reviewRating).toFixed(1) : 'New'}</strong>{product.reviewCount > 0 && <span>{product.reviewCount} verified review{product.reviewCount === 1 ? '' : 's'}</span>}</div>
          <p className="product-detail-description">{product.description}</p>
          {labels.length > 0 && <div className="product-detail-tags" aria-label="Dietary information">{labels.map(label => <span key={label}>{label}</span>)}</div>}
          <div className="product-detail-price"><small>From</small><strong>{formatCurrency(product.price)}</strong></div>
          <div className="product-detail-availability"><Icon name={soldOut ? 'alert' : 'check'} /><span>{soldOut ? 'Currently sold out' : product.stockStatus === 'LOW_STOCK' ? `Only ${product.stock} left today` : 'Available to order'}</span></div>
          {wishlistError && <p className="form-error" role="alert">{wishlistError}</p>}
          <button className="button button-primary product-detail-order" type="button" disabled={soldOut || quantity >= purchaseLimit} onClick={() => setShowCustomizer(true)}><Icon name={soldOut ? 'alert' : 'plus'} />{soldOut ? 'Sold out' : quantity >= purchaseLimit ? 'Maximum quantity in cart' : quantity ? `Customize another · ${quantity} in cart` : 'Customize & add to cart'}</button>
          <p className="product-detail-note"><Icon name="clock" size={16} />Prepared after you order · Delivery or pickup available</p>
        </div>
      </div>

      <section className="product-detail-reviews" aria-labelledby="product-reviews-title">
        <div><div className="section-kicker">Verified purchases</div><h2 id="product-reviews-title">Customer reviews</h2></div>
        {!reviews?.reviews?.length ? <p className="product-review-empty">No verified reviews yet.</p> : <div className="product-review-list">{reviews.reviews.slice(0, 8).map(review => <article key={review.id}><div><strong>{review.user.name}</strong><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><small>{formatDate(review.createdAt)}</small>{review.comment && <p>{review.comment}</p>}</article>)}</div>}
      </section>
    </section>
    {showCustomizer && <ProductCustomizer product={product} maxQuantity={Math.max(0, purchaseLimit - quantity)} reservedOptionQuantity={optionId => cartOptionQuantity(optionId)} onClose={() => setShowCustomizer(false)} onSave={line => { addToCart(line); setShowCustomizer(false); }} />}
  </>;
}
