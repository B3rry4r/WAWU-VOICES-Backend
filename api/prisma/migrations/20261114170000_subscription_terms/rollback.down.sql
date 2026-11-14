-- DOWN for 20261114170000_subscription_terms (run only with the previous API release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any payment holds stored plan terms: they are the record of what a buyer was quoted.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "planSlug" IS NOT NULL OR "planMonths" IS NOT NULL OR "planMonthlyMilli" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a payment holds stored plan terms';
  END IF;
END $$;
ALTER TABLE "Payment" DROP COLUMN "planSlug", DROP COLUMN "planMonths", DROP COLUMN "planMonthlyMilli";
COMMIT;
