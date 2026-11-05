import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { ConfigReader } from "./config-reader";

export type RateBucket =
  "post" | "reaction" | "like" | "voiceUpload" | "read" | "support";

const BUCKETS: Record<RateBucket, { key: string; windowMs: number }> = {
  post: { key: "ratelimit.post_per_10min", windowMs: 600_000 },
  reaction: { key: "ratelimit.reaction_per_min", windowMs: 60_000 },
  like: { key: "ratelimit.like_per_min", windowMs: 60_000 },
  voiceUpload: { key: "ratelimit.voice_upload_per_10min", windowMs: 600_000 },
  support: { key: "ratelimit.support_per_min", windowMs: 60_000 },
  read: { key: "ratelimit.read_per_min", windowMs: 60_000 },
};

export const RATE_BUCKET = "voices:rate-bucket";
/** The contract's per-account (or per-IP-and-guest) limit for a route. Put it after the auth guard. */
export const RateLimit = (bucket: RateBucket) =>
  SetMetadata(RATE_BUCKET, bucket);

/** Sliding window in memory: one API process runs on the droplet. Config keys ratelimit.* set the limits. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigReader,
  ) {}

  reset(): void {
    this.hits.clear();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.get<RateBucket | undefined>(
      RATE_BUCKET,
      ctx.getHandler(),
    );
    if (!bucket) return true;
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { sub?: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const b = BUCKETS[bucket];
    const factor = await this.config.num("ratelimit.events_mode_factor");
    const limit = Math.max(
      1,
      Math.floor((await this.config.num(b.key)) * (factor > 0 ? factor : 1)),
    );
    const guest = String(req.headers["x-guest-id"] ?? "");
    const who = req.user?.sub ? `u:${req.user.sub}` : `ip:${req.ip}|g:${guest}`;
    const id = `${bucket}|${who}`;
    const now = Date.now();
    const list = (this.hits.get(id) ?? []).filter((t) => now - t < b.windowMs);
    const reset = Math.ceil(((list[0] ?? now) + b.windowMs - now) / 1000);
    res.setHeader("RateLimit-Limit", String(limit));
    if (list.length >= limit) {
      res.setHeader("RateLimit-Remaining", "0");
      res.setHeader("RateLimit-Reset", String(reset));
      res.setHeader("Retry-After", String(reset));
      this.hits.set(id, list);
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Too many tries. Wait a moment and try again.",
        },
        429,
      );
    }
    list.push(now);
    this.hits.set(id, list);
    res.setHeader("RateLimit-Remaining", String(limit - list.length));
    res.setHeader("RateLimit-Reset", String(reset));
    return true;
  }
}
