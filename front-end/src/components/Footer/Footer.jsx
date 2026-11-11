import { Link } from 'react-router-dom';
import { assets } from '../../assets/assets';
import './Footer.css';

export default function Footer() {
  return <footer className="footer" id="footer">
    <div className="footer-inner page-container">
      <div className="footer-brand"><img src={assets.logo} alt="Tomato" /><p>Fresh dishes, thoughtful service, and everyday comfort delivered to your door.</p><div className="footer-social" aria-label="Social media"><span><img src={assets.facebook_icon} alt="Facebook" /></span><span><img src={assets.twitter_icon} alt="Twitter" /></span><span><img src={assets.linkedin_icon} alt="LinkedIn" /></span></div></div>
      <div><h2>Explore</h2><ul><li><Link to="/">Home</Link></li><li><Link to="/cart">Cart</Link></li><li><Link to="/orders">My orders</Link></li><li><a href="#app-download">Install app</a></li></ul></div>
      <div><h2>Information</h2><ul><li>About us</li><li>Delivery information</li><li>Privacy policy</li><li>Terms of use</li></ul></div>
      <div><h2>Get in touch</h2><ul><li><a href="tel:+8801811787512">+880 1811-787512</a></li><li><a href="mailto:hello@tomato.example">hello@tomato.example</a></li><li>Dhaka, Bangladesh</li></ul></div>
    </div>
    <div className="footer-bottom page-container"><p>© {new Date().getFullYear()} Tomato. All rights reserved.</p><p>Made for good food and better moments.</p></div>
  </footer>;
}
