-- Step 19: structured operational event tracking for production monitoring.
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requestId" TEXT,
    "route" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationalEvent_createdAt_idx" ON "OperationalEvent"("createdAt");
CREATE INDEX "OperationalEvent_level_createdAt_idx" ON "OperationalEvent"("level", "createdAt");
CREATE INDEX "OperationalEvent_source_createdAt_idx" ON "OperationalEvent"("source", "createdAt");
CREATE INDEX "OperationalEvent_code_createdAt_idx" ON "OperationalEvent"("code", "createdAt");
CREATE INDEX "OperationalEvent_requestId_idx" ON "OperationalEvent"("requestId");
