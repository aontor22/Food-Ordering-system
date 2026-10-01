import { useContext } from 'react';
import { PwaContext } from '../../context/PwaContext';
import Icon from '../ui/Icon';
import './PwaStatus.css';

export default function PwaStatus() {
  const { isOnline, showInstallHelp, setShowInstallHelp, updateAvailable, applyUpdate, isIos } = useContext(PwaContext);

  return <>
    {!isOnline && <div className="pwa-network-banner" role="status">
      <Icon name="wifiOff" size={18} />
      <div><strong>You’re offline</strong><span>Cached pages stay available. New orders and account changes need a connection.</span></div>
    </div>}

    {updateAvailable && <div className="pwa-update-toast surface-card" role="status">
      <span className="pwa-update-icon"><Icon name="refresh" /></span>
      <div><strong>A fresh Tomato update is ready</strong><span>Reload once to use the latest version.</span></div>
      <button className="button button-primary" type="button" onClick={applyUpdate}>Update now</button>
    </div>}

    {showInstallHelp && <div className="pwa-help-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) setShowInstallHelp(false);
    }}>
      <section className="pwa-help-modal surface-card" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title">
        <button className="icon-button pwa-help-close" type="button" aria-label="Close install instructions" onClick={() => setShowInstallHelp(false)}><Icon name="close" /></button>
        <span className="pwa-help-logo">T.</span>
        <div className="section-kicker">Install Tomato</div>
        <h2 id="pwa-install-title">Keep ordering one tap away.</h2>
        {isIos ? <ol>
          <li>Open this site in <strong>Safari</strong>.</li>
          <li>Tap the <strong>Share</strong> button.</li>
          <li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>
        </ol> : <ol>
          <li>Open your browser menu.</li>
          <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>Confirm to add Tomato to your device.</li>
        </ol>}
        <p>Your installed app uses the same secure account, cart, orders, points, wishlist and live updates as the website.</p>
        <button className="button button-primary button-full" type="button" onClick={() => setShowInstallHelp(false)}>Got it</button>
      </section>
    </div>}
  </>;
}
