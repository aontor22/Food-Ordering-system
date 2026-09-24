import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().refine(value => /^postgres(?:ql)?:\/\//i.test(value), 'DATABASE_URL must be a PostgreSQL connection URL').default('postgresql://tomato:tomato@localhost:5432/tomato?schema=public'),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-123456'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-12345'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),
  GOOGLE_CLIENT_ID: z.string().trim().optional().transform(value => value || undefined),
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional().transform(value => value || undefined),
  CLOUDINARY_API_KEY: z.string().trim().optional().transform(value => value || undefined),
  CLOUDINARY_API_SECRET: z.string().trim().optional().transform(value => value || undefined),
  CLOUDINARY_FOLDER: z.string().trim().max(120).optional().transform(value => value || 'tomato/products'),
  CLOUDINARY_AUTO_MIGRATE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DELIVERY_FEE_CENTS: z.coerce.number().int().nonnegative().default(200),
  PAYMENT_CURRENCY: z.string().trim().length(3).transform(value => value.toUpperCase()).default('USD'),
  ENABLE_DEMO_PAYMENTS: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  SSLCOMMERZ_STORE_ID: z.string().trim().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().trim().optional(),
  SSLCOMMERZ_LIVE: z.enum(['true', 'false']).default('false').transform(value => value === 'true')
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';

if (config.SSLCOMMERZ_LIVE && (!config.SSLCOMMERZ_STORE_ID || !config.SSLCOMMERZ_STORE_PASSWORD)) {
  throw new Error('SSLCOMMERZ_LIVE=true requires SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD');
}
if (isProduction && config.SSLCOMMERZ_LIVE && !config.PUBLIC_API_URL.startsWith('https://')) {
  throw new Error('Live SSLCOMMERZ requires an HTTPS PUBLIC_API_URL');
}
