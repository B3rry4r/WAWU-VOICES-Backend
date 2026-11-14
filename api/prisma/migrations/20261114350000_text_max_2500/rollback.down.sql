-- DOWN for 20261114350000_text_max_2500 (run with the previous release's API; then delete the _prisma_migrations row).
-- Only a value still exactly 2500 goes back to 5000; a value an admin chose since is left alone.
BEGIN;
WITH changed AS (
  UPDATE "ConfigEntry" SET "valueJson" = to_jsonb(5000), "version" = "version" + 1, "updatedAt" = now()
   WHERE "key" = 'text.max_chars' AND "valueJson" = to_jsonb(2500)
  RETURNING "key"
)
INSERT INTO "ConfigChange" ("id", "key", "oldValue", "newValue", "reason", "changedById", "createdAt")
SELECT gen_random_uuid()::text, "key", to_jsonb(2500), to_jsonb(5000), 'V-TEXT2500 rollback', 'system', now() FROM changed;
COMMIT;
