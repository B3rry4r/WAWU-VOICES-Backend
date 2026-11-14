-- DOWN for 20261114100000_sponsored_surveys (run only with the API of the previous release; then delete the
-- _prisma_migrations row). Refuses (raises, changes nothing) while any survey, brand, response or survey voice clip
-- exists: the answers people gave and the brand's records cannot be rebuilt. Delete them on purpose first if you mean to.
-- The enum value 'SURVEY_ANSWER' on "VoiceClipPurpose" stays: Postgres cannot drop one value, and nothing reads it.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SponsoredSurvey") THEN
    RAISE EXCEPTION 'rollback refused: SponsoredSurvey has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "Brand") THEN
    RAISE EXCEPTION 'rollback refused: Brand has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "SurveyResponse") THEN
    RAISE EXCEPTION 'rollback refused: SurveyResponse has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "VoiceClip" WHERE "purpose"::text = 'SURVEY_ANSWER') THEN
    RAISE EXCEPTION 'rollback refused: survey voice clips exist';
  END IF;
END $$;
DROP TABLE "SurveyEvent";
DROP TABLE "SurveyAnswer";
DROP TABLE "SurveyResponse";
DROP TABLE "SurveyOption";
DROP TABLE "SurveyQuestion";
DROP TABLE "SponsoredSurvey";
DROP TABLE "Brand";
DROP TYPE "SurveyEventKind";
DROP TYPE "SurveyQuestionKind";
COMMIT;
