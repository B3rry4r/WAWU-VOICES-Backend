-- V-HOTFIX-1 round 4. Additive only.
-- 1. The charge sweeper's start time: one row, created with NO start time. The API stamps it itself, once, the first time
--    the new code boots (after the old process has stopped), so a post made by the old code (which never links its charge)
--    is never read, however long a deploy that migrated and failed to switch leaves the old code serving.
--    The sweeper never reads a charge made before the start time, and reads nothing while there is none.
CREATE TABLE "ChargeSweeperState" (
  "id"      INTEGER      NOT NULL DEFAULT 1,
  "startAt" TIMESTAMP(3),
  CONSTRAINT "ChargeSweeperState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChargeSweeperState_one_row" CHECK ("id" = 1)
);
INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, NULL);

-- 2. The sweeper's read: committed, unlinked charges of the post actions, oldest first.
CREATE INDEX "Charge_sweep_idx" ON "Charge" ("createdAt", "id")
  WHERE "status" = 'COMMITTED' AND "refId" IS NULL AND "action" IN ('POST_TEXT', 'POST_VOICE');

-- 3. The sweeper's removal of dead (unfinished for 30 minutes) retry records reads only unfinished ones.
CREATE INDEX "IdempotencyRecord_unfinished_idx" ON "IdempotencyRecord" ("createdAt") WHERE "completedAt" IS NULL;
