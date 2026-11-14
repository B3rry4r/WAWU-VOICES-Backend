-- V-HOTFIX-1 round 4. Additive only.
-- 1. The charge sweeper's start time: one row, set to the moment this migration is applied. The sweeper never reads a
--    charge made before it (those were made by code that did not link a charge to its post).
CREATE TABLE "ChargeSweeperState" (
  "id"      INTEGER      NOT NULL DEFAULT 1,
  "startAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "ChargeSweeperState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChargeSweeperState_one_row" CHECK ("id" = 1)
);
INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, (now() AT TIME ZONE 'UTC'));

-- 2. The sweeper's read: committed, unlinked charges of the post actions, oldest first.
CREATE INDEX "Charge_sweep_idx" ON "Charge" ("createdAt", "id")
  WHERE "status" = 'COMMITTED' AND "refId" IS NULL AND "action" IN ('POST_TEXT', 'POST_VOICE');

-- 3. The sweeper's removal of dead (unfinished for 30 minutes) retry records reads only unfinished ones.
CREATE INDEX "IdempotencyRecord_unfinished_idx" ON "IdempotencyRecord" ("createdAt") WHERE "completedAt" IS NULL;
