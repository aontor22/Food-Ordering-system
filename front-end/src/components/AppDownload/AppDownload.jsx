import { useContext, useState } from 'react';
import { assets } from '../../assets/assets';
import { PwaContext } from '../../context/PwaContext';
import Icon from '../ui/Icon';
import './AppDownload.css';

const benefits = [
  { icon: 'download', title: 'Installable', text: 'Add Tomato to your home screen' },
  { icon: 'wifiOff', title: 'Works offline', text: 'Open the app shell without a connection' },
  { icon: 'spark', title: 'Fast & smooth', text: 'A focused app-like experience' },
  { icon: 'bell', title: 'Stay updated', text: 'Receive live order notifications' },
];

export default function AppDownload() {
  const { installApp, isInstalled, isIos } = useContext(PwaContext);
  const [feedback, setFeedback] = useState('');

  const install = async () => {
    const result = await installApp();
    if (result?.outcome === 'accepted') setFeedback('Tomato is being added to your device.');
    else if (result?.outcome === 'dismissed') setFeedback('No problem — you can install it whenever you’re ready.');
    else if (result?.outcome === 'instructions') setFeedback('Follow the install instructions shown for your browser.');
  };

  return <section className="app-promo" id="app-download" aria-labelledby="tomato-app-title">
    <div className="app-promo-main">
      <div className="app-promo-copy">
        <div className="app-promo-eyebrow"><span>🍴</span> Food ordering made easy</div>
        <h2 id="tomato-app-title">Get <span>Tomato</span></h2>
        <p className="app-promo-lead">Order your favourite food anytime, anywhere. Install Tomato for a fast, focused experience with live order updates and a useful offline fallback.</p>

        {isInstalled ? <div className="pwa-install-card is-installed">
          <span className="pwa-install-icon"><Icon name="check" size={24} /></span>
          <span className="pwa-install-copy"><strong>Tomato is installed</strong><small>Open it from your home screen or app launcher.</small></span>
        </div> : <button className="pwa-install-card" type="button" onClick={install}>
          <span className="pwa-install-icon"><Icon name="download" size={25} /></span>
          <span className="pwa-install-copy"><strong>{isIos ? 'Install Tomato on iPhone / iPad' : 'Install Tomato'}</strong><small>Add to your home screen (PWA)</small></span>
          <Icon name="arrow" size={25} className="pwa-install-arrow" />
        </button>}

        {feedback && <p className="pwa-install-feedback" role="status">{feedback}</p>}

        <div className="store-coming-soon" aria-label="Native app store availability">
          <div className="store-coming-title"><span /> <strong>Also coming to</strong> <span /></div>
          <div className="app-badges">
            <div className="store-badge" aria-label="Google Play coming soon">
              <img src={assets.play_store} alt="Get it on Google Play" />
              <small>Coming soon</small>
            </div>
            <div className="store-badge" aria-label="App Store coming soon">
              <img src={assets.app_store} alt="Download on the App Store" />
              <small>Coming soon</small>
            </div>
          </div>
        </div>
      </div>

      <div className="app-device-stage" aria-hidden="true">
        <div className="promo-orb promo-orb-one" />
        <div className="promo-orb promo-orb-two" />

        <div className="promo-phone promo-phone-main">
          <div className="promo-phone-notch" />
          <div className="promo-phone-status"><strong>9:41</strong><span>● ● ▬</span></div>
          <div className="promo-app-bar"><strong>Tomato</strong><span><Icon name="search" size={17} /><Icon name="cart" size={18} /></span></div>
          <div className="promo-location"><span>●</span>Dhanmondi, Dhaka</div>
          <div className="promo-food-hero">
            <img src={assets.header_img} alt="" />
            <div><strong>Delicious food<br />delivered to you</strong><span>Order now →</span></div>
          </div>
          <div className="promo-categories">
            <span>🍕<small>Pizza</small></span><span>🍔<small>Burger</small></span><span>🍚<small>Rice</small></span><span>🥤<small>Drinks</small></span>
          </div>
          <div className="promo-popular-head"><strong>Popular dishes</strong><span>See all →</span></div>
          <div className="promo-dishes">
            <div><span>🍕</span><strong>Margherita</strong><small>৳ 420</small></div>
            <div><span>🍔</span><strong>Chicken burger</strong><small>৳ 280</small></div>
          </div>
        </div>

        <div className="promo-phone promo-phone-track">
          <div className="promo-phone-notch" />
          <div className="promo-phone-status"><strong>9:41</strong><span>● ● ▬</span></div>
          <div className="track-title"><Icon name="arrow" size={18} /><strong>Order #1287</strong></div>
          <div className="mini-order-timeline">
            <div className="done"><i><Icon name="check" size={14} /></i><span><strong>Order placed</strong><small>12:10 AM</small></span></div>
            <div className="done"><i><Icon name="check" size={14} /></i><span><strong>Order confirmed</strong><small>12:12 AM</small></span></div>
            <div className="done"><i><Icon name="check" size={14} /></i><span><strong>Food is being prepared</strong><small>12:15 AM</small></span></div>
            <div className="current"><i><Icon name="delivery" size={14} /></i><span><strong>Out for delivery</strong><small>Estimated arrival in 12 min</small></span></div>
            <div><i /><span><strong>Delivered</strong><small>Coming up next</small></span></div>
          </div>
          <div className="mini-delivery-map">
            <div className="map-road road-one" /><div className="map-road road-two" />
            <span className="map-rider">🛵</span><span className="map-home">⌂</span><b>12 min away</b>
          </div>
        </div>
      </div>
    </div>

    <div className="app-promo-benefits">
      {benefits.map(item => <div key={item.title}>
        <span><Icon name={item.icon} size={24} /></span>
        <p><strong>{item.title}</strong><small>{item.text}</small></p>
      </div>)}
    </div>
  </section>;
}
