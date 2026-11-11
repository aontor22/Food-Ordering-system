import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function maskEmail(value) {
  const email = String(value || '').trim();
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return 'your email';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function base32Encode(buffer) {
  const bytes = Buffer.from(buffer);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const normalized = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

export function totpAt(secret, timestampMs = Date.now(), { digits = 6, period = 30 } = {}) {
  const step = Math.floor(timestampMs / 1000 / period);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return { code: String(value % (10 ** digits)).padStart(digits, '0'), step };
}

export function verifyTotp(secret, code, { now = Date.now(), digits = 6, period = 30, window = 1 } = {}) {
  const normalized = String(code || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;
  for (let offset = -window; offset <= window; offset += 1) {
    const result = totpAt(secret, now + (offset * period * 1000), { digits, period });
    if (crypto.timingSafeEqual(Buffer.from(result.code), Buffer.from(normalized))) return result;
  }
  return null;
}

export function buildTotpUri({ secret, email, issuer = 'Tomato Restaurant' }) {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function recoveryCodeHash(value) {
  return crypto.createHash('sha256').update(`recovery:${normalizeRecoveryCode(value)}`).digest('hex');
}

export function createRecoveryCodes(count = 8) {
  const codes = [];
  while (codes.length < count) {
    const raw = base32Encode(crypto.randomBytes(10)).slice(0, 16);
    const formatted = raw.match(/.{1,4}/g).join('-');
    if (!codes.includes(formatted)) codes.push(formatted);
  }
  return { codes, hashes: codes.map(recoveryCodeHash) };
}

export function safeParseRecoveryHashes(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.length === 64) : [];
  } catch {
    return [];
  }
}

export function describeUserAgent(userAgent) {
  const ua = String(userAgent || 'Unknown browser');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

export function maskIp(value) {
  const ip = String(value || '').trim();
  if (!ip) return null;
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}:…`;
  }
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return 'Hidden';
}
