import { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'google-identity-services';
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google sign-in could not be loaded'));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({ disabled = false, onCredential, onError }) {
  const slotRef = useRef(null);
  const callbackRef = useRef(onCredential);
  const errorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  callbackRef.current = onCredential;
  errorRef.current = onError;

  useEffect(() => {
    if (!clientId) return undefined;

    let cancelled = false;
    let observer = null;
    let lastWidth = 0;

    loadGoogleScript().then(() => {
      if (cancelled || !slotRef.current || !window.google?.accounts?.id) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: response => {
          if (response?.credential) callbackRef.current?.(response.credential);
          else errorRef.current?.(new Error('Google sign-in did not return a credential'));
        },
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      const renderButton = () => {
        if (cancelled || !slotRef.current) return;
        const measuredWidth = Math.floor(slotRef.current.getBoundingClientRect().width || 0);
        const width = Math.max(240, Math.min(400, measuredWidth || 340));
        if (width === lastWidth) return;
        lastWidth = width;

        slotRef.current.replaceChildren();
        window.google.accounts.id.renderButton(slotRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        });
        setReady(true);
      };

      renderButton();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(renderButton);
        observer.observe(slotRef.current);
      }
    }).catch(error => {
      if (!cancelled) errorRef.current?.(error);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div
      className={`google-signin-shell${disabled ? ' is-disabled' : ''}${ready ? ' is-ready' : ''}`}
      aria-busy={disabled || !ready}
    >
      {!ready && <div className="google-signin-placeholder" aria-hidden="true" />}
      <div className="google-signin-slot" ref={slotRef} />
    </div>
  );
}
