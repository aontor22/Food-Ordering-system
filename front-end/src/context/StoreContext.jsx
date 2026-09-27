import { createContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken } from '../lib/api';
import { detachPushOnLogout } from '../lib/push';
import { getGuestOrderAccessRecords, removeGuestOrderAccess, saveGuestOrderAccess } from '../lib/guestOrders';
import { cartLineFingerprint, customizationDetails, customizationSummary, normalizeSelections, productUnitPriceCents } from '../lib/productCustomizations';

export const StoreContext = createContext(null);
const GUEST_WISHLIST_KEY = 'tomato_guest_wishlist';

function newLineId() {
  return globalThis.crypto?.randomUUID?.() || `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCartLine(line) {
  if (!line?.productId) return null;
  const quantity = Math.max(1, Math.min(20, Number(line.quantity) || 1));
  return {
    lineId: String(line.lineId || newLineId()),
    productId: String(line.productId),
    quantity,
    selections: normalizeSelections(line.selections || []),
    specialInstructions: String(line.specialInstructions || '').trim().slice(0, 300),
  };
}

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem('cart') || '[]');
    if (Array.isArray(parsed)) return parsed.map(normalizeCartLine).filter(Boolean).slice(0, 100);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([productId, quantity]) => normalizeCartLine({ productId, quantity }))
        .filter(Boolean);
    }
    return [];
  } catch { return []; }
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

function productImageUrl(imageUrl) {
  const legacy = typeof imageUrl === 'string' && imageUrl.match(/^\/food_(\d+)\.(?:png|jpe?g|webp|avif)$/i);
  return legacy ? `/seed-food/food_${legacy[1]}.webp` : imageUrl || null;
}

function normalizeProducts(products) {
  return products.map(product => ({
    ...product,
    _id: product.id,
    image: productImageUrl(product.imageUrl),
    price: product.price ?? product.priceCents / 100,
  }));
}

function productsFromWishlistResponse(data) {
  return normalizeProducts((data?.items || []).map(item => item.product));
}

export default function StoreContextProvider({ children }) {
  const [cartItems, setCartItems] = useState(loadCart);
  const [food_list, setFoodList] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [wishlistIds, setWishlistIds] = useState(loadGuestWishlist);
  const [accountWishlistProducts, setAccountWishlistProducts] = useState([]);
  const [wishlistBusy, setWishlistBusy] = useState([]);
  const [storeStatus, setStoreStatus] = useState(null);

  const refreshStoreStatus = async () => {
    const data = await api.getStoreStatus();
    setStoreStatus(data.store);
    return data.store;
  };

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

  const syncGuestOrdersToAccount = async () => {
    const records = getGuestOrderAccessRecords();
    let linked = 0;
    for (const record of records) {
      try {
        await api.linkGuestOrder(record.token);
        removeGuestOrderAccess(record.token);
        linked += 1;
      } catch {
        // Keep the private token locally if the current account email does not match or the service is temporarily unavailable.
      }
    }
    return linked;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const [productsResult, authResult, storeResult] = await Promise.allSettled([api.getProducts(), api.refresh(), api.getStoreStatus()]);
      if (!active) return;
      if (productsResult.status === 'fulfilled') setFoodList(normalizeProducts(productsResult.value.products));
      if (storeResult.status === 'fulfilled') setStoreStatus(storeResult.value.store);
      if (authResult.status === 'fulfilled') {
        setAccessToken(authResult.value.accessToken);
        setUser(authResult.value.user);
        try { if (active) await mergeGuestWishlist(); } catch { /* Wishlist should not block sign-in restoration. */ }
        try { if (active) await syncGuestOrdersToAccount(); } catch { /* Guest-order linking should not block session restoration. */ }
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

  useEffect(() => {
    const timer = setInterval(() => { api.getStoreStatus().then(data => setStoreStatus(data.store)).catch(() => {}); }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => localStorage.setItem('cart', JSON.stringify(cartItems)), [cartItems]);

  const setQuantity = (lineId, quantity) => setCartItems(previous => previous.flatMap(line => {
    if (line.lineId !== lineId) return [line];
    const otherQuantity = previous.filter(item => item.lineId !== lineId && item.productId === line.productId).reduce((sum, item) => sum + item.quantity, 0);
    const maxForLine = Math.max(0, 20 - otherQuantity);
    const next = Math.max(0, Math.min(maxForLine, Number(quantity) || 0));
    return next > 0 ? [{ ...line, quantity: next }] : [];
  }));

  const addToCart = input => setCartItems(previous => {
    const incoming = normalizeCartLine(typeof input === 'string' ? { productId: input, quantity: 1 } : input);
    if (!incoming) return previous;
    const currentProductQuantity = previous.filter(line => line.productId === incoming.productId).reduce((sum, line) => sum + line.quantity, 0);
    const allowedQuantity = Math.min(incoming.quantity, Math.max(0, 20 - currentProductQuantity));
    if (allowedQuantity <= 0) return previous;
    const fingerprint = cartLineFingerprint(incoming);
    const matchIndex = previous.findIndex(line => cartLineFingerprint(line) === fingerprint);
    if (matchIndex < 0) return [...previous, { ...incoming, quantity: allowedQuantity }].slice(0, 100);
    return previous.map((line, index) => index === matchIndex ? { ...line, quantity: line.quantity + allowedQuantity } : line);
  });

  const updateCartLine = input => setCartItems(previous => {
    const incoming = normalizeCartLine(input);
    if (!incoming) return previous;
    const withoutCurrent = previous.filter(line => line.lineId !== incoming.lineId);
    const otherProductQuantity = withoutCurrent.filter(line => line.productId === incoming.productId).reduce((sum, line) => sum + line.quantity, 0);
    const allowedQuantity = Math.min(incoming.quantity, Math.max(0, 20 - otherProductQuantity));
    if (allowedQuantity <= 0) return previous;
    const adjusted = { ...incoming, quantity: allowedQuantity };
    const fingerprint = cartLineFingerprint(adjusted);
    const match = withoutCurrent.find(line => cartLineFingerprint(line) === fingerprint);
    if (!match) return [...withoutCurrent, adjusted].slice(0, 100);
    return withoutCurrent.map(line => line.lineId === match.lineId ? { ...line, quantity: line.quantity + adjusted.quantity } : line);
  });

  const removeFromCart = lineId => setCartItems(previous => previous.flatMap(line => line.lineId !== lineId ? [line] : line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []));
  const removeItem = lineId => setCartItems(previous => previous.filter(line => line.lineId !== lineId));

  const cartProducts = useMemo(() => cartItems.map(line => {
    const product = food_list.find(item => item._id === line.productId);
    if (!product) return null;
    const unitPriceCents = productUnitPriceCents(product, line.selections);
    return {
      ...product,
      ...line,
      price: unitPriceCents / 100,
      unitPriceCents,
      customizationDetails: customizationDetails(product, line.selections),
      customizationSummary: customizationSummary(product, line.selections),
    };
  }).filter(Boolean), [food_list, cartItems]);

  const cartCount = cartProducts.reduce((sum, product) => sum + product.quantity, 0);
  const cartProductQuantity = productId => cartItems.filter(line => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
  const getTotalCartAmount = () => cartProducts.reduce((sum, product) => sum + product.price * product.quantity, 0);

  const authenticate = async (mode, values) => {
    const data = await api[mode](values);
    setAccessToken(data.accessToken);
    setUser(data.user);
    try { await mergeGuestWishlist(); } catch { /* Keep authentication successful if wishlist sync is temporarily unavailable. */ }
    try { await syncGuestOrdersToAccount(); } catch { /* Keep authentication successful if order linking is temporarily unavailable. */ }
    return data;
  };

  const authenticateWithGoogle = async credential => {
    const data = await api.googleLogin(credential);
    setAccessToken(data.accessToken);
    setUser(data.user);
    try { await mergeGuestWishlist(); } catch { /* Keep authentication successful if wishlist sync is temporarily unavailable. */ }
    try { await syncGuestOrdersToAccount(); } catch { /* Keep authentication successful if order linking is temporarily unavailable. */ }
    return data;
  };

  const createOrder = async body => {
    const data = user ? await api.createOrder(body) : await api.createGuestOrder({ ...body, pointsToRedeem: 0 });
    if (data.guestAccess) saveGuestOrderAccess({ order: data.order, guestAccess: data.guestAccess });
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
    await detachPushOnLogout();
    await api.logout();
    setAccessToken(null);
    setUser(null);
    setAccountWishlistProducts([]);
    setWishlistIds(loadGuestWishlist());
  };

  return <StoreContext.Provider value={{
    food_list, cartItems, cartProducts, cartCount, cartProductQuantity, setCartItems, setQuantity,
    addToCart, updateCartLine, removeFromCart, removeItem, getTotalCartAmount,
    user, setUser, loading, authenticate, authenticateWithGoogle, logout,
    searchQuery, setSearchQuery, couponCode, setCouponCode,
    createOrder, getOrders: api.getOrders, refreshProducts,
    wishlistProducts, wishlistIds, wishlistCount, wishlistBusy,
    isWishlisted, toggleWishlist, removeWishlistItem, refreshWishlist: loadAccountWishlist,
    storeStatus, refreshStoreStatus,
  }}>{children}</StoreContext.Provider>;
}
