import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import Icon from '../../components/ui/Icon';
import { AdminEmpty, AdminError, AdminLoading, AdminPageHeader, StatusBadge } from '../../components/admin/AdminUI';

export default function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setReviews((await api.getAdminReviews()).reviews); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => reviews.filter(review => {
    const haystack = `${review.product?.name || ''} ${review.user?.name || ''} ${review.user?.email || ''} ${review.comment || ''} ${review.order?.orderNumber || ''}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (status === 'ALL' || review.status === status);
  }), [reviews, search, status]);

  const moderate = async (review, nextStatus) => {
    setBusy(review.id); setError('');
    try {
      const { review: updated } = await api.updateAdminReview(review.id, nextStatus);
      setReviews(previous => previous.map(item => item.id === review.id ? { ...item, ...updated } : item));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const remove = async review => {
    if (!window.confirm(`Permanently remove this review for ${review.product?.name || 'this product'}?`)) return;
    setBusy(review.id); setError('');
    try { await api.deleteAdminReview(review.id); setReviews(previous => previous.filter(item => item.id !== review.id)); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  if (loading) return <AdminLoading label="Loading food reviews…" />;
  if (error && !reviews.length) return <AdminError message={error} retry={load} />;

  const published = reviews.filter(review => review.status === 'PUBLISHED').length;
  return <>
    <AdminPageHeader eyebrow="Customer feedback" title={`${reviews.length} food reviews`} description={`${published} reviews are currently visible on the storefront. Only customers with delivered orders can submit reviews.`} action={<button className="button button-secondary" onClick={load}><Icon name="refresh" />Refresh</button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="admin-toolbar">
      <label className="admin-search"><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product, customer, order or comment…" aria-label="Search reviews" /></label>
      <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter review status"><option value="ALL">All reviews</option><option value="PUBLISHED">Published</option><option value="HIDDEN">Hidden</option></select>
    </div>
    <section className="admin-card">
      {visible.length ? <div className="admin-table-wrap"><table className="admin-table review-admin-table"><thead><tr><th>Review</th><th>Product</th><th>Customer</th><th>Order</th><th>Status</th><th className="align-right">Actions</th></tr></thead>
        <tbody>{visible.map(review => <tr key={review.id}>
          <td className="review-copy-cell"><div className="admin-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}<span>{'★'.repeat(5 - review.rating)}</span></div>{review.comment ? <p>{review.comment}</p> : <small>No written comment</small>}<small>{formatDate(review.createdAt)}</small></td>
          <td><strong>{review.product?.name || 'Product'}</strong></td>
          <td><strong>{review.user?.name || 'Customer'}</strong><small>{review.user?.email}</small></td>
          <td><strong>{review.order?.orderNumber || '—'}</strong></td>
          <td><StatusBadge value={review.status} /></td>
          <td><div className="admin-table-actions">{review.status === 'PUBLISHED' ? <button className="button button-small button-secondary" disabled={busy === review.id} onClick={() => moderate(review, 'HIDDEN')}>Hide</button> : <button className="button button-small button-primary" disabled={busy === review.id} onClick={() => moderate(review, 'PUBLISHED')}>Publish</button>}<button className="admin-icon-action is-danger" disabled={busy === review.id} onClick={() => remove(review)} title="Delete review" aria-label="Delete review"><Icon name="trash" size={17} /></button></div></td>
        </tr>)}</tbody>
      </table></div> : <AdminEmpty icon="star" title="No matching reviews" text="Delivered-order reviews will appear here for moderation." />}
    </section>
  </>;
}
