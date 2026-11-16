-- Rollback for 20261114210000_mail_log_template_created: drops the index only. No rows or columns are touched.
DROP INDEX IF EXISTS "MailLog_template_createdAt_idx";
-- So that a later `prisma migrate deploy` builds the index again.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114210000_mail_log_template_created';
