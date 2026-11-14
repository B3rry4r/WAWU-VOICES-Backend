-- V-46 (V-VERIFY): verification by ID and utility bill, and the free allowance cut to 2 posts of up to 60 seconds.
-- ADDITIVE ONLY: one new enum, one new table, two new nullable columns on "User". The "FreeAllowance"."freePostsRemaining"
-- column keeps its type; only its DEFAULT and the stored values change (see the two data steps at the end).

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "verificationStatus" "VerificationStatus",
ADD COLUMN     "verifiedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "idDocKey" TEXT,
    "idDocMime" TEXT,
    "idDocBytes" INTEGER,
    "billDocKey" TEXT,
    "billDocMime" TEXT,
    "billDocBytes" INTEGER,
    "subscriptionId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "reasonCode" TEXT,
    "reasonNote" TEXT,
    "docsPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRequest_status_submittedAt_idx" ON "VerificationRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_userId_createdAt_idx" ON "VerificationRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_docsPurgedAt_decidedAt_idx" ON "VerificationRequest"("docsPurgedAt", "decidedAt");

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one open request (DRAFT or PENDING) per person. Not expressible in schema.prisma; the database enforces it.
CREATE UNIQUE INDEX "VerificationRequest_one_open_per_user" ON "VerificationRequest"("userId") WHERE "status" IN ('DRAFT', 'PENDING');

-- Data step 1: the free allowance is 2 posts (was 10). Remaining becomes max(0, 2 - used): never negative.
ALTER TABLE "FreeAllowance" ALTER COLUMN "freePostsRemaining" SET DEFAULT 2;
UPDATE "FreeAllowance" SET "freePostsRemaining" = GREATEST(0, 2 - "freePostsUsed");

-- Data step 2: the two config values, only where they still hold the old launch default (an admin's own number stays).
-- Each change is logged in ConfigChange like an admin edit.
WITH changed AS (
  UPDATE "ConfigEntry" c
     SET "valueJson" = CASE c."key" WHEN 'allowance.free_posts' THEN to_jsonb(2) ELSE to_jsonb(60) END,
         "version" = c."version" + 1,
         "updatedAt" = now()
   WHERE (c."key" = 'allowance.free_posts' AND c."valueJson" = to_jsonb(10))
      OR (c."key" = 'voice.free_seconds' AND c."valueJson" = to_jsonb(10))
  RETURNING c."key", c."valueJson"
)
INSERT INTO "ConfigChange" ("id", "key", "oldValue", "newValue", "reason", "changedById", "createdAt")
SELECT gen_random_uuid()::text, "key", to_jsonb(10), "valueJson", 'V-46: 2 free posts of up to 60 seconds (owner, 14 Nov 2026)', 'system', now()
  FROM changed;
