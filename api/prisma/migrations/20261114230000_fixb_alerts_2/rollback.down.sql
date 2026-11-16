-- DOWN for 20261114230000_fixb_alerts_2 (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any person has switched news tag alerts off: that choice cannot be rebuilt, so
-- clear it on purpose first (UPDATE "UserSettings" SET "notifyTagFollows" = true;) if you mean to lose it. The AlertMarker rows
-- are of two kinds: tag-follow:<TAG>:<hour> (a fan-out was started that hour; dropping them loses nothing) and
-- verified-announced:<answerId> (this post was announced as Verified News; dropping them means a later release could announce
-- those posts a second time, so keep a copy of the table if the next release will announce Verified News again).
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
