import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { waitForInFlight } from "../units/idempotency-wait";

export interface Replayable<T> {
  status: number;
  body: T;
}

/** Idempotency-Key on a POST (CONVENTIONS): same key and body returns the first answer; another body is a conflict. */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    actorId: string,
    key: string | undefined,
    method: string,
    path: string,
    body: unknown,
    work: () => Promise<Replayable<T>>,
  ): Promise<Replayable<T> & { replay: boolean }> {
    if (!key || key.length > 200)
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "This request needs an Idempotency-Key header.",
      });
    const requestHash = createHash("sha256")
      .update(`${method} ${path} ${JSON.stringify(body ?? null)}`)
      .digest("hex");
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          actorId,
          key,
          method,
          path,
          requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      const found = await this.prisma.idempotencyRecord.findUnique({
        where: { actorId_key: { actorId, key } },
      });
      if (found && found.expiresAt <= new Date()) {
        // Lapsed key: drop the stale row and start fresh.
        await this.prisma.idempotencyRecord.deleteMany({
          where: { id: found.id, expiresAt: { lte: new Date() } },
        });
        return this.run(actorId, key, method, path, body, work);
      }
      if (!found) return this.run(actorId, key, method, path, body, work);
      if (found.requestHash !== requestHash)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "That key was already used for a different request.",
        });
      if (!found.completedAt || found.statusCode === null) {
        // The first request is still running: wait for it and return its answer (never a 409 for a parallel retry).
        const w = await waitForInFlight(this.prisma, actorId, key);
        if (w.state === "gone")
          return this.run(actorId, key, method, path, body, work);
        if (w.state === "timeout" || w.statusCode === null)
          throw new ConflictException({
            code: "REQUEST_IN_PROGRESS",
            message: "That request is still running. Try again in a second.",
          });
        return { status: w.statusCode, body: w.body as T, replay: true };
      }
      return {
        status: found.statusCode,
        body: found.responseBody as T,
        replay: true,
      };
    }
    try {
      const out = await work();
      await this.prisma.idempotencyRecord.update({
        where: { actorId_key: { actorId, key } },
        data: {
          statusCode: out.status,
          responseBody: out.body as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return { ...out, replay: false };
    } catch (e) {
      // A failed request may be retried with the same key.
      await this.prisma.idempotencyRecord
        .delete({ where: { actorId_key: { actorId, key } } })
        .catch(() => undefined);
      throw e;
    }
  }
}
