-- V-FREE5 (owner, 14 Nov 2026): the free allowance is 5 posts (V-46 had 2). Data only, plus the column DEFAULT. Nothing is dropped.
-- A ConfigEntry value an admin chose (anything that is not exactly 2) is never touched, and then no allowance row is touched either.
ALTER TABLE "FreeAllowance" ALTER COLUMN "freePostsRemaining" SET DEFAULT 5;

DO $$
DECLARE chosen boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM "ConfigEntry" WHERE "key" = 'allowance.free_posts' AND "valueJson" <> to_jsonb(2)) INTO chosen;
  IF NOT chosen THEN
    -- People keep their count: remaining = max(0, 5 - used), only for rows still in the V-46 shape (remaining = max(0, 2 - used)).
    UPDATE "FreeAllowance" SET "freePostsRemaining" = GREATEST(0, 5 - "freePostsUsed"), "updatedAt" = now()
     WHERE "freePostsRemaining" = GREATEST(0, 2 - "freePostsUsed");
    WITH changed AS (
      UPDATE "ConfigEntry" SET "valueJson" = to_jsonb(5), "version" = "version" + 1, "updatedAt" = now()
       WHERE "key" = 'allowance.free_posts' AND "valueJson" = to_jsonb(2)
      RETURNING "key"
    )
    INSERT INTO "ConfigChange" ("id", "key", "oldValue", "newValue", "reason", "changedById", "createdAt")
    SELECT gen_random_uuid()::text, "key", to_jsonb(2), to_jsonb(5), 'V-FREE5: 5 free posts (owner, 14 Nov 2026)', 'system', now() FROM changed;
  END IF;
END $$;
