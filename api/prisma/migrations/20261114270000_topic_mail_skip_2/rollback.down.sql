-- Rollback for 20261114270000_topic_mail_skip_2: back to the shape of 20261114250000 (the table stays).
-- The rows are removed (they hold only skip times and a hash; the old shape needs an address, which is not kept).
DELETE FROM "TopicMailSkip";
ALTER TABLE "TopicMailSkip" DROP COLUMN "refusedAt";
ALTER TABLE "TopicMailSkip" DROP COLUMN "addressHash";
ALTER TABLE "TopicMailSkip" ADD COLUMN "address" TEXT NOT NULL;
-- So that a later `prisma migrate deploy` applies it again.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114270000_topic_mail_skip_2';
