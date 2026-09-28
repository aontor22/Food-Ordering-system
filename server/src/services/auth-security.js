import crypto from 'node:crypto';
import { config, isProduction } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { hashToken } from '../lib/tokens.js';
export {
  base32Decode,
  base32Encode,
  buildTotpUri,
  createRecoveryCodes,
  describeUserAgent,
  generateTotpSecret,
  maskEmail,
  maskIp,
  normalizeRecoveryCode,
  recoveryCodeHash,
  safeParseRecoveryHashes,
  totpAt,
  verifyTotp,
} from './auth-security-core.js';

export const AUTH_TOKEN_TYPES = Object.freeze({
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ADMIN_MFA_LOGIN: 'ADMIN_MFA_LOGIN',
  ADMIN_MFA_SETUP: 'ADMIN_MFA_SETUP',
});

const ENCRYPTION_AAD = Buffer.from('tomato:admin-2fa:v1');
const DEV_ENCRYPTION_KEY = 'development-auth-encryption-key-change-me-123456789';

function encryptionKey() {
  const value = config.AUTH_ENCRYPTION_KEY || (!isProduction ? DEV_ENCRYPTION_KEY : '');
  if (!value) throw new Error('AUTH_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(value).digest();
}

export function randomOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function createAuthToken({ userId, type, ttlMs, metadata = null, db = prisma, replace = true }) {
  const token = randomOpaqueToken(32);
  const now = new Date();
  if (replace) {
    await db.authToken.updateMany({ where: { userId, type, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
  }
  const record = await db.authToken.create({
    data: { userId, type, tokenHash: hashToken(token), metadataJson: metadata ? JSON.stringify(metadata) : null, expiresAt: new Date(now.getTime() + ttlMs) },
  });
  return { token, record };
}

export async function findActiveAuthToken(token, type, db = prisma) {
  if (!token || token.length > 4096) return null;
  return db.authToken.findFirst({
    where: { tokenHash: hashToken(token), type, consumedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
}

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(ENCRYPTION_AAD);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(value) {
  const [version, ivRaw, tagRaw, cipherRaw] = String(value || '').split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !cipherRaw) throw new Error('Encrypted secret is invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAAD(ENCRYPTION_AAD);
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(cipherRaw, 'base64url')), decipher.final()]).toString('utf8');
}
