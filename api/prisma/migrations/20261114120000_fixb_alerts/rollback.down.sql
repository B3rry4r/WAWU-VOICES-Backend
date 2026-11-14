-- DOWN for 20261114120000_fixb_alerts (run only with the API of the previous release; then delete the _prisma_migrations row).
-- The two columns only say "the notices for this row were written". Dropping them loses nothing a person sees; the
-- notices themselves stay, and Notification.groupKey (poll-closed:<id>, category:<id>) stops a second run from writing
-- them again if the columns are added back.
BEGIN;
ALTER TABLE "Question" DROP COLUMN "categoryAlertedAt";
ALTER TABLE "Poll" DROP COLUMN "closeAlertedAt";
COMMIT;
