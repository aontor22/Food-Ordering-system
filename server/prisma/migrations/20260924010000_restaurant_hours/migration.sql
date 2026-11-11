CREATE TABLE "RestaurantSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
  "temporaryClosed" BOOLEAN NOT NULL DEFAULT false,
  "temporaryClosedReason" TEXT,
  "temporaryClosedUntilLocal" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OpeningHour" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dayOfWeek" INTEGER NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "open24Hours" BOOLEAN NOT NULL DEFAULT true,
  "openMinute" INTEGER NOT NULL DEFAULT 0,
  "closeMinute" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "OpeningHour_dayOfWeek_key" ON "OpeningHour"("dayOfWeek");

CREATE TABLE "RestaurantClosure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dateKey" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "RestaurantClosure_dateKey_key" ON "RestaurantClosure"("dateKey");

INSERT INTO "RestaurantSetting" ("id", "timezone", "acceptingOrders", "temporaryClosed", "updatedAt")
VALUES ('default', 'Asia/Dhaka', true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "OpeningHour" ("id", "dayOfWeek", "isClosed", "open24Hours", "openMinute", "closeMinute", "updatedAt") VALUES
('hours-sun', 0, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-mon', 1, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-tue', 2, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-wed', 3, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-thu', 4, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-fri', 5, false, true, 0, 0, CURRENT_TIMESTAMP),
('hours-sat', 6, false, true, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("dayOfWeek") DO NOTHING;
