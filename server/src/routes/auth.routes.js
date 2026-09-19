import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { config, isProduction } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { hashToken, newSessionId, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/tokens.js';

const router = Router();
const credentials = z.object({ email: z.email().max(254).transform(v => v.toLowerCase().trim()), password: z.string().min(8).max(72) });
const authBody = z.object({ body: credentials.extend({ name: z.string().trim().min(2).max(80) }), query: z.any(), params: z.any() });
const loginBody = z.object({ body: credentials, query: z.any(), params: z.any() });
const publicUser = ({ passwordHash, ...user }) => user;
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
