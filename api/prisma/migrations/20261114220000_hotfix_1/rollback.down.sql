-- DOWN for 20261114220000_hotfix_1 (run only with the previous API release; then delete the _prisma_migrations row).
-- Drops the sweeper's start-time row and its two partial indexes. Neither holds anything a person owns: the Charge rows are untouched.
-- Applying the migration again stores a new, later start time, so a charge made while it was rolled back is never swept.
BEGIN;
DROP INDEX IF EXISTS "IdempotencyRecord_unfinished_idx";
DROP INDEX IF EXISTS "Charge_sweep_idx";
DROP TABLE IF EXISTS "ChargeSweeperState";
COMMIT;
