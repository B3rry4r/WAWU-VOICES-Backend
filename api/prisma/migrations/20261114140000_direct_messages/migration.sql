-- V-DM: one-to-one direct messages. ADDITIVE ONLY: three new tables (DmConversation, DmMessage, DmMute), one defaulted column (UserSettings.dmOpen)
-- and four new enum values (VoiceClipPurpose DM, ReportTargetType DM_MESSAGE, ChargeAction DM_TEXT and DM_VOICE). Nothing existing is renamed, retyped or removed.
-- The new enum values are not used inside this migration (PostgreSQL forbids that in the same transaction).
-- AlterEnum
ALTER TYPE "VoiceClipPurpose" ADD VALUE IF NOT EXISTS 'DM';

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'DM_MESSAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChargeAction" ADD VALUE IF NOT EXISTS 'DM_TEXT';
ALTER TYPE "ChargeAction" ADD VALUE IF NOT EXISTS 'DM_VOICE';

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "dmOpen" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DmConversation" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmMute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" "PostKind" NOT NULL,
    "body" TEXT,
    "clipId" TEXT,
    "durationMs" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "idempotencyKey" TEXT NOT NULL,
    "costMilli" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DmConversation_userAId_lastMessageAt_idx" ON "DmConversation"("userAId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "DmConversation_userBId_lastMessageAt_idx" ON "DmConversation"("userBId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "DmConversation_userAId_userBId_key" ON "DmConversation"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "DmMute_conversationId_idx" ON "DmMute"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "DmMute_userId_conversationId_key" ON "DmMute"("userId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "DmMessage_clipId_key" ON "DmMessage"("clipId");

-- CreateIndex
CREATE INDEX "DmMessage_conversationId_createdAt_id_idx" ON "DmMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DmMessage_recipientId_readAt_idx" ON "DmMessage"("recipientId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "DmMessage_senderId_idempotencyKey_key" ON "DmMessage"("senderId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "DmConversation" ADD CONSTRAINT "DmConversation_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmConversation" ADD CONSTRAINT "DmConversation_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmMessage" ADD CONSTRAINT "DmMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DmConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmMessage" ADD CONSTRAINT "DmMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmMessage" ADD CONSTRAINT "DmMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmMessage" ADD CONSTRAINT "DmMessage_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

