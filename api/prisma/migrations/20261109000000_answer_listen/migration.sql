-- LISTEN-1: who listened, kept on the server for the ranking. Additive: one new table, nothing existing changes.
-- One row per person per answer. A signed-in person has userId; a guest has visitorKey (a keyed hash, never a raw id).
CREATE TABLE "AnswerListen" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "userId" TEXT,
    "visitorKey" TEXT,
    "secondsPlayed" INTEGER NOT NULL DEFAULT 0,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerListen_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnswerListen_one_listener" CHECK (("userId" IS NULL) <> ("visitorKey" IS NULL)),
    CONSTRAINT "AnswerListen_seconds_nonneg" CHECK ("secondsPlayed" >= 0)
);

CREATE UNIQUE INDEX "AnswerListen_answerId_userId_key" ON "AnswerListen"("answerId", "userId");
CREATE UNIQUE INDEX "AnswerListen_answerId_visitorKey_key" ON "AnswerListen"("answerId", "visitorKey");
CREATE INDEX "AnswerListen_answerId_finished_idx" ON "AnswerListen"("answerId", "finished");
CREATE INDEX "AnswerListen_userId_idx" ON "AnswerListen"("userId");
-- The guest clean-up reads only guest rows by age.
CREATE INDEX "AnswerListen_guest_lastAt_idx" ON "AnswerListen"("lastAt") WHERE "visitorKey" IS NOT NULL;

ALTER TABLE "AnswerListen" ADD CONSTRAINT "AnswerListen_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnswerListen" ADD CONSTRAINT "AnswerListen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
