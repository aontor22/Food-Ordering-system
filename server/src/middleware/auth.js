import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../lib/prisma.js';

export async function requireAuth(req, _res, next) {
  const value = req.get('authorization');
  if (!value?.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
  try {
    req.auth = verifyAccessToken(value.slice(7));
    const user = await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { role: true, isActive: true } });
    if (!user?.isActive) return next(new AppError(401, 'ACCOUNT_DISABLED', 'Account is unavailable'));
    req.auth.role = user.role;
    next();
  }
  catch { next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired')); }
}
export const requireRole = (...roles) => (req, _res, next) => roles.includes(req.auth?.role) ? next() : next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'));
