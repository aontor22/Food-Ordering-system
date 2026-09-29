import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

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
  TEST_AUTH_BYPASS: 'true',
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
const testFiles = readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => `test/${name}`);

const resetCode = `
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const rows = await p.$queryRawUnsafe(\`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'\`);
  if (rows.length) {
    const names = rows.map(({ tablename }) => '"' + String(tablename).replaceAll('"', '""') + '"').join(', ');
    await p.$executeRawUnsafe('TRUNCATE TABLE ' + names + ' RESTART IDENTITY CASCADE');
  }
} finally { await p.$disconnect(); }
`;

console.log(`Running ${testFiles.length} server test files in isolated schema ${schemaName}`);
let status = 0;
try {
  for (const [command, args] of [
    ['npm', ['run', 'db:generate']],
    ['npm', ['run', 'db:migrate']],
  ]) {
    const result = run(command, args, { shell: process.platform === 'win32' });
    status = result.status ?? 1;
    if (status) break;
  }

  if (!status) {
    for (const file of testFiles) {
      console.log(`\n=== ${file} ===`);
      let result = run(process.execPath, ['--input-type=module', '-e', resetCode]);
      if ((result.status ?? 1) !== 0) { status = result.status ?? 1; break; }

      result = run('npm', ['run', 'db:seed'], { shell: process.platform === 'win32' });
      if ((result.status ?? 1) !== 0) { status = result.status ?? 1; break; }

      result = run(process.execPath, ['--test', '--test-concurrency=1', file]);
      if ((result.status ?? 1) !== 0) status = result.status ?? 1;
    }
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
