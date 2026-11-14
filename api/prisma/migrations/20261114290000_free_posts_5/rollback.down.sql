-- DOWN for 20261114290000_free_posts_5 (run with the previous release's API; then delete the _prisma_migrations row).
BEGIN;
ALTER TABLE "FreeAllowance" ALTER COLUMN "freePostsRemaining" SET DEFAULT 2;
DO $$
DECLARE chosen boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM "ConfigEntry" WHERE "key" = 'allowance.free_posts' AND "valueJson" NOT IN (to_jsonb(2), to_jsonb(5))) INTO chosen;
  IF NOT chosen THEN
    UPDATE "FreeAllowance" SET "freePostsRemaining" = GREATEST(0, 2 - "freePostsUsed"), "updatedAt" = now()
     WHERE "freePostsRemaining" = GREATEST(0, 5 - "freePostsUsed");
    UPDATE "ConfigEntry" SET "valueJson" = to_jsonb(2), "version" = "version" + 1, "updatedAt" = now()
     WHERE "key" = 'allowance.free_posts' AND "valueJson" = to_jsonb(5);
  END IF;
END $$;
COMMIT;
