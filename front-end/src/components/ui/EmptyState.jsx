import { Link } from 'react-router-dom';

export default function EmptyState({ icon = '🍽️', title, text, action = 'Browse the menu', to = '/' }) {
  return <div className="empty-state surface-card"><span className="empty-state-icon" aria-hidden="true">{icon}</span><h1>{title}</h1><p>{text}</p><Link className="button button-primary" to={to}>{action}</Link></div>;
}
