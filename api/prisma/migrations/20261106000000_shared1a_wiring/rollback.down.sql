-- DOWN for 20261106000000_shared1a_wiring (run only with the API of the previous release; then delete the _prisma_migrations row)
BEGIN;
INSERT INTO "IdempotencyRecord"("id","actorId","key","method","path","requestHash","statusCode","completedAt","expiresAt","createdAt")
SELECT gen_random_uuid()::text,"userId",'helpful:'||"answerId",'PUT','/answers/'||"answerId"||'/helpful','-',204,"createdAt",'9999-12-31',"createdAt" FROM "Helpful"
ON CONFLICT ("actorId","key") DO NOTHING;
UPDATE "ExtraVoiceToken" SET "usedAt" = "reservedAt" WHERE "status"='RESERVED' AND "usedAt" IS NULL;
DROP TABLE "Helpful";
ALTER TABLE "Payment" DROP COLUMN "overpaidKobo";
ALTER TABLE "ExtraVoiceToken" DROP COLUMN "reservedAt";
ALTER TABLE "VoiceClip" DROP COLUMN "processingStartedAt";
ALTER TABLE "User" DROP COLUMN "voiceCount";
ALTER TABLE "Question" DROP COLUMN "editStatus", DROP COLUMN "originalText";
COMMIT;
