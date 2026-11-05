import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import type { VoicesUser } from "../common/auth/voices-user";
import { PrismaService } from "../common/prisma/prisma.service";
import { RedisCache } from "./redis-cache";
import { waitForInFlight } from "../units/idempotency-wait";

/** An error in the contract's one shape: the filter turns { code, message, details } into the body. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException({ code, message, details }, status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that is not a uuid is a thing that does not exist. */
export function uuidOr404(id: string): string {
  if (!UUID.test(id)) throw new NotFoundException();
  return id;
}

/** Lagos is UTC+1 all year. */
export function lagosDay(d = new Date()): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export type Actor = NonNullable<
  Awaited<ReturnType<PrismaService["user"]["findUnique"]>>
>;

/** Who is calling: the VOICES profile behind a WAWU ID token. */
@Injectable()
export class Actors {
  constructor(private readonly prisma: PrismaService) {}

  /** The profile of a signed-in caller, or null for a guest or a token with no profile yet. */
  async optional(user: VoicesUser | undefined): Promise<Actor | null> {
    if (!user) return null;
    const row = await this.prisma.user.findUnique({
      where: { wawuId: user.sub },
    });
    return row && row.status !== "DELETED" ? row : null;
  }

  /** A finished profile that may write. */
  async require(user: VoicesUser | undefined): Promise<Actor> {
    const row = await this.optional(user);
    if (!row)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Finish your profile first.",
        details: { reason: "PROFILE_REQUIRED" },
      });
    const suspended =
      row.status === "BANNED" ||
      (row.status === "SUSPENDED" &&
        (!row.suspendedUntil || row.suspendedUntil > new Date()));
    if (suspended)
      throw new ForbiddenException({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account is paused. You can read, but not post.",
        details: { until: row.suspendedUntil?.toISOString() ?? null },
      });
    return row;
  }
}

/** Per-account fixed-window limits, in Redis with an in-process fallback. Headers on every answer. */
@Injectable()
export class RateLimiter {
  private memory = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly redis: RedisCache) {}

  async check(
    res: Response,
    bucket: string,
    actorId: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `rl:${bucket}:${actorId}`;
    let hit = await this.redis.hit(key, windowSeconds);
    if (!hit) {
      const now = Date.now();
      let m = this.memory.get(key);
      if (!m || m.resetAt <= now) {
        m = { count: 0, resetAt: now + windowSeconds * 1000 };
        this.memory.set(key, m);
      }
      m.count += 1;
      hit = { count: m.count, ttl: Math.ceil((m.resetAt - now) / 1000) };
    }
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, limit - hit.count)),
    );
    res.setHeader("RateLimit-Reset", String(hit.ttl));
    if (hit.count > limit) {
      res.setHeader("Retry-After", String(hit.ttl));
      throw apiError(
        429,
        "RATE_LIMITED",
        "Too many tries. Wait a moment and try again.",
      );
    }
  }
}

export interface Replayed<T> {
  status: number;
  body: T;
  replay: boolean;
}

/**
 * Idempotency-Key (CONVENTIONS.md): same key, actor, method, path and body inside 24 hours answers with the first
 * response; another body is 409 IDEMPOTENCY_KEY_REUSED; a key still running is 409 REQUEST_IN_PROGRESS.
 * A failed run stores nothing, so the person can retry with the same key.
 */
@Injectable()
export class Idempotency {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    actorId: string,
    key: string | undefined,
    method: string,
    path: string,
    body: unknown,
    status: number,
    fn: () => Promise<T>,
  ): Promise<Replayed<T>> {
    if (!key || key.length < 8 || key.length > 200)
      throw apiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "This request needs an Idempotency-Key.",
      );
    const requestHash = createHash("sha256")
      .update(JSON.stringify(body ?? null))
      .digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 3_600_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rec = await this.prisma.idempotencyRecord.create({
          data: { actorId, key, method, path, requestHash, expiresAt },
        });
        try {
          const out = await fn();
          await this.prisma.idempotencyRecord.update({
            where: { id: rec.id },
            data: {
              statusCode: status,
              responseBody: out as never,
              completedAt: new Date(),
            },
          });
          return { status, body: out, replay: false };
        } catch (e) {
          await this.prisma.idempotencyRecord
            .delete({ where: { id: rec.id } })
            .catch(() => undefined);
          throw e;
        }
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
        const old = await this.prisma.idempotencyRecord.findUnique({
          where: { actorId_key: { actorId, key } },
        });
        if (!old) continue;
        if (old.expiresAt <= new Date()) {
          await this.prisma.idempotencyRecord
            .deleteMany({ where: { id: old.id } })
            .catch(() => undefined);
          continue;
        }
        if (
          old.requestHash !== requestHash ||
          old.method !== method ||
          old.path !== path
        )
          throw apiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "That key was used for a different request.",
          );
        if (!old.completedAt) {
          // The first request is still running: wait for it and return its answer (never a 409 for a parallel retry).
          const w = await waitForInFlight(this.prisma, actorId, key);
          if (w.state === "gone") continue;
          if (w.state === "timeout")
            throw apiError(
              409,
              "REQUEST_IN_PROGRESS",
              "That request is still running. Try again in a second.",
            );
          return {
            status: w.statusCode ?? status,
            body: w.body as T,
            replay: true,
          };
        }
        return {
          status: old.statusCode ?? status,
          body: old.responseBody as T,
          replay: true,
        };
      }
    }
    throw new ConflictException();
  }
}
