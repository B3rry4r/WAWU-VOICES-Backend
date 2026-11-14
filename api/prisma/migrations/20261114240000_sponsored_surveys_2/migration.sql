-- V-SURVEYS round 2. Additive only: nullable columns and columns with a default, one index. Nothing is renamed,
-- retyped or removed, and no existing row changes.

-- The frozen results of a survey, the staff review of its free answers, and the release to the brand.
ALTER TABLE "SponsoredSurvey" ADD COLUMN "snapshotAt" TIMESTAMP(3);
ALTER TABLE "SponsoredSurvey" ADD COLUMN "reportSnapshot" JSONB;
ALTER TABLE "SponsoredSurvey" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "SponsoredSurvey" ADD COLUMN "releasedById" TEXT;
ALTER TABLE "SponsoredSurvey" ADD COLUMN "releasedHiddenCount" INTEGER;
ALTER TABLE "SponsoredSurvey" ADD COLUMN "releasedReport" JSONB;

-- A free answer or transcript staff hid before release.
ALTER TABLE "SurveyAnswer" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SurveyAnswer" ADD COLUMN "hiddenById" TEXT;
ALTER TABLE "SurveyAnswer" ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- An advert belongs to a brand page only when the ad manager set it.
ALTER TABLE "Ad" ADD COLUMN "brandId" TEXT;
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Ad_brandId_status_idx" ON "Ad"("brandId", "status");

-- The person's own consent to be shown surveys aimed at their state. Off for everyone until they turn it on.
ALTER TABLE "UserSettings" ADD COLUMN "useMyStateForSurveys" BOOLEAN NOT NULL DEFAULT false;

-- Nothing may say who completed a survey: the COMPLETE event no longer carries a user id (new code writes none). Rows
-- written by the first round lose theirs. Only COMPLETE rows of the survey tables change; no existing table is touched.
UPDATE "SurveyEvent" SET "userId" = NULL WHERE "kind" = 'COMPLETE';
