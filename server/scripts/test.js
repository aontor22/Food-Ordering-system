import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl || !/^postgres(?:ql)?:\/\//i.test(baseUrl)) {
  console.error('Tests require PostgreSQL. Set TEST_DATABASE_URL (recommended) or DATABASE_URL to a PostgreSQL connection URL.');
  console.error('For local development, run `docker compose up -d db` and use postgresql://tomato:tomato@localhost:5432/tomato?schema=public');
  process.exit(1);
}

const schemaName = `test_${process.pid}_${randomBytes(5).toString('hex')}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set('schema', schemaName);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testUrl.toString(),
  PAYMENT_CURRENCY: 'USD',
  ENABLE_DEMO_PAYMENTS: 'true',
  SSLCOMMERZ_STORE_ID: '',
  SSLCOMMERZ_STORE_PASSWORD: '',
  SSLCOMMERZ_LIVE: 'false',
  ADMIN_EMAIL: `admin-${schemaName}@example.com`,
  ADMIN_PASSWORD: 'AdminTest123!'
};

const run = (command, args, extra = {}) => spawnSync(command, args, { env, stdio: 'inherit', ...extra });
let status = 1;
try {
  for (const [command, args] of [
    ['npm', ['run', 'db:generate']],
    ['npm', ['run', 'db:migrate']],
    ['npm', ['run', 'db:seed']],
    [process.execPath, ['--test', '--test-concurrency=1', 'test/api.test.js', 'test/gateway.test.js', 'test/manual.test.js', 'test/loyalty-review.test.js', 'test/wishlist.test.js', 'test/store-availability.test.js', 'test/delivery-zones.test.js', 'test/fulfillment-scheduling.test.js', 'test/order-tracking.test.js', 'test/notifications.test.js']]
  ]) {
    const result = run(command, args, { shell: process.platform === 'win32' });
    status = result.status ?? 1;
    if (status) break;
  }
} finally {
  const cleanupUrl = new URL(baseUrl);
  cleanupUrl.searchParams.set('schema', 'public');
  const cleanupCode = `import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); try { await p.$executeRawUnsafe('DROP SCHEMA IF EXISTS "${schemaName}" CASCADE'); } finally { await p.$disconnect(); }`;
  spawnSync(process.execPath, ['--input-type=module', '-e', cleanupCode], {
    env: { ...env, DATABASE_URL: cleanupUrl.toString() },
    stdio: 'inherit'
  });
}
process.exitCode = status;
