-- DOWN for 20261107000000_privacy_fix (run only with the API of the previous release; then delete the _prisma_migrations row).
-- WARNING: the P1 scrub CANNOT be undone. The personal fields it removed from Payment."rawVerify" (name, email, IP,
-- device fingerprint, card first 6, expiry, issuer) are gone for good; this script reverses the schema changes only.
-- The last statement fails (and rolls everything back) while any result post has no author: those totals are a public
-- civic record, so this script never deletes them. Re-point them to a tombstone user first if you must go back.
BEGIN;
DROP INDEX "StoredFile_purgedAt_purgeRequestedAt_idx";
DROP INDEX "VoiceClip_storagePurgedAt_status_idx";
ALTER TABLE "StoredFile" DROP COLUMN "purgedAt", DROP COLUMN "purgeRequestedAt";
ALTER TABLE "VoiceClip" DROP COLUMN "storagePurgedAt";
ALTER TABLE "ResultPost" ALTER COLUMN "authorId" SET NOT NULL;
COMMIT;
