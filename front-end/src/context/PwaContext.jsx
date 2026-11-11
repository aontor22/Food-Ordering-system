import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const PwaContext = createContext({
  canInstall: false,
  isInstalled: false,
  isOnline: true,
  isIos: false,
  installApp: async () => ({ outcome: 'unavailable' }),
  showInstallHelp: false,
  setShowInstallHelp: () => {},
  updateAvailable: false,
  applyUpdate: () => {},
});

function standaloneMode() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function iosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

export default function PwaProvider({ children }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(standaloneMode);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef(null);
  const isIos = iosDevice();

  useEffect(() => {
    const onBeforeInstall = event => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setShowInstallHelp(false);
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const media = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setIsInstalled(standaloneMode());
    media?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      media?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    let cancelled = false;
    let registration;
    let controllerChanging = false;

    const trackWaitingWorker = worker => {
      if (!worker) return;
      waitingWorkerRef.current = worker;
      setUpdateAvailable(true);
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        if (registration.waiting && navigator.serviceWorker.controller) trackWaitingWorker(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) trackWaitingWorker(installing);
          });
        });

        // Check for a fresh release when the app regains focus, but avoid tight polling.
        const check = () => registration?.update().catch(() => {});
        window.addEventListener('focus', check);
        registration.__tomatoFocusCheck = check;
      } catch (error) {
        console.warn('PWA service worker registration failed:', error);
      }
    };

    const onControllerChange = () => {
      if (controllerChanging) return;
      controllerChanging = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    register();

    return () => {
      cancelled = true;
      if (registration?.__tomatoFocusCheck) window.removeEventListener('focus', registration.__tomatoFocusCheck);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (isInstalled) return { outcome: 'installed' };
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') setDeferredPrompt(null);
      return choice || { outcome: 'dismissed' };
    }
    setShowInstallHelp(true);
    return { outcome: 'instructions' };
  }, [deferredPrompt, isInstalled]);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  }, []);

  const value = useMemo(() => ({
    canInstall: !isInstalled && (Boolean(deferredPrompt) || isIos),
    isInstalled,
    isOnline,
    isIos,
    installApp,
    showInstallHelp,
    setShowInstallHelp,
    updateAvailable,
    applyUpdate,
  }), [deferredPrompt, isInstalled, isOnline, isIos, installApp, showInstallHelp, updateAvailable, applyUpdate]);

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}
