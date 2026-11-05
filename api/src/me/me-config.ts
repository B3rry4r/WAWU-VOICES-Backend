import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsConfig } from "../units/units.config";

/**
 * The ConfigEntry keys this module reads. The prices, costs and allowances belong to the units module (one allowance
 * config, SHARED-1a): they are read through UnitsConfig. Only the profile's own keys live here (docs/contract/PRICES.md).
 */
export const UNITS_KEYS = [
  "allowance.free_posts",
  "allowance.free_reactions_per_day",
  "allowance.free_votes_per_day",
  "cost.text_post_milli",
  "cost.voice_post_milli",
  "cost.reaction_milli",
  "cost.vote_milli",
  "units.base_rate_kobo",
  "units.min_purchase_kobo",
  "voice.free_seconds",
  "voice.extra30.price_kobo",
  "voice.extra60.price_kobo",
  "text.max_chars",
] as const;

export const ME_OWN_DEFAULTS = {
  "profile.voice_card_seconds": 10,
} as const;

export type MeConfigKey =
  (typeof UNITS_KEYS)[number] | keyof typeof ME_OWN_DEFAULTS;

@Injectable()
export class MeConfig {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsConfig,
  ) {}

  /** The current value of each key: units keys from UnitsConfig, the profile keys from their ConfigEntry row or default. */
  async numbers(): Promise<Record<MeConfigKey, number>> {
    const ownKeys = Object.keys(
      ME_OWN_DEFAULTS,
    ) as (keyof typeof ME_OWN_DEFAULTS)[];
    const [shared, rows] = await Promise.all([
      this.units.ints([...UNITS_KEYS]),
      this.prisma.configEntry.findMany({ where: { key: { in: ownKeys } } }),
    ]);
    const out = { ...ME_OWN_DEFAULTS, ...shared } as Record<
      MeConfigKey,
      number
    >;
    for (const r of rows) {
      const v = r.valueJson;
      if (typeof v === "number" && Number.isInteger(v) && v >= 0)
        out[r.key as MeConfigKey] = v;
    }
    return out;
  }
}
