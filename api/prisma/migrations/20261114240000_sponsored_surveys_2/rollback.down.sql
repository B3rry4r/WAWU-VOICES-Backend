-- DOWN for 20261114240000_sponsored_surveys_2 (run only with the API of the previous release; then delete the
-- _prisma_migrations row). Refuses (raises, changes nothing) while it would throw away something that cannot be rebuilt:
-- a frozen or released survey result, a hidden free answer, an advert tied to a brand, or a person's survey consent
-- switched on. Clear those on purpose first if you mean to.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SponsoredSurvey" WHERE "snapshotAt" IS NOT NULL OR "reportSnapshot" IS NOT NULL OR "releasedAt" IS NOT NULL OR "releasedReport" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a survey has a frozen or released result';
  END IF;
  IF EXISTS (SELECT 1 FROM "SurveyAnswer" WHERE "hidden" OR "hiddenById" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a survey answer was hidden by staff';
  END IF;
  IF EXISTS (SELECT 1 FROM "Ad" WHERE "brandId" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: an advert is tied to a brand';
  END IF;
  IF EXISTS (SELECT 1 FROM "UserSettings" WHERE "useMyStateForSurveys") THEN
    RAISE EXCEPTION 'rollback refused: a person turned on useMyStateForSurveys';
  END IF;
END $$;
DROP INDEX "Ad_brandId_status_idx";
ALTER TABLE "Ad" DROP CONSTRAINT "Ad_brandId_fkey";
ALTER TABLE "Ad" DROP COLUMN "brandId";
ALTER TABLE "UserSettings" DROP COLUMN "useMyStateForSurveys";
ALTER TABLE "SurveyAnswer" DROP COLUMN "hiddenAt";
ALTER TABLE "SurveyAnswer" DROP COLUMN "hiddenById";
ALTER TABLE "SurveyAnswer" DROP COLUMN "hidden";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "releasedReport";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "releasedHiddenCount";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "releasedById";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "releasedAt";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "reportSnapshot";
ALTER TABLE "SponsoredSurvey" DROP COLUMN "snapshotAt";
COMMIT;
