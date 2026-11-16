-- V-TEXT2500 (owner, 14 Nov 2026): the longest written post is 2,500 characters (it was 5,000). Data only; nothing is dropped.
-- A stored value an admin chose (anything that is not exactly 5000) is never touched. No row: nothing to do (the code default is now 2500).
-- A post already stored that is longer than 2,500 stays as it is and can still be read.
WITH changed AS (
  UPDATE "ConfigEntry" SET "valueJson" = to_jsonb(2500), "version" = "version" + 1, "updatedAt" = now()
   WHERE "key" = 'text.max_chars' AND "valueJson" = to_jsonb(5000)
  RETURNING "key"
)
INSERT INTO "ConfigChange" ("id", "key", "oldValue", "newValue", "reason", "changedById", "createdAt")
SELECT gen_random_uuid()::text, "key", to_jsonb(5000), to_jsonb(2500), 'V-TEXT2500: longest written post is 2500 characters (owner, 14 Nov 2026)', 'system', now() FROM changed;
