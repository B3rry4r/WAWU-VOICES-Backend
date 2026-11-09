-- LCH-07: the voice made into a short video, only on request. Additive: one new enum, one new value on FileKind, one new
-- table. Nothing existing is renamed, retyped or removed.
ALTER TYPE "FileKind" ADD VALUE IF NOT EXISTS 'VOICE_VIDEO';

CREATE TYPE "VoiceVideoStatus" AS ENUM ('QUEUED', 'MAKING', 'READY', 'FAILED', 'REMOVED');

CREATE TABLE "VoiceVideo" (
  "id" TEXT NOT NULL,
  "answerId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "shape" TEXT NOT NULL,
  "status" "VoiceVideoStatus" NOT NULL DEFAULT 'QUEUED',
  "fileId" TEXT,
  "durationMs" INTEGER,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  CONSTRAINT "VoiceVideo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VoiceVideo_answerId_shape_key" ON "VoiceVideo"("answerId", "shape");
CREATE INDEX "VoiceVideo_authorId_createdAt_idx" ON "VoiceVideo"("authorId", "createdAt");
CREATE INDEX "VoiceVideo_status_createdAt_idx" ON "VoiceVideo"("status", "createdAt");
ALTER TABLE "VoiceVideo" ADD CONSTRAINT "VoiceVideo_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceVideo" ADD CONSTRAINT "VoiceVideo_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
