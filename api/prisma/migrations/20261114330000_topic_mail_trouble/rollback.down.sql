-- Rollback for 20261114330000_topic_mail_trouble. Nothing a person owns is lost: both hold only mail timing.
DROP TABLE IF EXISTS "TopicMailTrouble";
ALTER TABLE "TopicMailSkip" DROP COLUMN IF EXISTS "strikes";
-- So that a later `prisma migrate deploy` applies it again.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114330000_topic_mail_trouble';
