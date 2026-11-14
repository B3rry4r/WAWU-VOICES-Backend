/**
 * Every ConfigEntry key from docs/contract/PRICES.md with its default, kind and whether it is "a placeholder" (the brief
 * calls the number a placeholder). The catalogue is what GET /admin/config lists when a row has never been written,
 * and what PUT /admin/config/{key} checks a value against: a key that is not here is 404, a value of the wrong kind
 * is 422. Nothing here is read by other modules; they read the ConfigEntry row (the one config source).
 */
import { RANKING_KEYS } from "../feed/ranking.config";
import { TIER_DEFAULTS } from "../units/units.defaults";

export type ConfigKind =
  | "int" // a whole number from 0 to 2,000,000,000 (money is kobo, units are milli: 32-bit, V-18)
  | "intOrNull"
  | "bool"
  | "text" // a short string
  | "textList"
  | "json";

export interface CatalogueItem {
  key: string;
  value: unknown;
  kind: ConfigKind;
  description: string;
  placeholder?: boolean;
  /** Fixed by a ruling: shown, never editable. */
  fixed?: boolean;
  /** Inclusive upper bound for an int (default 2,000,000,000). */
  max?: number;
  /** Allowed values for a text key. */
  oneOf?: string[];
}

const I = (
  key: string,
  value: number,
  description: string,
  extra: Partial<CatalogueItem> = {},
): CatalogueItem => ({ key, value, kind: "int", description, ...extra });

export const INT_MAX = 2_000_000_000;

export const CONFIG_CATALOGUE: CatalogueItem[] = [
  I(
    "units.base_rate_kobo",
    100,
    "One token is worth this many kobo (display only; 1 token = N1)",
  ),
  I("units.min_purchase_kobo", 18300, "Smallest purchase in kobo"),
  I("units.expiry_months", 0, "0 means tokens do not expire", {
    placeholder: true,
    max: 120,
  }),
  {
    key: "units.cashable",
    value: false,
    kind: "bool",
    description: "Tokens are never cashed out or sent to another person (V-9)",
    fixed: true,
  },
  {
    key: "units.tiers",
    value: TIER_DEFAULTS.map(
      ({ slug, name, priceKobo, unitsMilli, bonusMilli }) => ({
        slug,
        name,
        priceKobo,
        unitsMilli,
        bonusMilli,
      }),
    ),
    kind: "json",
    description: "Token packs: slug, name, priceKobo, unitsMilli, bonusMilli",
  },
  I(
    "allowance.free_posts",
    10,
    "Lifetime free posts per verified phone number",
    { max: 1000 },
  ),
  {
    key: "allowance.daily_free_post_enabled",
    value: false,
    kind: "bool",
    description: "No daily free post after the first 10 (V-8)",
  },
  I(
    "cost.text_post_milli",
    5000,
    "Text answer or reply after the free posts: milli-tokens per text.price_chars characters, in proportion",
  ),
  I("text.price_chars", 150, "Characters one text price covers", { max: 5000 }),
  I(
    "allowance.free_post_text_chars",
    500,
    "Longest text a free post covers; longer text pays in full",
    { max: 5000 },
  ),
  I(
    "cost.voice_post_milli",
    78000,
    "Display copy of the up-to-30-second voice price; the charge reads voice.extra30.price_kobo",
  ),
  I(
    "allowance.messages_per_day",
    20,
    "Outgoing messages (answers and replies) per person per Lagos day",
    { max: 1000 },
  ),
  I(
    "dm.text_price_milli",
    0,
    "Direct message in text: milli-tokens per text.price_chars characters, in proportion (0 = free)",
    { max: 100_000 },
  ),
  I(
    "dm.voice_price_milli",
    0,
    "Direct voice message: milli-tokens whatever its length (0 = free)",
    { max: 1_000_000 },
  ),
  I("dm.voice_max_seconds", 60, "Longest direct voice message, in seconds", {
    max: 60,
  }),
  I(
    "dm.messages_per_day",
    100,
    "Direct messages per person per Lagos day (separate from the 20 posts a day)",
    { max: 10_000 },
  ),
  I(
    "textfix.cost_milli",
    5000,
    "AI text fix, in milli-tokens (5 tokens, V-37)",
    {
      max: 100_000,
    },
  ),
  I(
    "ratelimit.textfix_per_10min",
    10,
    "AI text fixes per person per 10 minutes",
    {
      max: 1000,
    },
  ),
  I("allowance.free_reactions_per_day", 20, "Free reactions per Lagos day", {
    placeholder: true,
    max: 10000,
  }),
  I(
    "cost.reaction_milli",
    100,
    "A reaction after the free ones, in milli-tokens",
    { placeholder: true },
  ),
  I("allowance.free_votes_per_day", 3, "Free votes per Lagos day", {
    placeholder: true,
    max: 10000,
  }),
  I("cost.vote_milli", 200, "A vote after the free ones, in milli-tokens", {
    placeholder: true,
  }),
  I("cost.proposal_milli", 0, "A What Next? proposal (free at launch, V-15)"),
  I("cost.explain_milli", 0, "Explain my vote (free at launch, V-15)"),
  I("cost.reaction_remove_milli", 0, "Removing a reaction is free (V-15)", {
    fixed: true,
  }),
  I("cost.result_post_milli", 0, "Posting result numbers is free (V-8)", {
    fixed: true,
  }),
  I("cost.boost_milli", 5000, "Reserved: no route and no screen at launch"),
  I("cost.like_share_read_listen_milli", 0, "Always free", { fixed: true }),
  I("voice.free_seconds", 10, "Default voice length in seconds", { max: 600 }),
  I(
    "voice.extra30.price_kobo",
    7800,
    "Voice message up to 30 seconds, kobo (78 tokens)",
  ),
  I("voice.extra30.max_seconds", 30, "Seconds an extra30 token allows", {
    max: 600,
  }),
  I(
    "voice.extra60.price_kobo",
    10000,
    "Voice message over 30 and up to 60 seconds, kobo (100 tokens)",
  ),
  I("voice.extra60.max_seconds", 60, "Seconds an extra60 token allows", {
    max: 600,
  }),
  I("voice.token_expiry_days", 0, "0 means an unused token stays available", {
    max: 3650,
  }),
  {
    key: "countries.list",
    value: [
      { code: "NG", name: "Nigeria", status: "live" },
      { code: "GH", name: "Ghana", status: "coming" },
      { code: "KE", name: "Kenya", status: "coming" },
      { code: "ZA", name: "South Africa", status: "coming" },
    ],
    kind: "json",
    description: "Launch country list",
  },
  I(
    "search.similar_proposals_max",
    3,
    "Similar proposals shown before posting",
    { max: 20 },
  ),
  I("text.max_chars", 5000, "Longest text post", { max: 5000 }),
  I(
    "proposal.max_chars",
    500,
    "Longest What Next? proposal or vote explanation (free, so it keeps its own limit)",
    { max: 5000 },
  ),
  I("text.edit_window_seconds", 300, "How long a post can be edited", {
    max: 86_400,
  }),
  I("reply.depth", 1, "Replies are one level deep", { fixed: true, max: 1 }),
  I("profile.voice_card_seconds", 10, "Voice Card length in seconds", {
    max: 600,
  }),
  I("clip.target_bitrate_kbps", 32, "Audio target bitrate", { max: 512 }),
  {
    key: "payment.provider",
    value: "flutterwave",
    kind: "text",
    description: "Payment provider",
    oneOf: ["flutterwave"],
  },
  I(
    "payment.reconcile_window_hours",
    72,
    "Pending payments younger than this are re-verified",
    { max: 720 },
  ),
  I(
    "voice.token_reserve_expiry_minutes",
    60,
    "A reserved extra voice token goes back to available after this long",
    { max: 10_080 },
  ),
  I(
    "payment.expiry_minutes",
    30,
    "An unpaid payment expires after this many minutes",
    { max: 10_080 },
  ),
  I(
    "payment.reconcile_interval_minutes",
    10,
    "Pending payments are re-verified this often",
    { max: 1440 },
  ),
  {
    key: "payment.currency",
    value: "NGN",
    kind: "text",
    description: "Payment currency",
    oneOf: ["NGN"],
  },
  I(
    "charges.vat_rate_bps",
    750,
    "VAT the customer pays on top of the price, in basis points (750 is 7.5%). Owner to confirm against the Flutterwave dashboard",
    { placeholder: true, max: 2500 },
  ),
  I(
    "charges.fee_rate_bps",
    140,
    "Flutterwave fee rate the customer pays on top, in basis points (140 is 1.4%). Owner to confirm against the Flutterwave dashboard",
    { placeholder: true, max: 1000 },
  ),
  I(
    "charges.fee_flat_kobo",
    0,
    "Flutterwave flat fee per payment in kobo. Owner to confirm against the Flutterwave dashboard",
    { placeholder: true },
  ),
  I(
    "charges.fee_cap_kobo",
    200000,
    "Flutterwave fee cap per payment in kobo (200000 is 2,000 naira). Owner to confirm against the Flutterwave dashboard",
    { placeholder: true },
  ),
  I("tax.vat_percent_x100", 750, "VAT percent times 100 (finance only)", {
    max: 10_000,
  }),
  I(
    "tax.payment_fee_percent_x100",
    150,
    "Payment fee percent times 100 (finance only)",
    { max: 10_000 },
  ),
  I("poll.results_cache_seconds", 3, "Live results cache", { max: 60 }),
  {
    key: "poll.show_live_results",
    value: true,
    kind: "bool",
    description: "Show live poll results",
  },
  I("override.duration_hours", 24, "How long an override runs by default", {
    max: 168,
  }),
  I("ads.native_every_min", 8, "Fewest posts between adverts", { max: 100 }),
  I("ads.native_every_max", 10, "Most posts between adverts", { max: 100 }),
  I("ads.never_in_first", 3, "No advert among the first posts", { max: 100 }),
  I("ads.frequency_cap_per_day", 3, "Adverts per person per day", { max: 100 }),
  {
    key: "ads.price.flat_per_day_kobo",
    value: null,
    kind: "intOrNull",
    description: "Flat advert fee per day, kobo (the admin sets it)",
    placeholder: true,
  },
  {
    key: "ads.price.flat_per_week_kobo",
    value: null,
    kind: "intOrNull",
    description: "Flat advert fee per week, kobo (the admin sets it)",
    placeholder: true,
  },
  {
    key: "ads.blocked_categories",
    value: ["betting", "tobacco", "health claims", "political"],
    kind: "textList",
    description: "Advert categories never accepted",
  },
  {
    key: "ads.never_beside",
    value: ["politics", "religion", "health", "sexual life"],
    kind: "textList",
    description: "Topics adverts never sit beside",
  },
  I("news.flag_threshold", 4, "Flags that send a news post to review", {
    max: 1000,
  }),
  {
    key: "news.verified_needs_second_approver",
    value: false,
    kind: "bool",
    description: "Verified News needs a second approver",
  },
  {
    key: "moderation.sensitive_topics",
    value: ["politics", "religion", "sex", "tribe"],
    kind: "textList",
    description: "Topics that go to extra review",
  },
  I("moderation.takedown_target_hours", 24, "Target time to act on a report", {
    max: 720,
  }),
  I(
    "weekly.draft_after_poll_close_minutes",
    10,
    "Minutes after the poll closes that the report drafts",
    { max: 1440 },
  ),
  I(
    "weekly.default_publish_weekday",
    1,
    "Default publish weekday (0 Sunday to 6 Saturday)",
    { max: 6 },
  ),
  I("weekly.default_publish_hour", 18, "Default publish hour, Lagos time", {
    max: 23,
  }),
  I(
    "weekly.min_group_size",
    20,
    "Groups smaller than this are left out of the report",
    { max: 100_000 },
  ),
  ...RANKING_KEYS.map((k) => I(k.key, k.value, k.description, { max: k.max })),
  I("ratelimit.read_per_min", 300, "Reads per minute", { max: 100_000 }),
  I("ratelimit.listen_per_min", 120, "Listen reports per minute per visitor", {
    max: 100_000,
  }),
  I(
    "ratelimit.listen_ip_per_min",
    3000,
    "Listen reports per minute per network address, across all visitor ids",
    { max: 100_000 },
  ),
  I(
    "privacy.listen_guest_days",
    90,
    "Days a visitor's listen records are kept before they are deleted",
    { max: 3650 },
  ),
  I("ratelimit.post_per_10min", 20, "Posts per 10 minutes", { max: 100_000 }),
  I("ratelimit.reaction_per_min", 60, "Reactions per minute", { max: 100_000 }),
  I("ratelimit.like_per_min", 120, "Likes per minute", { max: 100_000 }),
  I("ratelimit.vote_per_min", 30, "Votes per minute", { max: 100_000 }),
  I("ratelimit.payment_per_10min", 10, "Payments per 10 minutes", {
    max: 100_000,
  }),
  I("ratelimit.voice_upload_per_10min", 20, "Voice uploads per 10 minutes", {
    max: 100_000,
  }),
  I("ratelimit.result_post_per_10min", 30, "Result posts per 10 minutes", {
    max: 100_000,
  }),
  I("ratelimit.search_per_min", 60, "Searches per minute", { max: 100_000 }),
  I("ratelimit.share_per_min", 60, "Shares per minute", { max: 100_000 }),
  I(
    "ratelimit.admin_write_per_min",
    120,
    "Admin writes per minute per account",
    { max: 100_000 },
  ),
  {
    key: "ratelimit.events_mode",
    value: false,
    kind: "bool",
    description:
      "Events or election mode: while on, the rate limits are multiplied by the events factor",
  },
  {
    key: "ratelimit.events_mode_factor",
    value: 0.5,
    kind: "json",
    description: "Events mode multiplies the limits by this (0 to 1)",
  },
];

export const CATALOGUE_BY_KEY = new Map(
  CONFIG_CATALOGUE.map((c) => [c.key, c]),
);

/** Returns a message when the value does not fit the key, else null. */
export function checkConfigValue(
  item: CatalogueItem,
  v: unknown,
): string | null {
  const isInt = (x: unknown): x is number =>
    typeof x === "number" && Number.isInteger(x);
  const max = item.max ?? INT_MAX;
  switch (item.kind) {
    case "int":
      if (!isInt(v) || v < 0 || v > max)
        return `Use a whole number from 0 to ${max}.`;
      return null;
    case "intOrNull":
      if (v === null) return null;
      if (!isInt(v) || v < 0 || v > INT_MAX)
        return `Use a whole number from 0 to ${INT_MAX}, or leave it empty.`;
      return null;
    case "bool":
      return typeof v === "boolean" ? null : "Use true or false.";
    case "text":
      if (typeof v !== "string" || v.length === 0 || v.length > 100)
        return "Use a short word or phrase.";
      if (item.oneOf && !item.oneOf.includes(v))
        return `Use one of: ${item.oneOf.join(", ")}.`;
      return null;
    case "textList":
      if (
        !Array.isArray(v) ||
        v.length > 50 ||
        v.some(
          (x) =>
            typeof x !== "string" || x.trim().length === 0 || x.length > 60,
        )
      )
        return "Use a list of short words.";
      return null;
    case "json":
      return checkJsonKey(item.key, v);
  }
}

function checkJsonKey(key: string, v: unknown): string | null {
  if (key === "ratelimit.events_mode_factor")
    return typeof v === "number" && v >= 0 && v <= 1
      ? null
      : "Use a number from 0 to 1.";
  if (key === "units.tiers") {
    if (!Array.isArray(v) || v.length === 0 || v.length > 12)
      return "Use a list of 1 to 12 packs.";
    const slugs = new Set<string>();
    for (const t of v as Record<string, unknown>[]) {
      if (!t || typeof t !== "object")
        return "Each pack needs a slug, name and amounts.";
      if (
        Object.keys(t).some(
          (k) =>
            !["slug", "name", "priceKobo", "unitsMilli", "bonusMilli"].includes(
              k,
            ),
        )
      )
        return "A pack has only a slug, name, price, tokens and bonus.";
      const { slug, name, priceKobo, unitsMilli, bonusMilli } = t;
      if (
        typeof slug !== "string" ||
        !/^[a-z0-9-]{2,20}$/.test(slug) ||
        slugs.has(slug)
      )
        return "Each pack needs its own short slug.";
      slugs.add(slug);
      if (typeof name !== "string" || name.length === 0 || name.length > 40)
        return "Each pack needs a name.";
      for (const n of [priceKobo, unitsMilli, bonusMilli])
        if (
          typeof n !== "number" ||
          !Number.isInteger(n) ||
          n < 0 ||
          n > INT_MAX
        )
          return "Pack amounts are whole numbers in kobo and milli-tokens.";
      if ((priceKobo as number) < 1) return "A pack needs a price.";
      if ((priceKobo as number) % 100 !== 0)
        return "A pack price is in whole naira (a multiple of 100 kobo).";
      if ((unitsMilli as number) < 1) return "A pack needs some units.";
      if ((bonusMilli as number) > (unitsMilli as number))
        return "The bonus cannot be more than the tokens in the pack.";
    }
    return null;
  }
  if (key === "countries.list") {
    if (!Array.isArray(v) || v.length === 0 || v.length > 60)
      return "Use a list of countries.";
    for (const c of v as Record<string, unknown>[]) {
      if (
        !c ||
        typeof c.code !== "string" ||
        !/^[A-Z]{2}$/.test(c.code) ||
        typeof c.name !== "string" ||
        (c.status !== "live" && c.status !== "coming")
      )
        return "Each country needs a code, a name and a status of live or coming.";
    }
    return null;
  }
  return null;
}
