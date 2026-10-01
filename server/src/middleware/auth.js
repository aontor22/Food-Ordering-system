import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

export async function requireAuth(req, _res, next) {
  const value = req.get('authorization');
  if (!value?.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
  try {
    const payload = verifyAccessToken(value.slice(7));
    const session = await prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { select: { id: true, email: true, role: true, isActive: true, twoFactorEnabledAt: true } } },
    });
    const now = new Date();
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= now || !session.user?.isActive) {
      return next(new AppError(401, 'INVALID_SESSION', 'Session is invalid or expired'));
    }
    req.auth = {
      ...payload,
      sub: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id,
      mfaVerified: Boolean(session.mfaVerifiedAt),
      twoFactorEnabled: Boolean(session.user.twoFactorEnabledAt),
    };
    if (!session.lastSeenAt || session.lastSeenAt.getTime() < now.getTime() - 5 * 60_000) {
      prisma.session.updateMany({
        where: { id: session.id, revokedAt: null, lastSeenAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
        data: { lastSeenAt: now },
      }).catch(() => {});
    }
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired'));
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.auth?.role)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'));
  if (!(config.NODE_ENV === 'test' && config.TEST_AUTH_BYPASS) && roles.includes('ADMIN') && req.auth?.role === 'ADMIN' && (!req.auth.twoFactorEnabled || !req.auth.mfaVerified)) {
    return next(new AppError(403, 'ADMIN_2FA_REQUIRED', 'Administrator access requires a verified two-factor session'));
  }
  return next();
};
