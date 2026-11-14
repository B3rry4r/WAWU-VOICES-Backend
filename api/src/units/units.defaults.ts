/**
 * Defaults of every units key, copied from docs/contract/PRICES.md. The database wins: a ConfigEntry row (edited by the
 * admin) overrides the value here, and `seedUnitsDefaults` only inserts rows that are missing, never overwrites one.
 * "placeholder" marks a number the brief calls a placeholder (the owner confirms it before launch).
 */
export interface DefaultEntry {
  value: number | boolean;
  placeholder: boolean;
  description: string;
}

export const UNIT_DEFAULTS: Record<string, DefaultEntry> = {
  "units.base_rate_kobo": {
    value: 100,
    placeholder: false,
    description:
      "One token is worth this many kobo (display only; 1 token = N1, V-36)",
  },
  "units.min_purchase_kobo": {
    value: 18300,
    placeholder: false,
    description: "Smallest purchase in kobo (N183, PRICING.md)",
  },
  "allowance.free_posts": {
    value: 10,
    placeholder: false,
    description: "Lifetime free posts per person",
  },
  "allowance.free_reactions_per_day": {
    value: 20,
    placeholder: true,
    description: "Free reactions per Lagos day",
  },
  "allowance.free_votes_per_day": {
    value: 3,
    placeholder: true,
    description: "Free votes per Lagos day",
  },
  "cost.text_post_milli": {
    value: 5000,
    placeholder: false,
    description:
      "Text answer or reply after the free posts: milli-tokens per text.price_chars characters, in proportion (5 tokens per 150)",
  },
  "text.price_chars": {
    value: 150,
    placeholder: false,
    description: "Characters one text price covers (cost.text_post_milli)",
  },
  "allowance.free_post_text_chars": {
    value: 500,
    placeholder: false,
    description: "Longest text a free post covers; longer text pays in full",
  },
  "cost.voice_post_milli": {
    value: 78000,
    placeholder: false,
    description:
      "Display copy of the up-to-30-second voice price in milli-tokens; the charge reads voice.extra30.price_kobo",
  },
  "allowance.messages_per_day": {
    value: 20,
    placeholder: false,
    description:
      "Outgoing messages (answers and replies) per person per Lagos day",
  },
  "dm.text_price_milli": {
    value: 0,
    placeholder: false,
    description:
      "Direct message in text: milli-tokens per text.price_chars characters, in proportion. 0 = free (the design says messages are free)",
  },
  "dm.voice_price_milli": {
    value: 0,
    placeholder: false,
    description:
      "Direct voice message, whatever its length: milli-tokens. 0 = free",
  },
  "dm.voice_max_seconds": {
    value: 60,
    placeholder: false,
    description:
      "Longest direct voice message in seconds (the owner's sheet caps voice at 60)",
  },
  "dm.messages_per_day": {
    value: 100,
    placeholder: false,
    description:
      "Direct messages per person per Lagos day. Their own cap: they do not count toward allowance.messages_per_day",
  },
  "textfix.cost_milli": {
    value: 5000,
    placeholder: false,
    description: "AI text fix, in milli-tokens (5 tokens, V-37)",
  },
  "ratelimit.textfix_per_10min": {
    value: 10,
    placeholder: false,
    description: "AI text fixes asked for per person per 10 minutes",
  },
  "cost.reaction_milli": {
    value: 100,
    placeholder: true,
    description: "A reaction after the free daily ones",
  },
  "cost.vote_milli": {
    value: 200,
    placeholder: true,
    description: "A vote after the free daily ones",
  },
  "voice.free_seconds": {
    value: 10,
    placeholder: false,
    description: "Default voice length in seconds",
  },
  "voice.extra30.price_kobo": {
    value: 7800,
    placeholder: false,
    description: "Voice message up to 30 s, in kobo (78 tokens, PRICING.md)",
  },
  "voice.extra30.max_seconds": {
    value: 30,
    placeholder: false,
    description: "Seconds the 30 s token allows",
  },
  "voice.extra60.price_kobo": {
    value: 10000,
    placeholder: false,
    description: "Voice message over 30 s and up to 60 s, in kobo (100 tokens)",
  },
  "voice.extra60.max_seconds": {
    value: 60,
    placeholder: false,
    description: "Seconds the 1 min token allows",
  },
  "text.max_chars": {
    value: 5000,
    placeholder: false,
    description: "Longest text post",
  },
  "proposal.max_chars": {
    value: 500,
    placeholder: false,
    description:
      "Longest What Next? proposal or vote explanation (free, so it keeps its own limit)",
  },
  "payment.expiry_minutes": {
    value: 30,
    placeholder: false,
    description: "An unpaid payment expires after this long",
  },
  "payment.reconcile_interval_minutes": {
    value: 10,
    placeholder: false,
    description: "How often pending payments are re-verified",
  },
  "payment.reconcile_window_hours": {
    value: 72,
    placeholder: false,
    description: "Pending payments younger than this are re-verified",
  },
  "voice.token_reserve_expiry_minutes": {
    value: 60,
    placeholder: false,
    description:
      "A reserved extra voice token goes back to available after this long",
  },
  "charges.vat_rate_bps": {
    value: 750,
    placeholder: true,
    description:
      "VAT the customer pays on top of the price, in basis points (750 = 7.5%). Owner to confirm",
  },
  "charges.fee_rate_bps": {
    value: 140,
    placeholder: true,
    description:
      "Flutterwave's fee rate in basis points (140 = 1.4%), charged to the customer on top. Owner to confirm against the Flutterwave dashboard",
  },
  "charges.fee_flat_kobo": {
    value: 0,
    placeholder: true,
    description:
      "Flutterwave's flat fee per payment, in kobo. Owner to confirm against the Flutterwave dashboard",
  },
  "charges.fee_cap_kobo": {
    value: 200000,
    placeholder: true,
    description:
      "Flutterwave's fee cap per payment, in kobo (200000 = 2,000 naira). Owner to confirm against the Flutterwave dashboard",
  },
  "ratelimit.payment_per_10min": {
    value: 10,
    placeholder: false,
    description: "Payment starts and verifies per account per 10 minutes",
  },
};

export interface DefaultTier {
  slug: string;
  name: string;
  priceKobo: number;
  unitsMilli: number;
  bonusMilli: number;
  sortOrder: number;
}

export const TIER_DEFAULTS: DefaultTier[] = [
  {
    slug: "entry",
    name: "Entry",
    priceKobo: 18300,
    unitsMilli: 183000,
    bonusMilli: 0,
    sortOrder: 1,
  },
  {
    slug: "starter",
    name: "Starter",
    priceKobo: 36600,
    unitsMilli: 366000,
    bonusMilli: 0,
    sortOrder: 2,
  },
  {
    slug: "standard",
    name: "Standard",
    priceKobo: 73200,
    unitsMilli: 732000,
    bonusMilli: 0,
    sortOrder: 3,
  },
  {
    slug: "plus",
    name: "Plus",
    priceKobo: 146400,
    unitsMilli: 1464000,
    bonusMilli: 0,
    sortOrder: 4,
  },
  {
    slug: "pro",
    name: "Pro",
    priceKobo: 366000,
    unitsMilli: 3660000,
    bonusMilli: 0,
    sortOrder: 5,
  },
  {
    slug: "premium",
    name: "Premium",
    priceKobo: 732000,
    unitsMilli: 7320000,
    bonusMilli: 0,
    sortOrder: 6,
  },
  {
    slug: "ultimate",
    name: "Ultimate",
    priceKobo: 1464000,
    unitsMilli: 14640000,
    bonusMilli: 0,
    sortOrder: 7,
  },
];

export interface DefaultPlan {
  slug: string;
  name: string;
  months: number;
  priceKobo: number;
  monthlyMilli: number;
  sortOrder: number;
}

/** docs/launch/PRICING.md, "Subscriptions" (V-45): paid once up front, tokens credited monthly, unused tokens carry over. */
export const PLAN_DEFAULTS: DefaultPlan[] = [
  {
    slug: "connect",
    name: "VOICES CONNECT",
    months: 3,
    priceKobo: 299900,
    monthlyMilli: 500000,
    sortOrder: 1,
  },
  {
    slug: "plus",
    name: "VOICES PLUS",
    months: 6,
    priceKobo: 539900,
    monthlyMilli: 600000,
    sortOrder: 2,
  },
  {
    slug: "infinity",
    name: "VOICES INFINITY",
    months: 12,
    priceKobo: 959900,
    monthlyMilli: 750000,
    sortOrder: 3,
  },
];
