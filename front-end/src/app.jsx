import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/navbar/navbar';
import Footer from './components/Footer/Footer';
import LoginPopup from './components/LoginPopup/LoginPopup';
import Home from './pages/Home/Home';
import Cart from './pages/Cart/Cart';
import PlaceOrder from './pages/PlaceOrder/PlaceOrder';
import Orders from './pages/Orders/Orders';
import OrderSuccess from './pages/OrderSuccess/OrderSuccess';
import EmptyState from './components/ui/EmptyState';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0, behavior: 'instant' }), [pathname]);
  return null;
}

export default function App() {
  const [showLogin, setShowLogin] = useState(false);
  return <div className="app-shell">
    <ScrollToTop />
    {showLogin && <LoginPopup onClose={() => setShowLogin(false)} />}
    <Navbar onLogin={() => setShowLogin(true)} />
    <main className="page-main page-container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/order" element={<PlaceOrder onLogin={() => setShowLogin(true)} />} />
        <Route path="/orders" element={<Orders onLogin={() => setShowLogin(true)} />} />
        <Route path="/order-success/:orderNumber" element={<OrderSuccess />} />
        <Route path="*" element={<EmptyState icon="🧭" title="Page not found" text="The page you requested may have moved or no longer exists." />} />
      </Routes>
    </main>
    <Footer />
  </div>;
}
