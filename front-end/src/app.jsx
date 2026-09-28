import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/navbar/navbar';
import Footer from './components/Footer/Footer';
import LoginPopup from './components/LoginPopup/LoginPopup';
import Home from './pages/Home/Home';
import Cart from './pages/Cart/Cart';
import PlaceOrder from './pages/PlaceOrder/PlaceOrder';
import Orders from './pages/Orders/Orders';
import Wishlist from './pages/Wishlist/Wishlist';
import Notifications from './pages/Notifications/Notifications';
import Addresses from './pages/Addresses/Addresses';
import OrderSuccess from './pages/OrderSuccess/OrderSuccess';
import GuestOrder from './pages/GuestOrder/GuestOrder';
import EmptyState from './components/ui/EmptyState';
import AdminGuard from './components/admin/AdminGuard';
import AdminLayout from './components/admin/AdminLayout';
import AdminDashboard from './pages/Admin/AdminDashboard';
import AdminAnalytics from './pages/Admin/AdminAnalytics';
import AdminProducts from './pages/Admin/AdminProducts';
import AdminInventory from './pages/Admin/AdminInventory';
import AdminOrders from './pages/Admin/AdminOrders';
import AdminKitchen from './pages/Admin/AdminKitchen';
import AdminCustomers from './pages/Admin/AdminCustomers';
import AdminCoupons from './pages/Admin/AdminCoupons';
import AdminActivity from './pages/Admin/AdminActivity';
import AdminPayments from './pages/Admin/AdminPayments';
import AdminReviews from './pages/Admin/AdminReviews';
import AdminLoyalty from './pages/Admin/AdminLoyalty';
import AdminStoreOperations from './pages/Admin/AdminStoreOperations';
import AdminDeliveryZones from './pages/Admin/AdminDeliveryZones';
import AdminFulfillment from './pages/Admin/AdminFulfillment';
import AdminNotifications from './pages/Admin/AdminNotifications';
import PaymentDemo from './pages/Payment/PaymentDemo';
import PaymentResult from './pages/Payment/PaymentResult';
import ManualPayment from './pages/Payment/ManualPayment';
import VerifyEmail from './pages/Auth/VerifyEmail';
import ResetPassword from './pages/Auth/ResetPassword';
import Security from './pages/Security/Security';
import './responsive.css';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0, behavior: 'instant' }), [pathname]);
  return null;
}

export default function App() {
  const [showLogin, setShowLogin] = useState(false);
  const { pathname } = useLocation();
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  return <div className="app-shell">
    <ScrollToTop />
    {showLogin && <LoginPopup onClose={() => setShowLogin(false)} />}
    {isAdmin ? <Routes>
      <Route path="/admin" element={<AdminGuard onLogin={() => setShowLogin(true)}><AdminLayout /></AdminGuard>}>
        <Route index element={<AdminDashboard />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="inventory" element={<AdminInventory />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="kitchen" element={<AdminKitchen />} />
        <Route path="payments" element={<AdminPayments />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="reviews" element={<AdminReviews />} />
        <Route path="loyalty" element={<AdminLoyalty />} />
        <Route path="store-operations" element={<AdminStoreOperations />} />
        <Route path="delivery-zones" element={<AdminDeliveryZones />} />
        <Route path="fulfillment" element={<AdminFulfillment />} />
        <Route path="notifications" element={<AdminNotifications />} />
        <Route path="coupons" element={<AdminCoupons />} />
        <Route path="activity" element={<AdminActivity />} />
        <Route path="security" element={<Security />} />
        <Route path="*" element={<AdminDashboard />} />
      </Route>
    </Routes> : <>
      <Navbar onLogin={() => setShowLogin(true)} />
      <main className="page-main page-container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/order" element={<PlaceOrder onLogin={() => setShowLogin(true)} />} />
        <Route path="/orders" element={<Orders onLogin={() => setShowLogin(true)} />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/addresses" element={<Addresses onLogin={() => setShowLogin(true)} />} />
        <Route path="/security" element={<Security />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/order-success/:orderNumber" element={<OrderSuccess />} />
        <Route path="/guest-order/:orderNumber" element={<GuestOrder onLogin={() => setShowLogin(true)} />} />
        <Route path="/payment/demo/:transactionId" element={<PaymentDemo onLogin={() => setShowLogin(true)} />} />
        <Route path="/payment/result" element={<PaymentResult />} />
        <Route path="/payment/manual/:orderId" element={<ManualPayment onLogin={() => setShowLogin(true)} />} />
        <Route path="*" element={<EmptyState icon="🧭" title="Page not found" text="The page you requested may have moved or no longer exists." />} />
      </Routes>
      </main>
      <Footer />
    </>}
  </div>;
}
