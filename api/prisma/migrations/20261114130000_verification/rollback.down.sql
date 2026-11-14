-- DOWN for 20261114130000_verification (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any VerificationRequest exists: a row is a decision about a real person's identity
-- documents, and a pending or decided row may still point at files in the private bucket that only this release deletes.
-- Data steps: the free allowance goes back to 10 (remaining = max(0, 10 - used)) and the two config values go back to 10 only
-- where they still hold the V-46 values (2 and 60).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "VerificationRequest") THEN
    RAISE EXCEPTION 'rollback refused: VerificationRequest has rows';
  END IF;
END $$;
DROP TABLE "VerificationRequest";
ALTER TABLE "User" DROP COLUMN "verifiedUntil", DROP COLUMN "verificationStatus";
DROP TYPE "VerificationStatus";
ALTER TABLE "FreeAllowance" ALTER COLUMN "freePostsRemaining" SET DEFAULT 10;
UPDATE "FreeAllowance" SET "freePostsRemaining" = GREATEST(0, 10 - "freePostsUsed");
UPDATE "ConfigEntry" SET "valueJson" = to_jsonb(10), "version" = "version" + 1, "updatedAt" = now()
 WHERE ("key" = 'allowance.free_posts' AND "valueJson" = to_jsonb(2))
    OR ("key" = 'voice.free_seconds' AND "valueJson" = to_jsonb(60));
COMMIT;
