import { createContext, useEffect, useMemo, useState } from 'react';
import { food_list as fallbackFoods } from '../assets/assets';
import { api, setAccessToken } from '../lib/api';

export const StoreContext = createContext(null);
const GUEST_WISHLIST_KEY = 'tomato_guest_wishlist';

function loadCart() {
  try { return JSON.parse(localStorage.getItem('cart') || '{}'); }
  catch { return {}; }
}

function loadGuestWishlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_WISHLIST_KEY) || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.filter(value => typeof value === 'string'))].slice(0, 100) : [];
  } catch { return []; }
}

function saveGuestWishlist(ids) {
  localStorage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(ids));
}

function normalizeProducts(products) {
  return products.map(product => {
    const imageUrl = product.imageUrl || '';
    const fallbackImage = /^\/food_\d+\.(png|jpe?g|webp|avif)$/i.test(imageUrl)
      ? fallbackFoods.find(food => food._id === product.id)?.image
      : null;
    const image = /^https?:\/\//i.test(imageUrl) ? imageUrl : fallbackImage || imageUrl || null;
    return { ...product, _id: product.id, image, price: product.price ?? product.priceCents / 100 };
  });
}

function productsFromWishlistResponse(data) {
  return normalizeProducts((data?.items || []).map(item => item.product));
}

export default function StoreContextProvider({ children }) {
  const [cartItems, setCartItems] = useState(loadCart);
  const [food_list, setFoodList] = useState(fallbackFoods);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [wishlistIds, setWishlistIds] = useState(loadGuestWishlist);
  const [accountWishlistProducts, setAccountWishlistProducts] = useState([]);
  const [wishlistBusy, setWishlistBusy] = useState([]);

  const refreshProducts = async () => {
    const data = await api.getProducts();
    setFoodList(normalizeProducts(data.products));
    return data.products;
  };

  const applyWishlistResponse = data => {
    const products = productsFromWishlistResponse(data);
    setAccountWishlistProducts(products);
    setWishlistIds(products.map(product => product._id));
    return products;
  };

  const loadAccountWishlist = async () => applyWishlistResponse(await api.getWishlist());

  const mergeGuestWishlist = async () => {
    const guestIds = loadGuestWishlist();
    const data = guestIds.length ? await api.syncWishlist(guestIds) : await api.getWishlist();
    saveGuestWishlist([]);
    return applyWishlistResponse(data);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const [productsResult, authResult] = await Promise.allSettled([api.getProducts(), api.refresh()]);
      if (!active) return;
      if (productsResult.status === 'fulfilled') setFoodList(normalizeProducts(productsResult.value.products));
      if (authResult.status === 'fulfilled') {
        setAccessToken(authResult.value.accessToken);
        setUser(authResult.value.user);
        try { if (active) await mergeGuestWishlist(); } catch { /* Wishlist should not block sign-in restoration. */ }
      } else {
        const guestIds = loadGuestWishlist();
        const availableIds = productsResult.status === 'fulfilled' ? new Set(productsResult.value.products.map(product => product.id)) : null;
        const cleanedIds = availableIds ? guestIds.filter(id => availableIds.has(id)) : guestIds;
        setWishlistIds(cleanedIds);
        if (cleanedIds.length !== guestIds.length) saveGuestWishlist(cleanedIds);
      }
      if (active) setLoading(false);
    })();
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
    try { await mergeGuestWishlist(); } catch { /* Keep authentication successful if wishlist sync is temporarily unavailable. */ }
    return data;
  };

  const authenticateWithGoogle = async credential => {
    const data = await api.googleLogin(credential);
    setAccessToken(data.accessToken);
    setUser(data.user);
    try { await mergeGuestWishlist(); } catch { /* Keep authentication successful if wishlist sync is temporarily unavailable. */ }
    return data;
  };

  const createOrder = async body => {
    const data = await api.createOrder(body);
    if (data.loyalty && user) setUser(previous => previous ? { ...previous, pointsBalance: data.loyalty.pointsBalance } : previous);
    return data;
  };

  const isWishlisted = productId => wishlistIds.includes(productId);

  const toggleWishlist = async product => {
    const productId = product?._id || product?.id;
    if (!productId || wishlistBusy.includes(productId)) return;
    const wasSaved = wishlistIds.includes(productId);
    const nextIds = wasSaved ? wishlistIds.filter(id => id !== productId) : [productId, ...wishlistIds].slice(0, 100);

    if (!user) {
      setWishlistIds(nextIds);
      saveGuestWishlist(nextIds);
      return;
    }

    setWishlistBusy(previous => [...previous, productId]);
    setWishlistIds(nextIds);
    setAccountWishlistProducts(previous => wasSaved
      ? previous.filter(item => item._id !== productId)
      : [product, ...previous.filter(item => item._id !== productId)]);
    try {
      if (wasSaved) await api.removeWishlistItem(productId);
      else await api.saveWishlistItem(productId);
    } catch (error) {
      setWishlistIds(wishlistIds);
      await loadAccountWishlist().catch(() => {});
      throw error;
    } finally {
      setWishlistBusy(previous => previous.filter(id => id !== productId));
    }
  };

  const removeWishlistItem = async productId => {
    const product = (user ? accountWishlistProducts : food_list).find(item => item._id === productId) || { _id: productId };
    if (isWishlisted(productId)) await toggleWishlist(product);
  };

  const guestWishlistProducts = useMemo(() => wishlistIds
    .map(id => food_list.find(product => product._id === id))
    .filter(Boolean), [wishlistIds, food_list]);
  const wishlistProducts = user ? (accountWishlistProducts.length || !wishlistIds.length ? accountWishlistProducts : guestWishlistProducts) : guestWishlistProducts;
  const wishlistCount = wishlistIds.length;

  const logout = async () => {
    await api.logout();
    setAccessToken(null);
    setUser(null);
    setAccountWishlistProducts([]);
    setWishlistIds(loadGuestWishlist());
  };

  return <StoreContext.Provider value={{
    food_list, cartItems, cartProducts, cartCount, setCartItems, setQuantity,
    addToCart, removeFromCart, removeItem, getTotalCartAmount,
    user, setUser, loading, authenticate, authenticateWithGoogle, logout,
    searchQuery, setSearchQuery, couponCode, setCouponCode,
    createOrder, getOrders: api.getOrders, refreshProducts,
    wishlistProducts, wishlistIds, wishlistCount, wishlistBusy,
    isWishlisted, toggleWishlist, removeWishlistItem, refreshWishlist: loadAccountWishlist,
  }}>{children}</StoreContext.Provider>;
}
