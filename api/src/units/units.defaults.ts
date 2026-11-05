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
    value: 1380,
    placeholder: true,
    description: "One unit is worth this many kobo (display only)",
  },
  "units.min_purchase_kobo": {
    value: 13800,
    placeholder: false,
    description: "Smallest purchase in kobo",
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
    value: 500,
    placeholder: true,
    description: "Text answer or reply after the free posts",
  },
  "cost.voice_post_milli": {
    value: 1000,
    placeholder: true,
    description: "Voice post up to 10 s after the free posts",
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
    value: 15000,
    placeholder: false,
    description: "Extra voice token, up to 30 s",
  },
  "voice.extra30.max_seconds": {
    value: 30,
    placeholder: false,
    description: "Seconds the 30 s token allows",
  },
  "voice.extra60.price_kobo": {
    value: 20000,
    placeholder: false,
    description: "Extra voice token, up to 1 min",
  },
  "voice.extra60.max_seconds": {
    value: 60,
    placeholder: false,
    description: "Seconds the 1 min token allows",
  },
  "text.max_chars": {
    value: 500,
    placeholder: false,
    description: "Longest text post",
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
    slug: "spark",
    name: "Spark",
    priceKobo: 13800,
    unitsMilli: 10000,
    bonusMilli: 0,
    sortOrder: 1,
  },
  {
    slug: "chat",
    name: "Chat",
    priceKobo: 34500,
    unitsMilli: 26000,
    bonusMilli: 1000,
    sortOrder: 2,
  },
  {
    slug: "buzz",
    name: "Buzz",
    priceKobo: 69000,
    unitsMilli: 55000,
    bonusMilli: 5000,
    sortOrder: 3,
  },
  {
    slug: "loud",
    name: "Loud",
    priceKobo: 138000,
    unitsMilli: 115000,
    bonusMilli: 15000,
    sortOrder: 4,
  },
  {
    slug: "mega",
    name: "Mega",
    priceKobo: 345000,
    unitsMilli: 310000,
    bonusMilli: 60000,
    sortOrder: 5,
  },
  {
    slug: "boss",
    name: "Boss",
    priceKobo: 690000,
    unitsMilli: 650000,
    bonusMilli: 150000,
    sortOrder: 6,
  },
];
