/**
 * Ranking ruling RK (lead, 6 Nov 2026, from the brief v4.0 section 6.4). Every number lives in the admin config
 * catalogue under `ranking.*`; these are the defaults. Weights and exponents are whole numbers in hundredths
 * (150 means 1.5) because config values are integers.
 */
export interface RankingConfig {
  intervalMinutes: number;
  windowDays: number;
  fairChanceHours: number;
  ageOffsetHours: number;
  meaningfulReplyChars: number;
  likeWeight: number;
  reactionWeight: number;
  replyWeight: number;
  shareWeight: number;
  rankDecay: number;
  debatePairWeight: number;
  debateReplyWeight: number;
  debateDecay: number;
}

export const RANKING_KEYS: {
  key: string;
  field: keyof RankingConfig;
  value: number;
  description: string;
  max: number;
}[] = [
  {
    key: "ranking.interval_minutes",
    field: "intervalMinutes",
    value: 5,
    description: "How often the ranking job recomputes scores, in minutes",
    max: 1440,
  },
  {
    key: "ranking.window_days",
    field: "windowDays",
    value: 7,
    description:
      "The job scores answers on questions that are open, or closed within this many days",
    max: 365,
  },
  {
    key: "ranking.fair_chance_hours",
    field: "fairChanceHours",
    value: 6,
    description:
      "A new answer is scored at least the median of its question for this many hours, so new voices get seen",
    max: 168,
  },
  {
    key: "ranking.age_offset_hours",
    field: "ageOffsetHours",
    value: 2,
    description: "Hours added to an answer's age before it decays",
    max: 168,
  },
  {
    key: "ranking.meaningful_reply_chars",
    field: "meaningfulReplyChars",
    value: 20,
    description:
      "A text reply counts as meaningful from this many characters (a voice reply always does)",
    max: 500,
  },
  {
    key: "ranking.weight_like_pct",
    field: "likeWeight",
    value: 100,
    description: "Rank weight of each person who liked, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.weight_reaction_pct",
    field: "reactionWeight",
    value: 150,
    description:
      "Rank weight of each person who reacted, any kind, Disagree included, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.weight_reply_pct",
    field: "replyWeight",
    value: 200,
    description:
      "Rank weight of each person with a meaningful reply, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.weight_share_pct",
    field: "shareWeight",
    value: 100,
    description: "Rank weight of each person who shared, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.rank_decay_pct",
    field: "rankDecay",
    value: 150,
    description: "Rank decay exponent on (age + offset) hours, in hundredths",
    max: 1000,
  },
  {
    key: "ranking.debate_pair_weight_pct",
    field: "debatePairWeight",
    value: 200,
    description:
      "Debate weight of each agree and disagree pair of repliers, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.debate_reply_weight_pct",
    field: "debateReplyWeight",
    value: 100,
    description:
      "Debate weight of each person with a meaningful reply, in hundredths",
    max: 100_000,
  },
  {
    key: "ranking.debate_decay_pct",
    field: "debateDecay",
    value: 120,
    description: "Debate decay exponent on (age + offset) hours, in hundredths",
    max: 1000,
  },
];

export const RANKING_DEFAULTS: RankingConfig = Object.fromEntries(
  RANKING_KEYS.map((k) => [k.field, k.value]),
) as unknown as RankingConfig;

/** Reads the ranking keys from ConfigEntry rows. A missing or unusable value falls back to its default. */
export function rankingConfigFrom(
  rows: { key: string; valueJson: unknown }[],
): RankingConfig {
  const stored = new Map(rows.map((r) => [r.key, r.valueJson]));
  const out: RankingConfig = { ...RANKING_DEFAULTS };
  for (const k of RANKING_KEYS) {
    const v = stored.get(k.key);
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= k.max)
      out[k.field] = v;
  }
  return out;
}
