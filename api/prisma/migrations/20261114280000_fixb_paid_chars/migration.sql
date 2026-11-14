-- V-FIX-B round 6. Additive: one nullable column, no backfill. A post made before this code has null; its first edit takes the
-- length of the text at that moment as already paid.
ALTER TABLE "Answer" ADD COLUMN "paidChars" INTEGER;
