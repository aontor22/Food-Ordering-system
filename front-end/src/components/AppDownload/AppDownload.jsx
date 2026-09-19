import { assets } from '../../assets/assets';
import Icon from '../ui/Icon';
import './AppDownload.css';

export default function AppDownload() {
  return <section className="app-promo" id="app-download">
    <div className="app-promo-copy">
      <div className="section-kicker">Tomato in your pocket</div>
      <h2>Your favourites,<br />one tap away.</h2>
      <p>Get faster checkout, live order updates, and app-only offers wherever you go.</p>
      <div className="app-badges"><img src={assets.play_store} alt="Get it on Google Play" /><img src={assets.app_store} alt="Download on the App Store" /></div>
    </div>
    <div className="phone-card" aria-hidden="true"><div className="phone-top"/><div className="mini-brand">Tomato.</div><p>What are you<br />craving today?</p><div className="mini-search"><Icon name="search" size={15} />Search dishes</div><div className="mini-food"><img src={assets.header_img} alt="" /></div></div>
  </section>;
}
