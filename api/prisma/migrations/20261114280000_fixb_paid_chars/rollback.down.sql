-- DOWN for 20261114280000_fixb_paid_chars (run only with the API of the previous release; then delete the _prisma_migrations row).
-- The column only remembers the longest length of a text that was already paid for. Dropping it loses nothing a person sees, and
-- the previous release prices an edit from the text as it stands (it charges again for a second growth). Nothing is refused.
BEGIN;
ALTER TABLE "Answer" DROP COLUMN "paidChars";
COMMIT;
