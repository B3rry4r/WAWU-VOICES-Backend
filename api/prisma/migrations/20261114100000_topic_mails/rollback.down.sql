-- Rollback for 20261114100000_topic_mails: drops the C02 switch. Members who turned it off lose that choice; the C01 switch (notifyDailyQuestion) is untouched.
ALTER TABLE "UserSettings" DROP COLUMN "notifyWeeklyTopic";
