-- DOWN for 20261115100000_daily_words (run only with the previous API release; then delete the _prisma_migrations row).
-- Sets a daily question's word list back to empty only where no answer carries a word. Refuses (raises, changes nothing)
-- if any daily question other than the launch question has a word list AND an answer that carries a word: those words
-- exist nowhere else. The launch question keeps its words.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Question" q
    WHERE q."kind" = 'DAILY' AND q."seedKey" IS DISTINCT FROM 'launch-mood-1'
      AND cardinality(q."moodOptions") > 0
      AND EXISTS (SELECT 1 FROM "Answer" a WHERE a."questionId" = q."id" AND a."mood" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'rollback refused: a daily question with words has an answer that carries a word';
  END IF;
END $$;
UPDATE "Question" q
SET "moodOptions" = ARRAY[]::"Mood"[]
WHERE q."kind" = 'DAILY' AND q."seedKey" IS DISTINCT FROM 'launch-mood-1'
  AND cardinality(q."moodOptions") > 0
  AND NOT EXISTS (SELECT 1 FROM "Answer" a WHERE a."questionId" = q."id" AND a."mood" IS NOT NULL);
COMMIT;
