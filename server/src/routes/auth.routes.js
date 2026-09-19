import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { config, isProduction } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { GoogleTokenError, verifyGoogleIdToken } from '../lib/google-auth.js';
import { hashToken, newSessionId, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';

const router = Router();
const credentials = z.object({ email: z.email().max(254).transform(v => v.toLowerCase().trim()), password: z.string().min(8).max(72) });
const authBody = z.object({ body: credentials.extend({ name: z.string().trim().min(2).max(80) }), query: z.any(), params: z.any() });
const loginBody = z.object({ body: credentials, query: z.any(), params: z.any() });
const googleBody = z.object({ body: z.object({ credential: z.string().min(100).max(10000) }), query: z.any(), params: z.any() });
const publicUser = ({ passwordHash, googleSub, ...user }) => user;
const cookieOptions = { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax', path: '/api/auth', maxAge: config.REFRESH_TOKEN_DAYS * 86400000 };

async function issueSession(req, res, user) {
  const id = newSessionId(); const refreshToken = signRefreshToken(user.id, id);
  await prisma.session.create({ data: { id, userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86400000), userAgent: req.get('user-agent')?.slice(0, 500), ipAddress: req.ip } });
  res.cookie('refreshToken', refreshToken, cookieOptions);
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

router.post('/register', validate(authBody), async (req, res, next) => {
  try {
    const { name, email, password } = req.validated.body;
    if (await prisma.user.findUnique({ where: { email } })) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12) } });
    res.status(201).json(await issueSession(req, res, user));
  } catch (e) { next(e); }
});
router.post('/login', validate(loginBody), async (req, res, next) => {
  try {
    const { email, password } = req.validated.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    res.json(await issueSession(req, res, user));
  } catch (e) { next(e); }
});
router.post('/google', validate(googleBody), async (req, res, next) => {
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
        if (!existing.googleSub && !googleIsAuthoritativeForEmail) {
          throw new AppError(409, 'ACCOUNT_LINK_REQUIRED', 'Sign in with your password first before linking this Google account');
        }
        user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            googleSub: profile.sub,
            avatarUrl: existing.avatarUrl || profile.picture || null,
          },
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
          },
        });
      }
    }

    if (!user.isActive) throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable');
    res.json(await issueSession(req, res, user));
  } catch (e) {
    if (e instanceof GoogleTokenError) return next(new AppError(e.status, e.code, e.message));
    next(e);
  }
});
router.post('/refresh', async (req, res, next) => {
  const token = req.cookies.refreshToken;
  try {
    if (!token) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Session is missing');
    const payload = verifyRefreshToken(token);
    const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.tokenHash !== hashToken(token) || !session.user.isActive) throw new AppError(401, 'INVALID_SESSION', 'Session is invalid or expired');
    const newId = newSessionId(); const replacement = signRefreshToken(session.userId, newId);
    await prisma.$transaction([
      prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedById: newId } }),
      prisma.session.create({ data: { id: newId, userId: session.userId, tokenHash: hashToken(replacement), expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_DAYS * 86400000), userAgent: req.get('user-agent')?.slice(0, 500), ipAddress: req.ip } })
    ]);
    res.cookie('refreshToken', replacement, cookieOptions).json({ accessToken: signAccessToken(session.user), user: publicUser(session.user) });
  } catch (e) { res.clearCookie('refreshToken', cookieOptions); next(e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' ? new AppError(401, 'INVALID_SESSION', 'Session is invalid or expired') : e); }
});
router.post('/logout', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) { try { const p = verifyRefreshToken(token); await prisma.session.updateMany({ where: { id: p.sid, tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } }); } catch {} }
  res.clearCookie('refreshToken', cookieOptions).status(204).end();
});
router.get('/me', requireAuth, async (req, res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.sub } });
  if (!user?.isActive) return next(new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable'));
  res.json({ user: publicUser(user) });
});
export default router;
