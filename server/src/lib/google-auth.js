import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { config } from '../config.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 300;

let cachedKeys = [];
let keysExpireAt = 0;

export class GoogleTokenError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = 'GoogleTokenError';
    this.code = code;
    this.status = status;
  }
}

function decodeJson(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', `Google ${label} is malformed`);
  }
}

function cacheMaxAge(value) {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(value || '');
  return match ? Number(match[1]) : 3600;
}

async function getGoogleKeys(forceRefresh = false) {
  if (!forceRefresh && cachedKeys.length && Date.now() < keysExpireAt) return cachedKeys;

  let response;
  try {
    response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new GoogleTokenError('GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is temporarily unavailable', 503);
  }

  if (!response.ok) {
    throw new GoogleTokenError('GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is temporarily unavailable', 503);
  }

  const data = await response.json().catch(() => null);
  if (!Array.isArray(data?.keys) || !data.keys.length) {
    throw new GoogleTokenError('GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in is temporarily unavailable', 503);
  }

  cachedKeys = data.keys;
  keysExpireAt = Date.now() + cacheMaxAge(response.headers.get('cache-control')) * 1000;
  return cachedKeys;
}

async function findSigningKey(kid) {
  let keys = await getGoogleKeys();
  let key = keys.find(item => item.kid === kid && item.kty === 'RSA');
  if (!key) {
    keys = await getGoogleKeys(true);
    key = keys.find(item => item.kid === kid && item.kty === 'RSA');
  }
  if (!key) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google signing key was not recognized');
  return key;
}

function validateClaims(payload) {
  const clientId = config.GOOGLE_CLIENT_ID;
  if (!clientId) throw new GoogleTokenError('GOOGLE_AUTH_NOT_CONFIGURED', 'Google sign-in is not configured', 503);

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token audience is invalid');
  if (audiences.length > 1 && payload.azp !== clientId) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token authorized party is invalid');
  if (!VALID_ISSUERS.has(payload.iss)) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token issuer is invalid');

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < now - CLOCK_SKEW_SECONDS) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google sign-in has expired');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + CLOCK_SKEW_SECONDS) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token is not active yet');
  if (Number.isFinite(payload.iat) && payload.iat > now + CLOCK_SKEW_SECONDS) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token issue time is invalid');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google account identifier is missing');
  if (typeof payload.email !== 'string' || !payload.email) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google account email is missing');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new GoogleTokenError('GOOGLE_EMAIL_NOT_VERIFIED', 'Google account email is not verified');

  return payload;
}

export async function verifyGoogleIdToken(token) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 10000) {
    throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google sign-in credential is invalid');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google sign-in credential is malformed');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader, 'token header');
  const payload = decodeJson(encodedPayload, 'token payload');

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google token signing algorithm is invalid');
  }

  const jwk = await findSigningKey(header.kid);
  let key;
  try {
    key = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new GoogleTokenError('GOOGLE_AUTH_UNAVAILABLE', 'Google sign-in verification is temporarily unavailable', 503);
  }

  const valid = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    key,
    Buffer.from(encodedSignature, 'base64url')
  );

  if (!valid) throw new GoogleTokenError('INVALID_GOOGLE_TOKEN', 'Google sign-in credential signature is invalid');
  return validateClaims(payload);
}
