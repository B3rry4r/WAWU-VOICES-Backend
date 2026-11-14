-- DOWN for 20261114140000_direct_messages (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any direct message exists: a message is a person's words and the tokens they paid
-- for it are in the ledger, so it is not dropped silently. Delete the messages deliberately first if that is what is wanted.
-- The four new enum values (VoiceClipPurpose DM, ReportTargetType DM_MESSAGE, ChargeAction DM_TEXT and DM_VOICE) stay: PostgreSQL cannot drop an enum value, and a
-- value nothing uses is harmless to the previous release. Reports about messages must be removed first (they would name a missing row).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DmMessage") THEN
    RAISE EXCEPTION 'rollback refused: DmMessage has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "Charge" WHERE "action"::text IN ('DM_TEXT','DM_VOICE')) THEN
    RAISE EXCEPTION 'rollback refused: a direct message charge exists (a money record)';
  END IF;
  IF EXISTS (SELECT 1 FROM "Report" WHERE "targetType"::text = 'DM_MESSAGE') THEN
    RAISE EXCEPTION 'rollback refused: a report about a direct message exists';
  END IF;
  IF EXISTS (SELECT 1 FROM "ModerationItem" WHERE "targetType"::text = 'DM_MESSAGE') THEN
    RAISE EXCEPTION 'rollback refused: a moderation item about a direct message exists';
  END IF;
END $$;
DROP TABLE "DmMute";
DROP TABLE "DmMessage";
DROP TABLE "DmConversation";
ALTER TABLE "UserSettings" DROP COLUMN "dmOpen";
COMMIT;
