-- V-SURVEYS: sponsored surveys, brands and survey answers. Additive: one new value on VoiceClipPurpose, two new enums,
-- seven new tables. Nothing existing is renamed, retyped or removed.
ALTER TYPE "VoiceClipPurpose" ADD VALUE IF NOT EXISTS 'SURVEY_ANSWER';

CREATE TYPE "SurveyQuestionKind" AS ENUM ('SINGLE_CHOICE', 'TEXT', 'VOICE');
CREATE TYPE "SurveyEventKind" AS ENUM ('VIEW', 'START', 'COMPLETE', 'SKIP');

CREATE TABLE "Brand" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "tagline" TEXT,
  "logoFileId" TEXT,
  "website" TEXT,
  "contactEmail" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

CREATE TABLE "SponsoredSurvey" (
  "id" TEXT NOT NULL,
  "brandId" TEXT,
  "brandName" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
  "categoryIds" TEXT[],
  "states" TEXT[],
  "startsOn" DATE,
  "endsOn" DATE,
  "frequencyCapPerDay" INTEGER NOT NULL DEFAULT 1,
  "priceKobo" INTEGER,
  "responseTarget" INTEGER,
  "rejectReason" TEXT,
  "changeRequest" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "resultsMailedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SponsoredSurvey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SponsoredSurvey_status_startsOn_endsOn_idx" ON "SponsoredSurvey"("status", "startsOn", "endsOn");
CREATE INDEX "SponsoredSurvey_brandId_status_idx" ON "SponsoredSurvey"("brandId", "status");
ALTER TABLE "SponsoredSurvey" ADD CONSTRAINT "SponsoredSurvey_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SurveyQuestion" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" "SurveyQuestionKind" NOT NULL,
  "prompt" TEXT NOT NULL,
  CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyQuestion_surveyId_position_key" ON "SurveyQuestion"("surveyId", "position");
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "SponsoredSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SurveyOption" (
  "id" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  CONSTRAINT "SurveyOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyOption_questionId_position_key" ON "SurveyOption"("questionId", "position");
ALTER TABLE "SurveyOption" ADD CONSTRAINT "SurveyOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SurveyResponse" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "respondentKey" TEXT NOT NULL,
  "anonymous" BOOLEAN NOT NULL DEFAULT false,
  "shareDemo" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT,
  "ageBand" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyResponse_surveyId_respondentKey_key" ON "SurveyResponse"("surveyId", "respondentKey");
CREATE INDEX "SurveyResponse_surveyId_createdAt_idx" ON "SurveyResponse"("surveyId", "createdAt");
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "SponsoredSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SurveyAnswer" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "optionId" TEXT,
  "text" TEXT,
  "clipId" TEXT,
  "skipped" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyAnswer_responseId_questionId_key" ON "SurveyAnswer"("responseId", "questionId");
CREATE INDEX "SurveyAnswer_questionId_idx" ON "SurveyAnswer"("questionId");
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "SurveyOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SurveyEvent" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "kind" "SurveyEventKind" NOT NULL,
  "userId" TEXT,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SurveyEvent_surveyId_kind_day_idx" ON "SurveyEvent"("surveyId", "kind", "day");
CREATE INDEX "SurveyEvent_surveyId_userId_kind_idx" ON "SurveyEvent"("surveyId", "userId", "kind");
ALTER TABLE "SurveyEvent" ADD CONSTRAINT "SurveyEvent_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "SponsoredSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
