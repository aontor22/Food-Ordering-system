-- Step 18: authentication hardening.
-- Existing accounts predate mandatory email verification, so they are grandfathered
-- as verified to avoid locking current production users out after deployment.
ALTER TABLE "User"
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorSecretEncrypted" TEXT,
  ADD COLUMN "twoFactorRecoveryCodesJson" TEXT,
  ADD COLUMN "twoFactorEnabledAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorLastUsedStep" INTEGER;

ALTER TABLE "Session"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "emailVerifiedAt" IS NULL;

CREATE TABLE "AuthToken" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "metadataJson" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_type_expiresAt_idx" ON "AuthToken"("userId", "type", "expiresAt");
CREATE INDEX "AuthToken_type_expiresAt_idx" ON "AuthToken"("type", "expiresAt");

ALTER TABLE "AuthToken"
  ADD CONSTRAINT "AuthToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
