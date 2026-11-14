-- V-TOPIC-MAILS-2 round 6. Additive only.
-- 1. TopicMailSkip.strikes: how many named refusals in a row (the wait grows 1 h, 6 h, 24 h, 7 days). Rows that exist keep 1.
ALTER TABLE "TopicMailSkip" ADD COLUMN "strikes" INTEGER NOT NULL DEFAULT 1;

-- 2. TopicMailTrouble: relay trouble of one person in one sending window. User id, template and window only.
CREATE TABLE "TopicMailTrouble" (
    "userId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "troubles" INTEGER NOT NULL DEFAULT 0,
    "lastTroubleAt" TIMESTAMP(3) NOT NULL,
    "asideAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicMailTrouble_pkey" PRIMARY KEY ("userId","template","window")
);
CREATE INDEX "TopicMailTrouble_template_window_idx" ON "TopicMailTrouble"("template", "window");
CREATE INDEX "TopicMailTrouble_lastTroubleAt_idx" ON "TopicMailTrouble"("lastTroubleAt");
