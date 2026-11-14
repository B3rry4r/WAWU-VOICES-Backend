-- V-45b: a subscription payment stores the plan's terms as quoted at checkout start, so a plan edited before the payment
-- is confirmed cannot change what the buyer gets. ADDITIVE ONLY: three nullable columns on Payment. A payment made before
-- this has no stored terms and falls back to the plan row, as before.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "planSlug" TEXT,
ADD COLUMN IF NOT EXISTS "planMonths" INTEGER,
ADD COLUMN IF NOT EXISTS "planMonthlyMilli" INTEGER;
