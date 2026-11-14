-- V-FIX-B: markers so the alert sweep writes each poll-closed and category notice once. Additive: two nullable columns.
-- A poll that already ended and a question that already opened are marked now, so the first sweep after deploy does not
-- announce old things.
ALTER TABLE "Poll" ADD COLUMN "closeAlertedAt" TIMESTAMP(3);
ALTER TABLE "Question" ADD COLUMN "categoryAlertedAt" TIMESTAMP(3);
UPDATE "Poll" SET "closeAlertedAt" = CURRENT_TIMESTAMP WHERE "endsAt" <= CURRENT_TIMESTAMP;
UPDATE "Question" SET "categoryAlertedAt" = CURRENT_TIMESTAMP WHERE "startsAt" IS NOT NULL AND "startsAt" <= CURRENT_TIMESTAMP;
