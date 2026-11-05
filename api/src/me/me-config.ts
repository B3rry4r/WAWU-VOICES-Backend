import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

/** The ConfigEntry keys this module reads (docs/contract/PRICES.md) with the contract defaults used when no row exists. */
export const ME_CONFIG_DEFAULTS = {
  "allowance.free_posts": 10,
  "allowance.free_reactions_per_day": 20,
  "allowance.free_votes_per_day": 3,
  "cost.text_post_milli": 500,
  "cost.voice_post_milli": 1000,
  "cost.reaction_milli": 100,
  "cost.vote_milli": 200,
  "units.base_rate_kobo": 1380,
  "units.min_purchase_kobo": 13800,
  "voice.free_seconds": 10,
  "voice.extra30.price_kobo": 15000,
  "voice.extra60.price_kobo": 20000,
  "text.max_chars": 500,
  "profile.voice_card_seconds": 10,
} as const;

export type MeConfigKey = keyof typeof ME_CONFIG_DEFAULTS;

@Injectable()
export class MeConfig {
  constructor(private readonly prisma: PrismaService) {}

  /** The current value of each key: the ConfigEntry row when it holds a whole number, else the contract default. */
  async numbers(): Promise<Record<MeConfigKey, number>> {
    const keys = Object.keys(ME_CONFIG_DEFAULTS) as MeConfigKey[];
    const rows = await this.prisma.configEntry.findMany({
      where: { key: { in: keys } },
    });
    const out = { ...ME_CONFIG_DEFAULTS } as Record<MeConfigKey, number>;
    for (const r of rows) {
      const v = r.valueJson;
      if (typeof v === "number" && Number.isInteger(v) && v >= 0)
        out[r.key as MeConfigKey] = v;
    }
    return out;
  }
}
