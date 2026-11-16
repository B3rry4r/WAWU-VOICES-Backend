-- DOWN for 20261114150000_admin_money (run only with the API of the previous release; then delete the _prisma_migrations row).
-- Indexes only: no row is read or lost, so this never refuses.
BEGIN;
DROP INDEX IF EXISTS "LedgerTransaction_kind_createdAt_idx";
DROP INDEX IF EXISTS "Payment_kind_createdAt_idx";
DROP INDEX IF EXISTS "Payment_status_verifiedAt_idx";
COMMIT;
