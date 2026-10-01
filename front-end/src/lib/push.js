import { api } from './api';

function base64UrlToUint8Array(base64Url) {
  const padding = '='.repeat((4 - base64Url.length % 4) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

export function browserPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState() {
  if (!browserPushSupported()) return { supported: false, permission: 'unsupported', subscribed: false, subscription: null };
  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: Boolean(subscription), subscription };
}

export async function enableBrowserPush(vapidPublicKey) {
  if (!browserPushSupported()) throw new Error('Browser notifications are not supported on this device');
  if (!vapidPublicKey) throw new Error('Browser push is not configured');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Browser notification permission was denied' : 'Notification permission was not granted');
  const registration = await navigator.serviceWorker.register('/sw.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(vapidPublicKey) });
  }
  const json = subscription.toJSON();
  await api.savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
  return subscription;
}

export async function disableBrowserPush() {
  if (!browserPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await api.removePushSubscription(subscription.endpoint).catch(() => {});
  await subscription.unsubscribe();
  return true;
}

export async function detachPushOnLogout() {
  try { await disableBrowserPush(); } catch { /* logout must still succeed */ }
}
