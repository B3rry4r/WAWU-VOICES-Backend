-- LCH-07 fix round 1: every build is its own row (a retry or a restored answer adds one, so each counts toward the day's
-- cap), and the ready or failed notice has its own type. Additive: one enum value, one unique index swapped for a plain one.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VIDEO_READY';
DROP INDEX IF EXISTS "VoiceVideo_answerId_shape_key";
CREATE INDEX "VoiceVideo_answerId_shape_createdAt_idx" ON "VoiceVideo"("answerId", "shape", "createdAt");
