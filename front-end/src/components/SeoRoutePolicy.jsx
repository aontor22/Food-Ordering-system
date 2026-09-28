import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applySeo, siteUrl } from '../lib/seo';

const PRIVATE_PREFIXES = [
  '/admin', '/cart', '/order', '/orders', '/wishlist', '/notifications', '/addresses', '/security',
  '/verify-email', '/reset-password', '/order-success', '/guest-order', '/payment',
];

export default function SeoRoutePolicy() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname === '/') {
      applySeo({
        title: 'Tomato — Fresh food, delivered',
        description: 'Order fresh, chef-crafted food from Tomato for fast delivery or pickup.',
        canonicalPath: '/',
        image: '/og-cover.webp',
        jsonLd: { '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Tomato', url: `${siteUrl()}/`, image: `${siteUrl()}/og-cover.webp`, servesCuisine: ['Fresh meals', 'International'], priceRange: '$$', acceptsReservations: false, hasMenu: `${siteUrl()}/#dishes` },
      });
      return;
    }
    if (pathname.startsWith('/menu/')) return;
    if (PRIVATE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      applySeo({
        title: 'Tomato — Secure customer area',
        description: 'Secure Tomato customer or administration page.',
        canonicalPath: pathname,
        robots: 'noindex,nofollow,noarchive',
      });
      return;
    }
    applySeo({
      title: 'Page not found — Tomato',
      description: 'The requested Tomato page could not be found.',
      canonicalPath: pathname,
      robots: 'noindex,nofollow',
    });
  }, [pathname]);
  return null;
}
