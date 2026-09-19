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

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

function indexExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name = ?").get(name));
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  return db.prepare(`PRAGMA table_info("${table}")`).all().some(item => item.name === column);
}

function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    work();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Fresh database bootstrap.
if (!tableExists('User')) {
  transaction(() => db.exec(readFileSync(path.join(here, 'migrations/20260919000000_init/migration.sql'), 'utf8')));
}

// Google sign-in columns were added after the original user table. Keep the
// initializer idempotent so existing Render/SQLite deployments upgrade in place.
transaction(() => {
  if (!columnExists('User', 'googleSub')) {
    db.exec('ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;');
  }
  if (!columnExists('User', 'avatarUrl')) {
    db.exec('ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;');
  }
  if (!indexExists('User_googleSub_key')) {
    db.exec('CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");');
  }
});

// Upgrade projects created before the payment ledger existed.
if (!tableExists('Payment')) {
  transaction(() => db.exec(readFileSync(path.join(here, 'migrations/20260919010000_payments/migration.sql'), 'utf8')));
}

// Manual payments were added after the original payment ledger. Do not use a
// single table as the migration marker: older/partially-upgraded databases may
// have ManualPaymentChannel while still missing Payment.manualDestination or
// ManualPaymentSubmission, which makes /api/admin/payments fail with HTTP 500.
transaction(() => {
  if (!columnExists('Payment', 'manualDestination')) {
    db.exec('ALTER TABLE "Payment" ADD COLUMN "manualDestination" TEXT;');
  }

  if (!tableExists('ManualPaymentChannel')) {
    db.exec(`CREATE TABLE "ManualPaymentChannel" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "account" TEXT NOT NULL,
      "instructions" TEXT NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );`);
  }

  if (!tableExists('ManualPaymentSubmission')) {
    db.exec(`CREATE TABLE "ManualPaymentSubmission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "reference" TEXT NOT NULL,
      "referenceKey" TEXT NOT NULL,
      "sender" TEXT NOT NULL,
      "note" TEXT,
      "amountCents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
      "reviewNote" TEXT,
      "reviewedBy" TEXT,
      "reviewedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "paymentId" TEXT NOT NULL,
      CONSTRAINT "ManualPaymentSubmission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`);
  }

  if (!indexExists('ManualPaymentSubmission_referenceKey_key')) {
    db.exec('CREATE UNIQUE INDEX "ManualPaymentSubmission_referenceKey_key" ON "ManualPaymentSubmission"("referenceKey");');
  }
  if (!indexExists('ManualPaymentSubmission_paymentId_createdAt_idx')) {
    db.exec('CREATE INDEX "ManualPaymentSubmission_paymentId_createdAt_idx" ON "ManualPaymentSubmission"("paymentId", "createdAt");');
  }
});

// Existing COD orders must also appear in the payment ledger after an upgrade.
db.prepare(`INSERT INTO Payment (id, transactionId, provider, status, amountCents, currency, paidAt, createdAt, updatedAt, orderId)
 SELECT 'legacy_' || id, 'LEGACY-' || id, 'COD',
 CASE WHEN paymentStatus IN ('PAID','REFUNDED') THEN paymentStatus WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
 totalCents, ?, CASE WHEN paymentStatus = 'PAID' THEN updatedAt ELSE NULL END, createdAt, updatedAt, id
 FROM "Order" WHERE paymentMethod = 'COD' AND id NOT IN (SELECT orderId FROM Payment)`).run(process.env.PAYMENT_CURRENCY || 'USD');

db.close();
console.log(`Database initialized and verified at ${databasePath}`);
