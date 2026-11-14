import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

/** Defaults from docs/contract/PRICES.md; a ConfigEntry row overrides them (never a number typed in a route). */
export const CONFIG_DEFAULTS: Record<string, number | boolean> = {
  "cost.vote_milli": 200,
  "cost.proposal_milli": 0,
  "cost.explain_milli": 0,
  "cost.text_post_milli": 5000,
  "cost.voice_post_milli": 78000,
  "cost.reaction_milli": 100,
  "allowance.free_votes_per_day": 3,
  "allowance.free_reactions_per_day": 20,
  "allowance.free_posts": 5,
  "poll.results_cache_seconds": 3,
  "poll.show_live_results": true,
  "text.max_chars": 5000,
  "proposal.max_chars": 500,
  "text.price_chars": 150,
  "allowance.free_post_text_chars": 500,
  "allowance.messages_per_day": 20,
  "textfix.cost_milli": 5000,
  "voice.extra30.max_seconds": 30,
  "voice.extra60.max_seconds": 60,
  "search.similar_proposals_max": 3,
  "ratelimit.vote_per_min": 30,
  "ratelimit.post_per_10min": 20,
  "voice.free_seconds": 60,
  "units.base_rate_kobo": 100,
  "units.min_purchase_kobo": 18300,
  "voice.extra30.price_kobo": 7800,
  "voice.extra60.price_kobo": 10000,
};

@Injectable()
export class VoteConfig {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(private readonly prisma: PrismaService) {}

  async get<T extends number | boolean>(key: string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 5000) return hit.value as T;
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    let value: unknown = CONFIG_DEFAULTS[key];
    const j = row?.valueJson;
    if (typeof j === "number" || typeof j === "boolean") value = j;
    this.cache.set(key, { at: Date.now(), value });
    return value as T;
  }

  num(key: string): Promise<number> {
    return this.get<number>(key);
  }
}
