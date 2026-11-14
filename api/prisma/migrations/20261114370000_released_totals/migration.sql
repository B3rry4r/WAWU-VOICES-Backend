-- V-SURVEYS round 6 (M2). Additive only: one nullable column. The totals of a survey at the moment its results were
-- released, kept so that a later account deletion changes no number shown for a released survey.
ALTER TABLE "SponsoredSurvey" ADD COLUMN "releasedTotals" JSONB;

-- Released surveys already on the system: their totals as they stand now.
UPDATE "SponsoredSurvey" s
   SET "releasedTotals" = jsonb_build_object(
     'views',     (SELECT count(*) FROM "SurveyEvent" e WHERE e."surveyId" = s."id" AND e."kind" = 'VIEW'),
     'starts',    (SELECT count(*) FROM "SurveyEvent" e WHERE e."surveyId" = s."id" AND e."kind" = 'START'),
     'skips',     (SELECT count(*) FROM "SurveyEvent" e WHERE e."surveyId" = s."id" AND e."kind" = 'SKIP'),
     'responses', (SELECT count(*) FROM "SurveyResponse" r WHERE r."surveyId" = s."id"),
     'completes', (SELECT count(*) FROM "SurveyResponse" r WHERE r."surveyId" = s."id")
   )
 WHERE s."releasedAt" IS NOT NULL;
