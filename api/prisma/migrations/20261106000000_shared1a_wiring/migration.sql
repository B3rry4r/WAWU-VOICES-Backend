-- SHARED-1a: additive only. Hand-written (never migrate dev/diff: they drop the tsvector columns).

-- Helpful marks get a table of their own.
CREATE TABLE "Helpful" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Helpful_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Helpful_answerId_userId_key" ON "Helpful"("answerId", "userId");
CREATE INDEX "Helpful_userId_idx" ON "Helpful"("userId");
ALTER TABLE "Helpful" ADD CONSTRAINT "Helpful_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Helpful" ADD CONSTRAINT "Helpful_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move talk's old marks (IdempotencyRecord key "helpful:<answerId>") into it, then drop them.
-- The uuid v7 ids are not needed to be time ordered here: gen_random_uuid() is enough for old rows.
INSERT INTO "Helpful" ("id", "answerId", "userId", "createdAt")
SELECT gen_random_uuid()::text, substr(r."key", 9), r."actorId", r."createdAt"
FROM "IdempotencyRecord" r
JOIN "Answer" a ON a."id" = substr(r."key", 9)
JOIN "User" u ON u."id" = r."actorId"
WHERE r."key" LIKE 'helpful:%'
ON CONFLICT ("answerId", "userId") DO NOTHING;
DELETE FROM "IdempotencyRecord" WHERE "key" LIKE 'helpful:%';

-- Money and media columns.
ALTER TABLE "Payment" ADD COLUMN "overpaidKobo" INTEGER;
ALTER TABLE "ExtraVoiceToken" ADD COLUMN "reservedAt" TIMESTAMP(3);
-- A token already RESERVED carries its reservation time in usedAt today.
UPDATE "ExtraVoiceToken" SET "reservedAt" = "usedAt" WHERE "status" = 'RESERVED';
ALTER TABLE "VoiceClip" ADD COLUMN "processingStartedAt" TIMESTAMP(3);

-- User.voiceCount with backfill: published, non-anonymous voice answers (what the profile counted until now).
ALTER TABLE "User" ADD COLUMN "voiceCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" u SET "voiceCount" = c.n FROM (
  SELECT "authorId" AS uid, count(*)::int AS n FROM "Answer"
  WHERE "kind" = 'VOICE' AND "anonymous" = false AND "status" = 'PUBLISHED' GROUP BY "authorId"
) c WHERE u."id" = c.uid;

-- Question: the importer's fields.
ALTER TABLE "Question" ADD COLUMN "editStatus" TEXT;
ALTER TABLE "Question" ADD COLUMN "originalText" TEXT;
