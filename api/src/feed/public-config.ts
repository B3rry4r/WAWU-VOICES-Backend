import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

/**
 * Prices, costs and allowances come from the ConfigEntry table (the `config` the contract names; the admin
 * console and A5's charging read the same rows). The fallbacks are the seeded defaults in docs/contract/PRICES.md,
 * used only while a key has no row yet, so a fresh database answers like a seeded one. Never type these into a client.
 */
export const CONFIG_DEFAULTS: Record<string, number> = {
  "units.base_rate_kobo": 100,
  "units.min_purchase_kobo": 18300,
  "allowance.free_posts": 5,
  "allowance.free_reactions_per_day": 20,
  "allowance.free_votes_per_day": 3,
  "cost.text_post_milli": 5000,
  "cost.voice_post_milli": 78000,
  "cost.reaction_milli": 100,
  "cost.vote_milli": 200,
  "voice.free_seconds": 60,
  "voice.extra30.price_kobo": 7800,
  "voice.extra30.max_seconds": 30,
  "voice.extra60.price_kobo": 10000,
  "voice.extra60.max_seconds": 60,
  "text.max_chars": 2500,
  "text.price_chars": 150,
  "allowance.free_post_text_chars": 500,
  "allowance.messages_per_day": 20,
  "textfix.cost_milli": 5000,
};
export const PUBLIC_KEYS = Object.keys(CONFIG_DEFAULTS);

@Injectable()
export class PublicConfig {
  constructor(private readonly db: PrismaService) {}

  async many(keys: string[]): Promise<Map<string, number>> {
    const rows = await this.db.configEntry.findMany({
      where: { key: { in: keys } },
    });
    const out = new Map<string, number>();
    for (const k of keys) {
      const v = rows.find((r) => r.key === k)?.valueJson;
      out.set(k, typeof v === "number" ? v : CONFIG_DEFAULTS[k]);
    }
    return out;
  }
}
