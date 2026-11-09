-- LCH-12: the paid AI text fix is a charge of its own kind (one value added, nothing else changes).
ALTER TYPE "ChargeAction" ADD VALUE IF NOT EXISTS 'TEXT_FIX';
