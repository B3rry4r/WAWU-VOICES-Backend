import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

/** Defaults are the values in docs/contract/PRICES.md; a ConfigEntry row overrides them (never edited here). */
export const CONFIG_DEFAULTS: Record<string, number> = {
  "text.max_chars": 5000,
  "text.edit_window_seconds": 300,
  "text.price_chars": 150,
  "allowance.free_post_text_chars": 500,
  "allowance.messages_per_day": 20,
  "textfix.cost_milli": 5000,
  "ratelimit.textfix_per_10min": 10,
  "voice.free_seconds": 60,
  "voice.extra30.max_seconds": 30,
  "voice.extra60.max_seconds": 60,
  "voice.extra30.price_kobo": 7800,
  "voice.extra60.price_kobo": 10000,
  "cost.text_post_milli": 5000,
  "cost.voice_post_milli": 78000,
  "cost.reaction_milli": 100,
  "cost.vote_milli": 200,
  "allowance.free_reactions_per_day": 20,
  "allowance.free_votes_per_day": 3,
  "units.base_rate_kobo": 100,
  "units.min_purchase_kobo": 18300,
  "ratelimit.read_per_min": 300,
  "ratelimit.listen_per_min": 120,
  "ratelimit.listen_ip_per_min": 3000,
  "privacy.listen_guest_days": 90,
  "ratelimit.post_per_10min": 20,
  "ratelimit.reaction_per_min": 60,
  "ratelimit.like_per_min": 120,
  "ratelimit.support_per_min": 60,
  "ratelimit.appeal_per_10min": 10,
  "ratelimit.voice_upload_per_10min": 20,
  "ratelimit.events_mode": 0,
  "ratelimit.events_mode_factor": 1,
  "upload.max_bytes": 5_000_000,
};

const TTL_MS = 5000;

/** Reads numeric config keys with a 5 second cache. */
@Injectable()
export class ConfigReader {
  private cache = new Map<string, { at: number; value: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache.clear();
  }

  async num(key: string): Promise<number> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    const raw = row?.valueJson as unknown;
    const n = typeof raw === "number" ? raw : Number(raw);
    const value =
      row && raw !== null && raw !== undefined && Number.isFinite(n)
        ? n
        : CONFIG_DEFAULTS[key];
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
