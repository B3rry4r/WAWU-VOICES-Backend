-- V-TOPIC-MAILS: one switch for the "Topic of the week starts" email. Additive, default on. Rollback: drop the column.
ALTER TABLE "UserSettings" ADD COLUMN "notifyWeeklyTopic" BOOLEAN NOT NULL DEFAULT true;
