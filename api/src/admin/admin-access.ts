import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { VoicesRole } from "../generated/prisma/enums";
import { CurrentMe, Roles } from "../me";
import type { CurrentMeInfo } from "../me";
import { PrismaService } from "../common/prisma/prisma.service";

export { CurrentMe };
export type { CurrentMeInfo };

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

/**
 * Admin writes are limited per account (CONVENTIONS.md: admin writes 120 per minute, config key
 * ratelimit.admin_write_per_min). Runs after the role guard, so the person is known. One API process at launch (V-23),
 * so the window lives in memory.
 */
@Injectable()
export class AdminWriteLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();
  private cached: { at: number; value: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Forget every counter (tests). */
  resetWindows(): void {
    this.hits.clear();
  }

  /** Forget the cached limit (tests and the config service call this after a change). */
  resetCache(): void {
    this.cached = null;
  }

  private async limit(): Promise<number> {
    if (this.cached && Date.now() - this.cached.at < 5000)
      return this.cached.value;
    const row = await this.prisma.configEntry.findUnique({
      where: { key: "ratelimit.admin_write_per_min" },
    });
    const v = row?.valueJson;
    const value =
      typeof v === "number" && Number.isInteger(v) && v > 0 ? v : DEFAULT_LIMIT;
    this.cached = { at: Date.now(), value };
    return value;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { me?: CurrentMeInfo }>();
    const res = http.getResponse<Response>();
    const who = req.me?.id ?? req.ip ?? "anon";
    const limit = await this.limit();
    const now = Date.now();
    let w = this.hits.get(who);
    if (!w || w.resetAt <= now) {
      w = { n: 0, resetAt: now + WINDOW_MS };
      this.hits.set(who, w);
      if (this.hits.size > 5000)
        for (const [k, v] of this.hits)
          if (v.resetAt <= now) this.hits.delete(k);
    }
    w.n += 1;
    const reset = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - w.n)));
    res.setHeader("RateLimit-Reset", String(reset));
    if (w.n > limit) {
      res.setHeader("Retry-After", String(reset));
      throw new HttpException(
        { code: "RATE_LIMITED", message: "Too many changes. Wait a moment." },
        429,
      );
    }
    return true;
  }
}

/** A staff read: signed in, one of these roles (ADMIN always counts). */
export const AdminRead = (...roles: VoicesRole[]) => Roles(...roles);

/** A staff write: the role check, then the per-account admin write limit. */
export const AdminWrite = (...roles: VoicesRole[]) =>
  applyDecorators(Roles(...roles), UseGuards(AdminWriteLimitGuard));
