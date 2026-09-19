import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const value = process.env.DATABASE_URL || 'file:./dev.db';
if (!value.startsWith('file:')) throw new Error('The bundled initializer supports SQLite file: URLs only. Use prisma migrate deploy for another production database.');
const relative = value.slice(5);
const databasePath = path.isAbsolute(relative) ? relative : path.resolve(here, relative);
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');
const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='User'").get();
if (!table) db.exec(readFileSync(path.join(here, 'migrations/20260919000000_init/migration.sql'), 'utf8'));
const paymentTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Payment'").get();
if (!paymentTable) db.exec(readFileSync(path.join(here, 'migrations/20260919010000_payments/migration.sql'), 'utf8'));
// Existing COD orders must also appear in the payment ledger after an upgrade.
db.prepare(`INSERT INTO Payment (id, transactionId, provider, status, amountCents, currency, paidAt, createdAt, updatedAt, orderId)
 SELECT 'legacy_' || id, 'LEGACY-' || id, 'COD',
 CASE WHEN paymentStatus IN ('PAID','REFUNDED') THEN paymentStatus WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
 totalCents, ?, CASE WHEN paymentStatus = 'PAID' THEN updatedAt ELSE NULL END, createdAt, updatedAt, id
 FROM "Order" WHERE paymentMethod = 'COD' AND id NOT IN (SELECT orderId FROM Payment)`).run(process.env.PAYMENT_CURRENCY || 'USD');
db.close();
console.log(`Database initialized at ${databasePath}`);
