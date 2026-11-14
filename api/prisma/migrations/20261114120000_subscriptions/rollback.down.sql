-- DOWN for 20261114120000_subscriptions (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Refuses (raises, changes nothing) while any subscription, monthly credit or subscription payment exists: they are money
-- records (a person paid, tokens were credited) and cannot be rebuilt. Plans seeded by the migration and never used are dropped.
-- The three new enum values (PaymentKind SUBSCRIPTION, LedgerTxnKind SUBSCRIPTION_CREDIT, LedgerAccount SUBSCRIPTIONS) stay:
-- PostgreSQL cannot drop an enum value, and a value nothing uses is harmless to the previous release.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription") THEN
    RAISE EXCEPTION 'rollback refused: Subscription has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "SubscriptionCredit") THEN
    RAISE EXCEPTION 'rollback refused: SubscriptionCredit has rows';
  END IF;
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "kind"::text = 'SUBSCRIPTION' OR "planId" IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: a subscription payment exists';
  END IF;
  IF EXISTS (SELECT 1 FROM "LedgerTransaction" WHERE "kind"::text = 'SUBSCRIPTION_CREDIT') THEN
    RAISE EXCEPTION 'rollback refused: a subscription credit is in the ledger';
  END IF;
END $$;
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_planId_fkey";
ALTER TABLE "Payment" DROP COLUMN "planId";
DROP TABLE "SubscriptionCredit";
DROP TABLE "Subscription";
DROP TABLE "SubscriptionPlan";
DROP TYPE "SubscriptionStatus";
COMMIT;
