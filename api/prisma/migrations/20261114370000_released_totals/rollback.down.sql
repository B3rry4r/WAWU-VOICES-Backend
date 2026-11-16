-- DOWN for 20261114370000_released_totals (run only with the API of the previous release; then delete the
-- _prisma_migrations row). Refuses (raises, changes nothing) while any survey holds released totals: they cannot be
-- rebuilt. Clear them on purpose first if you mean to.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SponsoredSurvey" WHERE "releasedTotals" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a survey holds the totals it was released with';
  END IF;
END $$;
ALTER TABLE "SponsoredSurvey" DROP COLUMN "releasedTotals";
COMMIT;
