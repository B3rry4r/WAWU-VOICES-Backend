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
  | "post"
  | "reaction"
  | "like"
  | "voiceUpload"
  | "read"
  | "listen"
  | "support"
  | "appeal";

const BUCKETS: Record<RateBucket, { key: string; windowMs: number }> = {
  post: { key: "ratelimit.post_per_10min", windowMs: 600_000 },
  reaction: { key: "ratelimit.reaction_per_min", windowMs: 60_000 },
  like: { key: "ratelimit.like_per_min", windowMs: 60_000 },
  voiceUpload: { key: "ratelimit.voice_upload_per_10min", windowMs: 600_000 },
  support: { key: "ratelimit.support_per_min", windowMs: 60_000 },
  appeal: { key: "ratelimit.appeal_per_10min", windowMs: 600_000 },
  read: { key: "ratelimit.read_per_min", windowMs: 60_000 },
  listen: { key: "ratelimit.listen_per_min", windowMs: 60_000 },
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

  /** One hit in a sliding window. Expired keys are swept when the map grows large (rotated ids would fill it). */
  private take(id: string, windowMs: number, limit: number) {
    const now = Date.now();
    if (this.hits.size > 50_000)
      for (const [k, v] of this.hits)
        if (!v.length || now - v[v.length - 1] >= 600_000) this.hits.delete(k);
    const list = (this.hits.get(id) ?? []).filter((t) => now - t < windowMs);
    const reset = Math.ceil(((list[0] ?? now) + windowMs - now) / 1000);
    if (list.length >= limit) {
      this.hits.set(id, list);
      return { ok: false, used: list.length, reset };
    }
    list.push(now);
    this.hits.set(id, list);
    return { ok: true, used: list.length, reset };
  }

  private refuse(res: Response, reset: number): never {
    res.setHeader("RateLimit-Remaining", "0");
    res.setHeader("RateLimit-Reset", String(reset));
    res.setHeader("Retry-After", String(reset));
    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message: "Too many tries. Wait a moment and try again.",
      },
      429,
    );
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
    // Lead ruling RT1, 6 Nov: the events factor halves the limits only while events mode is on (default off).
    const events = (await this.config.num("ratelimit.events_mode")) > 0;
    const factor = events
      ? await this.config.num("ratelimit.events_mode_factor")
      : 1;
    const limit = Math.max(
      1,
      Math.floor((await this.config.num(b.key)) * (factor > 0 ? factor : 1)),
    );
    const guest = String(req.headers["x-guest-id"] ?? "");
    // LISTEN-1: a listen report is counted per visitor (the random id the browser keeps), not per address.
    const visitor = String(req.headers["x-visitor-id"] ?? "");
    const who = req.user?.sub
      ? `u:${req.user.sub}`
      : bucket === "listen" && visitor
        ? `v:${visitor}`
        : `ip:${req.ip}|g:${guest}`;
    // LS7: a visitor who is not signed in is also held to one ceiling per network address across every visitor id, so
    // rotating ids does not get past the limit. The address lives only in this memory map: never in a table or a log.
    if (bucket === "listen" && !req.user?.sub) {
      const ipLimit = Math.max(
        1,
        Math.floor(await this.config.num("ratelimit.listen_ip_per_min")),
      );
      const ip = this.take(`listen-ip|${req.ip}`, b.windowMs, ipLimit);
      if (!ip.ok) this.refuse(res, ip.reset);
    }
    const id = `${bucket}|${who}`;
    const got = this.take(id, b.windowMs, limit);
    res.setHeader("RateLimit-Limit", String(limit));
    if (!got.ok) this.refuse(res, got.reset);
    res.setHeader("RateLimit-Remaining", String(limit - got.used));
    res.setHeader("RateLimit-Reset", String(got.reset));
    return true;
  }
}
