import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { config, isProduction } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { GoogleTokenError, verifyGoogleIdToken } from '../lib/google-auth.js';
import { hashToken, newSessionId, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';
import { linkEligibleGuestOrdersForVerifiedUser } from '../services/guest-orders.js';
import { emailConfigured, sendTransactionalEmail } from '../services/notifications.js';
import {
  AUTH_TOKEN_TYPES,
  buildTotpUri,
  createAuthToken,
  createRecoveryCodes,
  decryptSecret,
  describeUserAgent,
  encryptSecret,
  findActiveAuthToken,
  generateTotpSecret,
  maskEmail,
  maskIp,
  recoveryCodeHash,
  safeParseRecoveryHashes,
  verifyTotp,
} from '../services/auth-security.js';
import { audit } from '../services/audit.js';

const router = Router();
const empty = z.object({}).passthrough();
const emailSchema = z.email().max(254).transform(value => value.toLowerCase().trim());
const loginPassword = z.string().min(1).max(72);
const newPassword = z.string().min(12, 'Use at least 12 characters').max(72);
const authBody = z.object({ body: z.object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: newPassword }), query: z.any(), params: z.any() });
const loginBody = z.object({ body: z.object({ email: emailSchema, password: loginPassword }), query: z.any(), params: z.any() });
const googleBody = z.object({ body: z.object({ credential: z.string().min(100).max(10000) }), query: z.any(), params: z.any() });
const emailBody = z.object({ body: z.object({ email: emailSchema }), query: z.any(), params: z.any() });
const tokenBody = z.object({ body: z.object({ token: z.string().min(20).max(4096) }), query: z.any(), params: z.any() });
const resetBody = z.object({ body: z.object({ token: z.string().min(20).max(4096), password: newPassword }), query: z.any(), params: z.any() });
const changePasswordBody = z.object({ body: z.object({ currentPassword: loginPassword, newPassword }), query: z.any(), params: z.any() });
const challengeBody = z.object({ body: z.object({ challengeToken: z.string().min(20).max(4096) }), query: z.any(), params: z.any() });
const challengeCodeBody = z.object({ body: z.object({ challengeToken: z.string().min(20).max(4096), code: z.string().trim().min(6).max(40) }), query: z.any(), params: z.any() });
const recoveryCodesBody = z.object({ body: z.object({ currentPassword: loginPassword, code: z.string().trim().regex(/^\d{6}$/, 'Use the current 6-digit authenticator code') }), query: z.any(), params: z.any() });
const sessionParam = z.object({ body: empty, query: z.any(), params: z.object({ id: z.string().min(1).max(100) }) });

const primaryAuthLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true });
const registrationLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const emailActionLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const mfaLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });

const REFRESH_COOKIE_NAME = 'refreshToken';
const refreshCookieBase = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/api/auth',
  priority: 'high',
};
const allowedOrigins = new Set(config.CLIENT_ORIGIN.split(',').map(value => value.trim()).filter(Boolean));
const dummyHashPromise = bcrypt.hash('not-a-real-account-password', 12);

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
});

function requireTrustedOrigin(req, _res, next) {
  const origin = req.get('origin');
  if (!origin || allowedOrigins.has(origin)) return next();
  return next(new AppError(403, 'UNTRUSTED_ORIGIN', 'This authentication request came from an untrusted origin'));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || null,
    role: user.role,
    isActive: user.isActive,
    pointsBalance: user.pointsBalance || 0,
    emailVerifiedAt: user.emailVerifiedAt || null,
    emailVerified: Boolean(user.emailVerifiedAt),
    twoFactorEnabled: Boolean(user.twoFactorEnabledAt),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function clientBaseUrl() {
  return [...allowedOrigins][0] || 'http://localhost:5173';
}

async function minimumResponseTime(startedAt, minimumMs = 500) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function sendSecurityLinkEmail({ user, kind, url }) {
  const isVerification = kind === 'verify';
  const title = isVerification ? 'Verify your Tomato email' : 'Reset your Tomato password';
  const intro = isVerification
    ? 'Confirm this email address to activate password sign-in for your Tomato account.'
    : 'A password reset was requested for your Tomato account. If this was not you, you can ignore this email.';
  const expiry = isVerification ? '24 hours' : '30 minutes';
  return sendTransactionalEmail({
    to: user.email,
    subject: title,
    text: `${title}\n\n${intro}\n\nOpen: ${url}\n\nThis private link expires in ${expiry}.`,
    html: `<!doctype html><html><body style="margin:0;background:#f7f5f1;font-family:Arial,sans-serif;color:#202521"><div style="max-width:620px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #ebe6dd;border-radius:18px;overflow:hidden"><div style="padding:22px 26px;background:#f4512c;color:#fff"><strong style="font-size:22px">Tomato.</strong></div><div style="padding:28px"><p style="margin:0 0 8px;color:#777;font-size:13px">ACCOUNT SECURITY</p><h1 style="margin:0 0 12px;font-size:25px">${escapeHtml(title)}</h1><p style="margin:0 0 20px;line-height:1.6">Hi ${escapeHtml(user.name)}, ${escapeHtml(intro)}</p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#f4512c;color:#fff;text-decoration:none;font-weight:700">${isVerification ? 'Verify email' : 'Reset password'}</a><p style="margin:24px 0 0;color:#777;font-size:12px;line-height:1.6">This one-time link expires in ${expiry}. Do not forward it. Tomato staff will never ask you for this link or your password.</p></div></div></div></body></html>`,
    headers: { 'X-Tomato-Security-Message': kind },
  });
}

async function createVerification(user) {
  const { token } = await createAuthToken({ userId: user.id, type: AUTH_TOKEN_TYPES.EMAIL_VERIFY, ttlMs: 24 * 60 * 60_000 });
  const url = `${clientBaseUrl().replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  const delivery = await sendSecurityLinkEmail({ user, kind: 'verify', url });
  return { url, delivery };
}

async function createPasswordReset(user) {
  const { token } = await createAuthToken({ userId: user.id, type: AUTH_TOKEN_TYPES.PASSWORD_RESET, ttlMs: 30 * 60_000 });
  const url = `${clientBaseUrl().replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const delivery = await sendSecurityLinkEmail({ user, kind: 'reset', url });
  return { url, delivery };
}

async function issueSession(req, res, user, { mfaVerifiedAt = null } = {}) {
  const id = newSessionId();
  const refreshToken = signRefreshToken(user.id, id);
  await prisma.session.create({
    data: {
      id,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86400000),
      userAgent: req.get('user-agent')?.slice(0, 500),
      ipAddress: req.ip,
      lastSeenAt: new Date(),
      mfaVerifiedAt,
    },
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...refreshCookieBase, maxAge: config.REFRESH_TOKEN_DAYS * 86400000 });
  return { accessToken: signAccessToken(user, id), user: publicUser(user) };
}

async function createAdminChallenge(user) {
  if (user.twoFactorEnabledAt && user.twoFactorSecretEncrypted) {
    const { token } = await createAuthToken({ userId: user.id, type: AUTH_TOKEN_TYPES.ADMIN_MFA_LOGIN, ttlMs: 5 * 60_000 });
    return { mfaRequired: true, challengeToken: token, email: maskEmail(user.email), expiresInSeconds: 300 };
  }
  const secret = generateTotpSecret();
  const { token } = await createAuthToken({
    userId: user.id,
    type: AUTH_TOKEN_TYPES.ADMIN_MFA_SETUP,
    ttlMs: 10 * 60_000,
    metadata: { secretEncrypted: encryptSecret(secret) },
  });
  return { mfaSetupRequired: true, challengeToken: token, email: maskEmail(user.email), expiresInSeconds: 600 };
}

async function completePrimaryAuth(req, res, user) {
  if (config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS) return res.json(await issueSession(req, res, user, { mfaVerifiedAt: user.role === 'ADMIN' ? new Date() : null }));
  if (user.role === 'ADMIN') return res.json(await createAdminChallenge(user));
  return res.json(await issueSession(req, res, user));
}

async function consumeMfaLoginCode(challenge, code) {
  const user = challenge.user;
  if (!user.twoFactorEnabledAt || !user.twoFactorSecretEncrypted) throw new AppError(409, 'MFA_SETUP_REQUIRED', 'Administrator two-factor authentication must be configured');
  const normalized = String(code || '').trim();
  if (/^\d{6}$/.test(normalized)) {
    const match = verifyTotp(decryptSecret(user.twoFactorSecretEncrypted), normalized);
    if (!match) throw new AppError(401, 'INVALID_MFA_CODE', 'Authenticator code is invalid or expired');
    await prisma.$transaction(async tx => {
      const challengeClaim = await tx.authToken.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (challengeClaim.count !== 1) throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor challenge is invalid or expired');
      const used = await tx.user.updateMany({
        where: { id: user.id, OR: [{ twoFactorLastUsedStep: null }, { twoFactorLastUsedStep: { lt: match.step } }] },
        data: { twoFactorLastUsedStep: match.step },
      });
      if (used.count !== 1) throw new AppError(401, 'MFA_CODE_REUSED', 'This authenticator code has already been used');
    });
    return 'TOTP';
  }

  const currentHashes = safeParseRecoveryHashes(user.twoFactorRecoveryCodesJson);
  const targetHash = recoveryCodeHash(normalized);
  const index = currentHashes.findIndex(value => value === targetHash);
  if (index < 0) throw new AppError(401, 'INVALID_MFA_CODE', 'Recovery code is invalid or already used');
  const nextHashes = currentHashes.filter((_, position) => position !== index);
  await prisma.$transaction(async tx => {
    const challengeClaim = await tx.authToken.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (challengeClaim.count !== 1) throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor challenge is invalid or expired');
    const used = await tx.user.updateMany({
      where: { id: user.id, twoFactorRecoveryCodesJson: user.twoFactorRecoveryCodesJson },
      data: { twoFactorRecoveryCodesJson: JSON.stringify(nextHashes) },
    });
    if (used.count !== 1) throw new AppError(401, 'MFA_CODE_REUSED', 'This recovery code has already been used');
  });
  return 'RECOVERY';
}

router.post('/register', registrationLimiter, validate(authBody), async (req, res, next) => {
  try {
    if (isProduction && !emailConfigured()) throw new AppError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Email verification is temporarily unavailable');
    const { name, email, password } = req.validated.body;
    if (await prisma.user.findUnique({ where: { email } })) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    let user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), ...(config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS ? { emailVerifiedAt: new Date() } : {}) } });
    if (config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS) return res.status(201).json(await issueSession(req, res, user));
    const verification = await createVerification(user);
    res.status(201).json({
      verificationRequired: true,
      email: maskEmail(email),
      message: 'Check your email and verify the address before signing in.',
      ...(!isProduction && verification.delivery.skipped ? { previewUrl: verification.url } : {}),
    });
  } catch (error) { next(error); }
});

router.post('/login', primaryAuthLimiter, validate(loginBody), async (req, res, next) => {
  try {
    const { email, password } = req.validated.body;
    const user = await prisma.user.findUnique({ where: { email } });
    const candidateHash = user?.passwordHash || await dummyHashPromise;
    const passwordMatches = await bcrypt.compare(password, candidateHash);
    if (!user || !user.isActive || !passwordMatches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (!user.emailVerifiedAt && !(config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS)) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in');
    return completePrimaryAuth(req, res, user);
  } catch (error) { next(error); }
});

router.post('/google', primaryAuthLimiter, validate(googleBody), async (req, res, next) => {
  try {
    if (!config.GOOGLE_CLIENT_ID) throw new AppError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Google sign-in is not configured');
    const profile = await verifyGoogleIdToken(req.validated.body.credential);
    const email = profile.email.toLowerCase().trim();
    let user = await prisma.user.findUnique({ where: { googleSub: profile.sub } });
    if (!user) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (!existing.isActive) throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable');
        if (existing.googleSub && existing.googleSub !== profile.sub) throw new AppError(409, 'GOOGLE_ACCOUNT_MISMATCH', 'This email is already linked to another Google account');
        const googleIsAuthoritativeForEmail = email.endsWith('@gmail.com') || Boolean(profile.hd);
        if (!existing.googleSub && !googleIsAuthoritativeForEmail) throw new AppError(409, 'ACCOUNT_LINK_REQUIRED', 'Sign in with your password first before linking this Google account');
        user = await prisma.user.update({
          where: { id: existing.id },
          data: { googleSub: profile.sub, avatarUrl: existing.avatarUrl || profile.picture || null, emailVerifiedAt: existing.emailVerifiedAt || new Date() },
        });
      } else {
        const generatedPassword = crypto.randomBytes(48).toString('base64url');
        user = await prisma.user.create({
          data: {
            name: String(profile.name || email.split('@')[0] || 'Google User').trim().slice(0, 80),
            email,
            passwordHash: await bcrypt.hash(generatedPassword, 12),
            googleSub: profile.sub,
            avatarUrl: profile.picture || null,
            emailVerifiedAt: new Date(),
          },
        });
      }
    }
    if (!user.isActive) throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable');
    if (!user.emailVerifiedAt) user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    try { await linkEligibleGuestOrdersForVerifiedUser(user.id); }
    catch (linkError) { req.log?.warn?.({ err: linkError, userId: user.id }, 'verified guest-order auto-link failed'); }
    return completePrimaryAuth(req, res, user);
  } catch (error) {
    if (error instanceof GoogleTokenError) return next(new AppError(error.status, error.code, error.message));
    return next(error);
  }
});

router.post('/resend-verification', emailActionLimiter, validate(emailBody), async (req, res, next) => {
  try {
    const startedAt = Date.now();
    if (isProduction && !emailConfigured()) throw new AppError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Account email delivery is temporarily unavailable');
    const user = await prisma.user.findUnique({ where: { email: req.validated.body.email } });
    let previewUrl;
    if (user?.isActive && !user.emailVerifiedAt) {
      const result = await createVerification(user);
      if (!isProduction && result.delivery.skipped) previewUrl = result.url;
    }
    await minimumResponseTime(startedAt);
    res.status(202).json({ message: 'If the account still needs verification, a new email has been sent.', ...(previewUrl ? { previewUrl } : {}) });
  } catch (error) { next(error); }
});

router.post('/verify-email', emailActionLimiter, validate(tokenBody), async (req, res, next) => {
  try {
    const record = await findActiveAuthToken(req.validated.body.token, AUTH_TOKEN_TYPES.EMAIL_VERIFY);
    if (!record || !record.user?.isActive) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or expired');
    await prisma.$transaction(async tx => {
      const claimed = await tx.authToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or expired');
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: record.user.emailVerifiedAt || new Date() } });
      await tx.authToken.updateMany({ where: { userId: record.userId, type: AUTH_TOKEN_TYPES.EMAIL_VERIFY, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    try { await linkEligibleGuestOrdersForVerifiedUser(record.userId); }
    catch (linkError) { req.log?.warn?.({ err: linkError, userId: record.userId }, 'verified guest-order auto-link failed'); }
    res.json({ verified: true, message: 'Email verified. You can now sign in.' });
  } catch (error) { next(error); }
});

router.post('/forgot-password', emailActionLimiter, validate(emailBody), async (req, res, next) => {
  try {
    const startedAt = Date.now();
    if (isProduction && !emailConfigured()) throw new AppError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Account email delivery is temporarily unavailable');
    const user = await prisma.user.findUnique({ where: { email: req.validated.body.email } });
    let previewUrl;
    if (user?.isActive) {
      const result = await createPasswordReset(user);
      if (!isProduction && result.delivery.skipped) previewUrl = result.url;
    } else {
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.validated.body.email));
    }
    await minimumResponseTime(startedAt);
    res.status(202).json({ message: 'If an active account matches that email, a password reset link has been sent.', ...(previewUrl ? { previewUrl } : {}) });
  } catch (error) { next(error); }
});

router.post('/reset-password', emailActionLimiter, validate(resetBody), async (req, res, next) => {
  try {
    const record = await findActiveAuthToken(req.validated.body.token, AUTH_TOKEN_TYPES.PASSWORD_RESET);
    if (!record || !record.user?.isActive) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
    const passwordHash = await bcrypt.hash(req.validated.body.password, 12);
    await prisma.$transaction(async tx => {
      const claimed = await tx.authToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Password reset link is invalid or expired');
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: new Date(), emailVerifiedAt: record.user.emailVerifiedAt || new Date() } });
      await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.updateMany({ where: { userId: record.userId, type: AUTH_TOKEN_TYPES.PASSWORD_RESET, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    try { await linkEligibleGuestOrdersForVerifiedUser(record.userId); }
    catch (linkError) { req.log?.warn?.({ err: linkError, userId: record.userId }, 'password-reset guest-order auto-link failed'); }
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase);
    res.json({ reset: true, message: 'Password updated. Sign in again on your devices.' });
  } catch (error) { next(error); }
});

router.post('/admin-2fa/setup', mfaLimiter, validate(challengeBody), async (req, res, next) => {
  try {
    const challenge = await findActiveAuthToken(req.validated.body.challengeToken, AUTH_TOKEN_TYPES.ADMIN_MFA_SETUP);
    if (!challenge || !challenge.user?.isActive || challenge.user.role !== 'ADMIN') throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor setup challenge is invalid or expired');
    const metadata = JSON.parse(challenge.metadataJson || '{}');
    const secret = decryptSecret(metadata.secretEncrypted);
    res.json({ secret, otpauthUri: buildTotpUri({ secret, email: challenge.user.email }), account: challenge.user.email, expiresAt: challenge.expiresAt });
  } catch (error) { next(error); }
});

router.post('/admin-2fa/enable', mfaLimiter, validate(challengeCodeBody), async (req, res, next) => {
  try {
    const challenge = await findActiveAuthToken(req.validated.body.challengeToken, AUTH_TOKEN_TYPES.ADMIN_MFA_SETUP);
    if (!challenge || !challenge.user?.isActive || challenge.user.role !== 'ADMIN') throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor setup challenge is invalid or expired');
    const metadata = JSON.parse(challenge.metadataJson || '{}');
    const secretEncrypted = metadata.secretEncrypted;
    const secret = decryptSecret(secretEncrypted);
    const match = verifyTotp(secret, req.validated.body.code);
    if (!match) throw new AppError(401, 'INVALID_MFA_CODE', 'Authenticator code is invalid or expired');
    const recovery = createRecoveryCodes();
    await prisma.$transaction(async tx => {
      const claimed = await tx.authToken.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor setup challenge is invalid or expired');
      await tx.user.update({
        where: { id: challenge.userId },
        data: {
          twoFactorSecretEncrypted: secretEncrypted,
          twoFactorRecoveryCodesJson: JSON.stringify(recovery.hashes),
          twoFactorEnabledAt: new Date(),
          twoFactorLastUsedStep: match.step,
        },
      });
      await tx.session.updateMany({ where: { userId: challenge.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    const session = await issueSession(req, res, user, { mfaVerifiedAt: new Date() });
    res.json({ ...session, recoveryCodes: recovery.codes, twoFactorEnabled: true });
  } catch (error) { next(error); }
});

router.post('/admin-2fa/verify', mfaLimiter, validate(challengeCodeBody), async (req, res, next) => {
  try {
    const challenge = await findActiveAuthToken(req.validated.body.challengeToken, AUTH_TOKEN_TYPES.ADMIN_MFA_LOGIN);
    if (!challenge || !challenge.user?.isActive || challenge.user.role !== 'ADMIN') throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Two-factor challenge is invalid or expired');
    const method = await consumeMfaLoginCode(challenge, req.validated.body.code);
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    const session = await issueSession(req, res, user, { mfaVerifiedAt: new Date() });
    res.json({ ...session, mfaMethod: method });
  } catch (error) { next(error); }
});

router.post('/admin-2fa/recovery-codes', mfaLimiter, requireAuth, requireRole('ADMIN'), validate(recoveryCodesBody), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.sub } });
    if (!user || !(await bcrypt.compare(req.validated.body.currentPassword, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    if (!user.twoFactorSecretEncrypted) throw new AppError(409, 'MFA_SETUP_REQUIRED', 'Two-factor authentication is not configured');
    const match = verifyTotp(decryptSecret(user.twoFactorSecretEncrypted), req.validated.body.code);
    if (!match) throw new AppError(401, 'INVALID_MFA_CODE', 'Authenticator code is invalid or expired');
    const recovery = createRecoveryCodes();
    const updated = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ twoFactorLastUsedStep: null }, { twoFactorLastUsedStep: { lt: match.step } }] },
      data: { twoFactorLastUsedStep: match.step, twoFactorRecoveryCodesJson: JSON.stringify(recovery.hashes) },
    });
    if (updated.count !== 1) throw new AppError(401, 'MFA_CODE_REUSED', 'This authenticator code has already been used');
    await audit(req, 'ADMIN_2FA_RECOVERY_CODES_REGENERATED', 'User', user.id);
    res.json({ recoveryCodes: recovery.codes });
  } catch (error) { next(error); }
});

router.post('/refresh', requireTrustedOrigin, async (req, res, next) => {
  const token = req.cookies[REFRESH_COOKIE_NAME];
  try {
    if (!token) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Session is missing');
    const payload = verifyRefreshToken(token);
    const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    const now = new Date();
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= now || !session.user.isActive) throw new AppError(401, 'INVALID_SESSION', 'Session is invalid or expired');
    if (session.tokenHash !== hashToken(token)) throw new AppError(401, 'STALE_REFRESH_TOKEN', 'A newer refresh token already exists for this device session');
    if (!(config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS) && session.user.role === 'ADMIN' && (!session.user.twoFactorEnabledAt || !session.mfaVerifiedAt)) throw new AppError(401, 'ADMIN_2FA_REQUIRED', 'Administrator sign-in requires two-factor authentication');

    const replacement = signRefreshToken(session.userId, session.id);
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86400000);
    const rotated = await prisma.session.updateMany({
      where: { id: session.id, tokenHash: hashToken(token), revokedAt: null },
      data: { tokenHash: hashToken(replacement), expiresAt, lastSeenAt: now },
    });
    if (rotated.count !== 1) throw new AppError(401, 'STALE_REFRESH_TOKEN', 'A newer refresh token already exists for this device session');
    res.cookie(REFRESH_COOKIE_NAME, replacement, { ...refreshCookieBase, maxAge: config.REFRESH_TOKEN_DAYS * 86400000 }).json({ accessToken: signAccessToken(session.user, session.id), user: publicUser(session.user) });
  } catch (error) {
    if (error?.code !== 'STALE_REFRESH_TOKEN') res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase);
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') return next(new AppError(401, 'INVALID_SESSION', 'Session is invalid or expired'));
    return next(error);
  }
});

router.post('/logout', requireTrustedOrigin, async (req, res) => {
  const token = req.cookies[REFRESH_COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await prisma.session.updateMany({ where: { id: payload.sid, tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
    } catch { /* A malformed/expired cookie is simply cleared. */ }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase).status(204).end();
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.sub } });
    if (!user?.isActive) return next(new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable'));
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/change-password', requireAuth, validate(changePasswordBody), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.sub } });
    if (!user?.isActive || !(await bcrypt.compare(req.validated.body.currentPassword, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    if (await bcrypt.compare(req.validated.body.newPassword, user.passwordHash)) throw new AppError(409, 'PASSWORD_UNCHANGED', 'Choose a new password you are not already using');
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(req.validated.body.newPassword, 12), passwordChangedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase).json({ changed: true, message: 'Password changed. Sign in again on your devices.' });
  } catch (error) { next(error); }
});

router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.auth.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json({
      sessions: sessions.map(session => ({
        id: session.id,
        current: session.id === req.auth.sessionId,
        device: describeUserAgent(session.userAgent),
        ipAddress: maskIp(session.ipAddress),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        mfaVerified: Boolean(session.mfaVerifiedAt),
      })),
    });
  } catch (error) { next(error); }
});

router.delete('/sessions/:id', requireAuth, validate(sessionParam), async (req, res, next) => {
  try {
    const result = await prisma.session.updateMany({ where: { id: req.validated.params.id, userId: req.auth.sub, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new AppError(404, 'SESSION_NOT_FOUND', 'Active session not found');
    const current = req.validated.params.id === req.auth.sessionId;
    if (current) res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBase);
    res.json({ revoked: true, current });
  } catch (error) { next(error); }
});

router.post('/sessions/revoke-others', requireAuth, async (req, res, next) => {
  try {
    const result = await prisma.session.updateMany({ where: { userId: req.auth.sub, id: { not: req.auth.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    res.json({ revoked: result.count });
  } catch (error) { next(error); }
});

export default router;
