import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const newSessionId = () => crypto.randomUUID();
export const signAccessToken = (user) => jwt.sign({ sub: user.id, role: user.role, type: 'access' }, config.JWT_ACCESS_SECRET, { expiresIn: config.ACCESS_TOKEN_TTL, issuer: 'food-ordering-api', audience: 'food-ordering-web' });
export const signRefreshToken = (userId, sessionId) => jwt.sign({ sub: userId, sid: sessionId, type: 'refresh' }, config.JWT_REFRESH_SECRET, { expiresIn: `${config.REFRESH_TOKEN_DAYS}d`, issuer: 'food-ordering-api', audience: 'food-ordering-web' });
export const verifyAccessToken = (token) => jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: 'food-ordering-api', audience: 'food-ordering-web' });
export const verifyRefreshToken = (token) => jwt.verify(token, config.JWT_REFRESH_SECRET, { issuer: 'food-ordering-api', audience: 'food-ordering-web' });
