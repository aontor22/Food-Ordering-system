import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const hashToken = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const newSessionId = () => crypto.randomUUID();

export const signAccessToken = (user, sessionId) => jwt.sign({
  sub: user.id,
  sid: sessionId,
  role: user.role,
  type: 'access',
}, config.JWT_ACCESS_SECRET, {
  expiresIn: config.ACCESS_TOKEN_TTL,
  issuer: 'food-ordering-api',
  audience: 'food-ordering-web',
});

export const signRefreshToken = (userId, sessionId) => jwt.sign({
  sub: userId,
  sid: sessionId,
  type: 'refresh',
  jti: crypto.randomUUID(),
}, config.JWT_REFRESH_SECRET, {
  expiresIn: `${config.REFRESH_TOKEN_DAYS}d`,
  issuer: 'food-ordering-api',
  audience: 'food-ordering-web',
});

function verifyTyped(token, secret, expectedType) {
  const payload = jwt.verify(token, secret, { issuer: 'food-ordering-api', audience: 'food-ordering-web' });
  if (payload?.type !== expectedType || typeof payload?.sub !== 'string' || typeof payload?.sid !== 'string') {
    const error = new Error('Token type is invalid');
    error.name = 'JsonWebTokenError';
    throw error;
  }
  return payload;
}

export const verifyAccessToken = token => verifyTyped(token, config.JWT_ACCESS_SECRET, 'access');
export const verifyRefreshToken = token => verifyTyped(token, config.JWT_REFRESH_SECRET, 'refresh');
