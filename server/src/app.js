import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import authRoutes from './routes/auth.routes.js';
import productRoutes from './routes/product.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import wishlistRoutes from './routes/wishlist.routes.js';
import storeRoutes from './routes/store.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import addressRoutes from './routes/address.routes.js';
import { errorHandler, notFound } from './lib/errors.js';
import { livenessSnapshot, readinessSnapshot, requestObservationMiddleware } from './services/observability.js';
import { normalizeRequestId } from './services/observability-core.js';

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({
  quietReqLogger: config.NODE_ENV === 'test',
  genReqId: (req, res) => { const id = normalizeRequestId(req.headers['x-request-id']); res.setHeader('X-Request-ID', id); return id; },
  autoLogging: { ignore: req => req.url?.startsWith('/api/health') },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-order-access-token"]', 'res.headers["set-cookie"]'],
    censor: '[REDACTED]',
  },
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.CLIENT_ORIGIN.split(',').map(v => v.trim()), credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Order-Access-Token','X-Request-ID'], exposedHeaders: ['X-Request-ID'] }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(cookieParser());
app.use(requestObservationMiddleware);
if (config.NODE_ENV !== 'production') app.get('/', (_req, res) => res.json({ service: 'Food Ordering API', status: 'ok', website: 'Open the frontend development port (usually http://localhost:5173)', health: '/api/health' }));
app.get('/api/health', (_req, res) => res.json(livenessSnapshot()));
app.get('/api/health/ready', async (_req, res) => { const snapshot = await readinessSnapshot(); res.status(snapshot.ready ? 200 : 503).json(snapshot); });
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, skip: req => req.path.startsWith('/payments/sslcommerz/') }));
app.use('/api/payments/sslcommerz', rateLimit({ windowMs: 15 * 60 * 1000, limit: 1200, standardHeaders: 'draft-8', legacyHeaders: false }));
app.post('/api/orders/guest', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/orders/guest', rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/payments/guest', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }), authRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/products', productRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/addresses', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }), addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
if (config.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../front-end/dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html')));
}
app.use(notFound);
app.use(errorHandler);
