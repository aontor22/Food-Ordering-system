import { createContext, useEffect, useMemo, useState } from 'react';
import { food_list as fallbackFoods } from '../assets/assets';
import { api, setAccessToken } from '../lib/api';

export const StoreContext = createContext(null);

function loadCart() {
  try { return JSON.parse(localStorage.getItem('cart') || '{}'); }
  catch { return {}; }
}

export default function StoreContextProvider({ children }) {
  const [cartItems, setCartItems] = useState(loadCart);
  const [food_list, setFoodList] = useState(fallbackFoods);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [couponCode, setCouponCode] = useState('');

  const normalizeProducts = products => products.map(product => {
    const imageUrl = product.imageUrl || '';
    const fallbackImage = /^\/food_\d+\.(png|jpe?g|webp|avif)$/i.test(imageUrl)
      ? fallbackFoods.find(food => food._id === product.id)?.image
      : null;
    const image = /^https?:\/\//i.test(imageUrl) ? imageUrl : fallbackImage || imageUrl || null;
    return { ...product, _id: product.id, image };
  });

  const refreshProducts = async () => {
    const data = await api.getProducts();
    setFoodList(normalizeProducts(data.products));
    return data.products;
  };

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getProducts(), api.refresh()]).then(([productsResult, authResult]) => {
      if (!active) return;
      if (productsResult.status === 'fulfilled') {
        setFoodList(normalizeProducts(productsResult.value.products));
      }
      if (authResult.status === 'fulfilled') {
        setAccessToken(authResult.value.accessToken);
        setUser(authResult.value.user);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => localStorage.setItem('cart', JSON.stringify(cartItems)), [cartItems]);

  const setQuantity = (itemId, quantity) => setCartItems(previous => ({
    ...previous,
    [itemId]: Math.max(0, Math.min(20, Number(quantity) || 0)),
  }));

  const addToCart = itemId => setCartItems(previous => ({ ...previous, [itemId]: Math.min(20, (previous[itemId] || 0) + 1) }));
  const removeFromCart = itemId => setCartItems(previous => ({ ...previous, [itemId]: Math.max(0, (previous[itemId] || 0) - 1) }));
  const removeItem = itemId => setQuantity(itemId, 0);

  const cartProducts = useMemo(() => food_list
    .filter(product => cartItems[product._id] > 0)
    .map(product => ({ ...product, quantity: cartItems[product._id] })), [food_list, cartItems]);

  const cartCount = cartProducts.reduce((sum, product) => sum + product.quantity, 0);
  const getTotalCartAmount = () => cartProducts.reduce((sum, product) => sum + product.price * product.quantity, 0);

  const authenticate = async (mode, values) => {
    const data = await api[mode](values);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  };

  const authenticateWithGoogle = async credential => {
    const data = await api.googleLogin(credential);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  };

  const createOrder = async body => {
    const data = await api.createOrder(body);
    if (data.loyalty && user) setUser(previous => previous ? { ...previous, pointsBalance: data.loyalty.pointsBalance } : previous);
    return data;
  };

  const logout = async () => {
    await api.logout();
    setAccessToken(null);
    setUser(null);
  };

  return <StoreContext.Provider value={{
    food_list, cartItems, cartProducts, cartCount, setCartItems, setQuantity,
    addToCart, removeFromCart, removeItem, getTotalCartAmount,
    user, setUser, loading, authenticate, authenticateWithGoogle, logout,
    searchQuery, setSearchQuery, couponCode, setCouponCode,
    createOrder, getOrders: api.getOrders, refreshProducts,
  }}>{children}</StoreContext.Provider>;
}
