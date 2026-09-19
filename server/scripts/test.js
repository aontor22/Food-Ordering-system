import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const folder = mkdtempSync(path.join(tmpdir(), 'food-ordering-tests-'));
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: `file:${path.join(folder, 'test.db')}`, ENABLE_DEMO_PAYMENTS: 'true', SSLCOMMERZ_STORE_ID: '', SSLCOMMERZ_STORE_PASSWORD: '', SSLCOMMERZ_LIVE: 'false' };
let status = 1;
try {
  for (const args of [['prisma/init.js'], ['prisma/seed.js'], ['--test', '--test-concurrency=1', 'test/api.test.js', 'test/gateway.test.js']]) {
    const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    status = result.status ?? 1;
    if (status) break;
  }
} finally { rmSync(folder, { recursive: true, force: true }); }
process.exitCode = status;
