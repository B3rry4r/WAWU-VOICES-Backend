import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { waitForInFlight } from "../../units/idempotency-wait";

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

const DAY_MS = 24 * 3600 * 1000;

/** Idempotency-Key handling (CONVENTIONS.md). Only successes are kept: a failed try (402 and so on) can be resent with the same key. */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    o: {
      actorId: string;
      key: string | undefined;
      method: string;
      path: string;
      body: unknown;
      status: number;
      /** How long the stored answer is kept; default 24 hours (answers and replies pass 8 days, config idempotency.post_keep_days). */
      ttlMs?: number;
    },
    fn: () => Promise<T>,
  ): Promise<{ value: T; replay: boolean }> {
    const key = o.key?.trim();
    if (!key || key.length > 200)
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Send an Idempotency-Key header.",
      });
    const requestHash = createHash("sha256")
      .update(stable(o.body))
      .digest("hex");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: {
            actorId: o.actorId,
            key,
            method: o.method,
            path: o.path,
            requestHash,
            expiresAt: new Date(Date.now() + (o.ttlMs ?? DAY_MS)),
          },
        });
        break;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
        const rec = await this.prisma.idempotencyRecord.findUnique({
          where: { actorId_key: { actorId: o.actorId, key } },
        });
        if (!rec) continue;
        if (rec.expiresAt < new Date()) {
          await this.prisma.idempotencyRecord.deleteMany({
            where: { id: rec.id },
          });
          continue;
        }
        if (
          rec.requestHash !== requestHash ||
          rec.method !== o.method ||
          rec.path !== o.path
        )
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "That key was already used for a different request.",
          });
        if (!rec.completedAt) {
          // The first request is still running: wait for it and return its answer (never a 409 for a parallel retry).
          const w = await waitForInFlight(this.prisma, o.actorId, key);
          if (w.state === "gone") continue;
          if (w.state === "timeout")
            throw new ConflictException({
              code: "REQUEST_IN_PROGRESS",
              message:
                "That request is still being handled. Try again in a second.",
            });
          return { value: w.body as T, replay: true };
        }
        return { value: rec.responseBody as T, replay: true };
      }
      if (attempt === 2)
        throw new ConflictException({
          code: "REQUEST_IN_PROGRESS",
          message:
            "That request is still being handled. Try again in a second.",
        });
    }
    try {
      const value = await fn();
      await this.prisma.idempotencyRecord.update({
        where: { actorId_key: { actorId: o.actorId, key } },
        data: {
          statusCode: o.status,
          responseBody: value as never,
          completedAt: new Date(),
        },
      });
      return { value, replay: false };
    } catch (e) {
      await this.prisma.idempotencyRecord
        .deleteMany({ where: { actorId: o.actorId, key } })
        .catch(() => undefined);
      throw e;
    }
  }
}
