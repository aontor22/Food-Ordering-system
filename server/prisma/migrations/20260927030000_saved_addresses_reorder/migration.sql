-- Step 12: saved customer delivery addresses. Reorder uses existing immutable order snapshots and requires no new table.
CREATE TABLE "SavedAddress" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Home',
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "street" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'Bangladesh',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "SavedAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedAddress_userId_isDefault_updatedAt_idx"
  ON "SavedAddress"("userId", "isDefault", "updatedAt");

-- Default-address uniqueness is maintained inside SERIALIZABLE account-scoped API transactions.

ALTER TABLE "SavedAddress"
  ADD CONSTRAINT "SavedAddress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
