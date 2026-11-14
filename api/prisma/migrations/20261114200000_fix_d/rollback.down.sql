-- DOWN for 20261114200000_fix_d (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any reply was posted without a name: the previous release does not know the column,
-- so dropping it would show those people's names on replies they chose to keep unnamed. Clear that on purpose first (for
-- example by removing those replies) if you mean to go back.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Reply" WHERE "anonymous" = true) THEN
    RAISE EXCEPTION 'rollback refused: replies were posted without a name';
  END IF;
END $$;
ALTER TABLE "Reply" DROP COLUMN "anonymous";
COMMIT;
