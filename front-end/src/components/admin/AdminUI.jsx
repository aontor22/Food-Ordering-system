import { useEffect } from 'react';
import Icon from '../ui/Icon';
import { humanizeStatus } from '../../lib/format';

export function AdminPageHeader({ eyebrow, title, description, action }) {
  return <div className="admin-page-header">
    <div><span>{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>
    {action}
  </div>;
}

export function StatusBadge({ value }) {
  return <span className={`status-badge status-${String(value).toLowerCase()}`}><i />{humanizeStatus(value)}</span>;
}

export function AdminModal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    document.body.classList.add('modal-open');
    const close = event => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => { document.body.classList.remove('modal-open'); document.removeEventListener('keydown', close); };
  }, [onClose]);

  return <div className="admin-modal-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
      <header><div><h2 id="admin-modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
      {children}
    </section>
  </div>;
}

export function AdminLoading({ label = 'Loading data…' }) {
  return <div className="admin-state"><div className="admin-loader" /><p>{label}</p></div>;
}

export function AdminError({ message, retry }) {
  return <div className="admin-state is-error"><Icon name="alert" size={26} /><h3>Something went wrong</h3><p>{message}</p>{retry && <button className="button button-secondary" onClick={retry}><Icon name="refresh" />Try again</button>}</div>;
}

export function AdminEmpty({ icon = 'products', title, text }) {
  return <div className="admin-state"><Icon name={icon} size={28} /><h3>{title}</h3><p>{text}</p></div>;
}
