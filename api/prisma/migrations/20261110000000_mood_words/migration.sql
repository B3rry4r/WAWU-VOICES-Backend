-- LCH-02 / LCH-03: mood words. Additive: one new enum, two new columns with a safe default on Answer and Question, one
-- new index. Nothing existing is renamed, retyped or removed; every existing row keeps working (no mood, no options).
CREATE TYPE "Mood" AS ENUM ('ANGRY', 'TIRED', 'PROUD', 'HOPEFUL');

ALTER TABLE "Question" ADD COLUMN "moodOptions" "Mood"[] DEFAULT ARRAY[]::"Mood"[];
ALTER TABLE "Answer" ADD COLUMN "mood" "Mood";
ALTER TABLE "Answer" ADD COLUMN "showNameOnCard" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Answer_questionId_mood_status_idx" ON "Answer"("questionId", "mood", "status");
