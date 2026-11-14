-- DOWN for 20261114230000_fixb_alerts_2 (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any person has switched news tag alerts off: that choice cannot be rebuilt, so
-- clear it on purpose first (UPDATE "UserSettings" SET "notifyTagFollows" = true;) if you mean to lose it. The markers only
-- say a fan-out was started this hour; dropping them loses nothing.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UserSettings" WHERE "notifyTagFollows" = false) THEN
    RAISE EXCEPTION 'rollback refused: people have switched news tag alerts off';
  END IF;
END $$;
DROP TABLE "AlertMarker";
ALTER TABLE "UserSettings" DROP COLUMN "notifyTagFollows";
COMMIT;
