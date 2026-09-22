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

// Product images can be stored in Cloudinary. Only the public URL and public ID
// live in SQLite; the image bytes stay on Cloudinary's CDN.
transaction(() => {
  if (!columnExists('Product', 'imagePublicId')) {
    db.exec('ALTER TABLE "Product" ADD COLUMN "imagePublicId" TEXT;');
  }
  if (!indexExists('Product_imagePublicId_idx')) {
    db.exec('CREATE INDEX "Product_imagePublicId_idx" ON "Product"("imagePublicId");');
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


// Reviews and Tomato Points were added after the original ordering schema.
transaction(() => {
  if (!columnExists('User', 'pointsBalance')) db.exec('ALTER TABLE "User" ADD COLUMN "pointsBalance" INTEGER NOT NULL DEFAULT 0;');
  if (!columnExists('Order', 'pointsRedeemed')) db.exec('ALTER TABLE "Order" ADD COLUMN "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;');
  if (!columnExists('Order', 'pointsDiscountCents')) db.exec('ALTER TABLE "Order" ADD COLUMN "pointsDiscountCents" INTEGER NOT NULL DEFAULT 0;');
  if (!columnExists('Order', 'pointsEarned')) db.exec('ALTER TABLE "Order" ADD COLUMN "pointsEarned" INTEGER NOT NULL DEFAULT 0;');
  if (!columnExists('Order', 'pointsAwardedAt')) db.exec('ALTER TABLE "Order" ADD COLUMN "pointsAwardedAt" DATETIME;');
  if (!columnExists('Order', 'pointsRestoredAt')) db.exec('ALTER TABLE "Order" ADD COLUMN "pointsRestoredAt" DATETIME;');

  if (!tableExists('LoyaltySetting')) {
    db.exec(`CREATE TABLE "LoyaltySetting" (
      "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "pointsPerOrder" INTEGER NOT NULL DEFAULT 5,
      "minimumRedeemPoints" INTEGER NOT NULL DEFAULT 50,
      "pointValueCents" INTEGER NOT NULL DEFAULT 100,
      "updatedAt" DATETIME NOT NULL
    );`);
  }

  if (!tableExists('LoyaltyTransaction')) {
    db.exec(`CREATE TABLE "LoyaltyTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "points" INTEGER NOT NULL,
      "balanceAfter" INTEGER NOT NULL,
      "note" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "userId" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      CONSTRAINT "LoyaltyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`);
  }
  if (!indexExists('LoyaltyTransaction_orderId_type_key')) db.exec('CREATE UNIQUE INDEX "LoyaltyTransaction_orderId_type_key" ON "LoyaltyTransaction"("orderId", "type");');
  if (!indexExists('LoyaltyTransaction_userId_createdAt_idx')) db.exec('CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");');

  if (!tableExists('Review')) {
    db.exec(`CREATE TABLE "Review" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "rating" INTEGER NOT NULL,
      "comment" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "userId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "orderItemId" TEXT NOT NULL,
      CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Review_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );`);
  }
  if (!indexExists('Review_orderItemId_key')) db.exec('CREATE UNIQUE INDEX "Review_orderItemId_key" ON "Review"("orderItemId");');
  if (!indexExists('Review_productId_status_createdAt_idx')) db.exec('CREATE INDEX "Review_productId_status_createdAt_idx" ON "Review"("productId", "status", "createdAt");');
  if (!indexExists('Review_userId_createdAt_idx')) db.exec('CREATE INDEX "Review_userId_createdAt_idx" ON "Review"("userId", "createdAt");');

  db.prepare(`INSERT OR IGNORE INTO "LoyaltySetting" ("id", "enabled", "pointsPerOrder", "minimumRedeemPoints", "pointValueCents", "updatedAt") VALUES ('default', 1, 5, 50, 100, CURRENT_TIMESTAMP)`).run();
});

// Existing COD orders must also appear in the payment ledger after an upgrade.
db.prepare(`INSERT INTO Payment (id, transactionId, provider, status, amountCents, currency, paidAt, createdAt, updatedAt, orderId)
 SELECT 'legacy_' || id, 'LEGACY-' || id, 'COD',
 CASE WHEN paymentStatus IN ('PAID','REFUNDED') THEN paymentStatus WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
 totalCents, ?, CASE WHEN paymentStatus = 'PAID' THEN updatedAt ELSE NULL END, createdAt, updatedAt, id
 FROM "Order" WHERE paymentMethod = 'COD' AND id NOT IN (SELECT orderId FROM Payment)`).run(process.env.PAYMENT_CURRENCY || 'USD');

db.close();
console.log(`Database initialized and verified at ${databasePath}`);
