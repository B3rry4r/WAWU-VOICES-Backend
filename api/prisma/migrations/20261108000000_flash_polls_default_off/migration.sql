-- Flash polls default off for new accounts (the Settings board draws the switch off). Only the column default changes: no row is updated.
ALTER TABLE "UserSettings" ALTER COLUMN "notifyFlashPolls" SET DEFAULT false;
