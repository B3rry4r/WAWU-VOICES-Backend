/**
 * What VOICES keeps of a Flutterwave verify response (privacy fix P1). The raw response carries the payer's name,
 * email, IP, device fingerprint, card first 6, expiry and issuer; none of it is stored. Only the fields below are:
 * enough to check a charge and print a receipt. Anything not on this list is dropped before the row is saved.
 */
export interface StoredVerify {
  status?: string;
  amount?: number | string;
  currency?: string;
  tx_ref?: string;
  id?: number | string;
  charged_amount?: number | string;
  created_at?: string;
  card?: { type?: string; last_4digits?: string };
}

const SCALARS = [
  "status",
  "amount",
  "currency",
  "tx_ref",
  "id",
  "charged_amount",
  "created_at",
] as const;

const isScalar = (v: unknown): v is string | number =>
  typeof v === "string" || typeof v === "number";

/** Accepts the whole verify body ({status, message, data}) or just its data object; returns the whitelist only. */
export function whitelistVerify(raw: unknown): StoredVerify {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const src = (
    body.data && typeof body.data === "object" ? body.data : body
  ) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SCALARS) if (isScalar(src[k])) out[k] = src[k];
  const card = src.card;
  if (card && typeof card === "object") {
    const c = card as Record<string, unknown>;
    const kept: Record<string, string> = {};
    if (typeof c.type === "string") kept.type = c.type.trim();
    if (typeof c.last_4digits === "string" && /^\d{4}$/.test(c.last_4digits))
      kept.last_4digits = c.last_4digits;
    if (Object.keys(kept).length) out.card = kept;
  }
  return out;
}
