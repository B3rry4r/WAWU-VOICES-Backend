-- Rule W: every daily question offers the four mood words. Data only, no schema change.
-- A question that already has an answer keeps its empty list (when the list is not empty, every answer must carry a word).
-- Safe to run twice: the second run finds no empty list left among the answerless daily questions.
UPDATE "Question" q
SET "moodOptions" = ARRAY['ANGRY','TIRED','PROUD','HOPEFUL']::"Mood"[]
WHERE q."kind" = 'DAILY'
  AND cardinality(q."moodOptions") = 0
  AND NOT EXISTS (SELECT 1 FROM "Answer" a WHERE a."questionId" = q."id");
