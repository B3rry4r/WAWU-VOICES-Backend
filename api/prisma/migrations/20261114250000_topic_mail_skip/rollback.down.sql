-- Rollback for 20261114250000_topic_mail_skip: drops the new table only (it holds nothing but skip times, which are
-- rebuilt by the next refusals). No other table is touched.
DROP TABLE IF EXISTS "TopicMailSkip";
-- So that a later `prisma migrate deploy` builds the table again.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114250000_topic_mail_skip';
