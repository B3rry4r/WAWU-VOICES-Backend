-- V-SURVEYS round 3. Additive only: two nullable columns. Nothing is renamed, retyped or removed, and no existing row
-- changes.

-- Release of a survey with written or voice answers needs staff to have been served the whole free-answer review list.
ALTER TABLE "SponsoredSurvey" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "SponsoredSurvey" ADD COLUMN "reviewedById" TEXT;
