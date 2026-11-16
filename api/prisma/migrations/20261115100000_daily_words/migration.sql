-- Rule W: a daily question that has not opened yet offers the four mood words. Data only, no schema change.
-- A DAILY question gets the words only when ALL of these hold when this runs:
--   * its list is empty;
--   * it has no answer row at all (when the list is not empty, every answer must carry a word);
--   * it is not CLOSED;
--   * it has not opened yet, by the same idea as isQuestionOpen (src/feed/question-window.ts): its startsAt is null or
--     later than now, and it is not a LIVE question without a start (that one counts as open).
-- A question that is open, over or closed when this runs is never touched, so nobody recording on it has the form
-- change under them. Safe to run twice: the second run finds no empty list left among the questions it covers.
UPDATE "Question" q
SET "moodOptions" = ARRAY['ANGRY','TIRED','PROUD','HOPEFUL']::"Mood"[]
WHERE q."kind" = 'DAILY'
  AND cardinality(q."moodOptions") = 0
  AND q."status" IN ('DRAFT', 'SCHEDULED', 'LIVE')
  AND NOT (q."status" = 'LIVE' AND q."startsAt" IS NULL)
  AND (q."startsAt" IS NULL OR q."startsAt" > now())
  AND NOT EXISTS (SELECT 1 FROM "Answer" a WHERE a."questionId" = q."id");
