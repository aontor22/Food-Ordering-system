import { useContext, useState } from 'react';
import { assets } from '../../assets/assets';
import { PwaContext } from '../../context/PwaContext';
import Icon from '../ui/Icon';
import './AppDownload.css';

export default function AppDownload() {
  const { installApp, isInstalled, isIos } = useContext(PwaContext);
  const [feedback, setFeedback] = useState('');

  const install = async () => {
    const result = await installApp();
    if (result?.outcome === 'accepted') setFeedback('Tomato is being added to your device.');
    else if (result?.outcome === 'dismissed') setFeedback('No problem — you can install it whenever you’re ready.');
  };

  return <section className="app-promo" id="app-download">
    <div className="app-promo-copy">
      <div className="section-kicker">Tomato on your home screen</div>
      <h2>Your favourites,<br />one tap away.</h2>
      <p>Install Tomato as an app for a focused, full-screen experience, faster repeat visits, live order notifications, and a useful offline fallback.</p>
      <div className="pwa-install-actions">
        {isInstalled ? <span className="pwa-installed-pill"><Icon name="check" size={18} />Installed on this device</span> : <button className="button pwa-install-button" type="button" onClick={install}>
          <Icon name="download" size={19} />{isIos ? 'Install on iPhone / iPad' : 'Install Tomato'}
        </button>}
        <span>Android · iPhone/iPad · desktop</span>
      </div>
      {feedback && <p className="pwa-install-feedback" role="status">{feedback}</p>}
    </div>
    <div className="phone-card" aria-hidden="true"><div className="phone-top"/><div className="mini-brand">Tomato.</div><p>What are you<br />craving today?</p><div className="mini-search"><Icon name="search" size={15} />Search dishes</div><div className="mini-food"><img src={assets.header_img} alt="" /></div></div>
  </section>;
}
