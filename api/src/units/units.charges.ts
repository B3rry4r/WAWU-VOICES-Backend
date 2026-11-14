import { UnitsConfig } from "./units.config";

/** One quote shape for every checkout (tokens and plans). All amounts are whole kobo. */
export interface Quote {
  priceKobo: number;
  vatKobo: number;
  chargeKobo: number;
  totalKobo: number;
}

export interface ChargeRates {
  vatRateBps: number;
  feeRateBps: number;
  feeFlatKobo: number;
  feeCapKobo: number;
}

/** Flutterwave's fee on a total, rounded up to the kobo, never more than the cap. */
export function providerFee(totalKobo: number, r: ChargeRates): number {
  return Math.min(
    Math.ceil((totalKobo * r.feeRateBps) / 10000) + r.feeFlatKobo,
    r.feeCapKobo,
  );
}

/**
 * The customer pays the price, VAT on it, and the payment charge (owner, 14 Nov 2026). VAT is the price times the rate,
 * rounded up. The charge is grossed up so that after Flutterwave takes its fee on the TOTAL, WAWU is left with
 * price + VAT: the smallest total whose net of the fee is at least that. Tokens and plan value never change.
 */
export function computeQuote(priceKobo: number, r: ChargeRates): Quote {
  const vatKobo = Math.ceil((priceKobo * r.vatRateBps) / 10000);
  const base = priceKobo + vatKobo;
  const uncapped = Math.ceil(
    ((base + r.feeFlatKobo) * 10000) / (10000 - r.feeRateBps),
  );
  let total = Math.min(uncapped, base + r.feeCapKobo);
  while (total - providerFee(total, r) < base) total++; // rounding of the fee itself
  return {
    priceKobo,
    vatKobo,
    chargeKobo: total - base,
    totalKobo: total,
  };
}

/** What Flutterwave must be paid for an old payment row that has no total: its price (the rule before this change). */
export const expectedKobo = (p: {
  amountKobo: number;
  totalKobo: number | null;
}): number => p.totalKobo ?? p.amountKobo;

/** The rates are read at request time, never cached, never in a screen. */
export async function readRates(cfg: UnitsConfig): Promise<ChargeRates> {
  const c = await cfg.ints([
    "charges.vat_rate_bps",
    "charges.fee_rate_bps",
    "charges.fee_flat_kobo",
    "charges.fee_cap_kobo",
  ]);
  if (c["charges.fee_rate_bps"] >= 10000)
    throw new Error("charges.fee_rate_bps must be under 10000");
  return {
    vatRateBps: c["charges.vat_rate_bps"],
    feeRateBps: c["charges.fee_rate_bps"],
    feeFlatKobo: c["charges.fee_flat_kobo"],
    feeCapKobo: c["charges.fee_cap_kobo"],
  };
}

export async function quoteFor(
  cfg: UnitsConfig,
  priceKobo: number,
): Promise<Quote> {
  return computeQuote(priceKobo, await readRates(cfg));
}
