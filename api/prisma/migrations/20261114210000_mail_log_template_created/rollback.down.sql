-- Rollback for 20261114210000_mail_log_template_created: drops the index only. No rows or columns are touched.
DROP INDEX IF EXISTS "MailLog_template_createdAt_idx";
