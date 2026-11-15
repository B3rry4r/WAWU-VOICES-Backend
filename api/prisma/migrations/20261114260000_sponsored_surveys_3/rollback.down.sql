-- DOWN for 20261114260000_sponsored_surveys_3 (run only with the API of the previous release; then delete the
-- _prisma_migrations row). Refuses (raises, changes nothing) while a survey records that staff read its free answers:
-- that cannot be rebuilt. Clear those on purpose first if you mean to.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SponsoredSurvey" WHERE "reviewedAt" IS NOT NULL OR "reviewedById" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a survey records that staff read its free answers';
  END IF;
END $$;
ALTER TABLE "SponsoredSurvey" DROP COLUMN "reviewedById";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "reviewedAt";
COMMIT;
