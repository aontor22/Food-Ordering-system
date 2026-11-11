import { useState } from 'react';
import { api } from '../../lib/api';
import Icon from '../ui/Icon';
import './OrderDocuments.css';

export default function OrderDocuments({ order, guestToken = '', admin = false, compact = false }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!order?.id) return null;

  const receiptAvailable = order.documents?.receipt?.available ?? ['PAID', 'REFUNDED'].includes(String(order.paymentStatus || '').toUpperCase());

  const run = async (type, mode) => {
    const key = `${type}:${mode}`;
    setBusy(key); setError('');
    try {
      if (admin) {
        if (mode === 'print') await api.printAdminOrderDocument(order.id, type);
        else await api.downloadAdminOrderDocument(order.id, type);
      } else if (guestToken) {
        if (mode === 'print') await api.printGuestOrderDocument(type, guestToken);
        else await api.downloadGuestOrderDocument(type, guestToken);
      } else {
        if (mode === 'print') await api.printOrderDocument(order.id, type);
        else await api.downloadOrderDocument(order.id, type);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(''); }
  };

  const DocumentRow = ({ type, available, note }) => <div className="order-document-row">
    <div className="order-document-copy"><span className={`order-document-icon is-${type}`}><Icon name="orders" size={17} /></span><div><strong>{type === 'invoice' ? 'Invoice' : 'Payment receipt'}</strong><small>{available ? (type === 'invoice' ? 'Order billing summary' : 'Proof of recorded payment') : note}</small></div></div>
    <div className="order-document-actions">
      <button type="button" className="button button-secondary button-small" disabled={!available || Boolean(busy)} onClick={() => run(type, 'print')}><Icon name="eye" size={15} />{busy === `${type}:print` ? 'Opening…' : 'Print / PDF'}</button>
      <button type="button" className="button button-secondary button-small" disabled={!available || Boolean(busy)} onClick={() => run(type, 'download')}><Icon name="download" size={15} />{busy === `${type}:download` ? 'Saving…' : 'Download'}</button>
    </div>
  </div>;

  return <section className={`order-documents ${compact ? 'is-compact' : ''}`}>
    {!compact && <div className="order-documents-heading"><div><span className="section-kicker">Documents</span><h3>Invoice & receipt</h3></div><small>Print directly or use your browser’s Save as PDF option.</small></div>}
    <DocumentRow type="invoice" available note="" />
    <DocumentRow type="receipt" available={receiptAvailable} note="Available after payment is recorded" />
    {error && <p className="order-document-error" role="alert">{error}</p>}
  </section>;
}
