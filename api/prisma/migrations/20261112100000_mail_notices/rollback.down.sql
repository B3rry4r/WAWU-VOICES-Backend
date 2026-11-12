-- DOWN for 20261112100000_mail_notices (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any person holds a mail address (User.mailTo) or any MailLog row exists:
-- the address is where their notification mail goes and the log is what stops a mail being sent twice. Neither can be
-- rebuilt, so clear them on purpose first (UPDATE "User" SET "mailTo" = NULL; DELETE FROM "MailLog";) if you mean to lose them.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "mailTo" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: User.mailTo holds addresses';
  END IF;
  IF EXISTS (SELECT 1 FROM "MailLog") THEN
    RAISE EXCEPTION 'rollback refused: MailLog has rows';
  END IF;
END $$;
DROP TABLE "MailLog";
ALTER TABLE "User" DROP COLUMN "mailTo";
COMMIT;
