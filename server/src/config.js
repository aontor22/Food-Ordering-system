import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-123456'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-12345'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DELIVERY_FEE_CENTS: z.coerce.number().int().nonnegative().default(200)
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
