-- DOWN for 20261110000000_mood_words (run only with the API of the previous release; then delete the _prisma_migrations row).
-- WARNING: this deletes every stored mood word, every question's mood options and every "Show my name on the card"
-- choice. They exist nowhere else, so take a copy first if you want to keep them. Answers themselves are untouched.
BEGIN;
DROP INDEX "Answer_questionId_mood_status_idx";
ALTER TABLE "Answer" DROP COLUMN "showNameOnCard";
ALTER TABLE "Answer" DROP COLUMN "mood";
ALTER TABLE "Question" DROP COLUMN "moodOptions";
DROP TYPE "Mood";
COMMIT;
