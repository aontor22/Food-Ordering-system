import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export function requireAuth(req, _res, next) {
  const value = req.get('authorization');
  if (!value?.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
  try { req.auth = verifyAccessToken(value.slice(7)); next(); }
  catch { next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid or expired')); }
}
export const requireRole = (...roles) => (req, _res, next) => roles.includes(req.auth?.role) ? next() : next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'));
