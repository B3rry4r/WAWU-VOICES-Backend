import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsConfig } from "./units.config";
import { apiError } from "./units.errors";

/**
 * Extra voice tokens: one token, one message. Every change is one conditional UPDATE on the status, so two requests
 * racing for one token cannot both win: the loser changes zero rows.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: UnitsConfig,
  ) {}

  /**
   * RESERVED tokens older than the configured time go back to AVAILABLE (an abandoned clip must not cost a paid token).
   * `reservedAt` is the reservation time while the status is RESERVED; `usedAt` means the token was used.
   */
  async releaseStale(now: Date = new Date()): Promise<number> {
    const minutes = await this.cfg.int("voice.token_reserve_expiry_minutes");
    const cutoff = new Date(now.getTime() - minutes * 60_000);
    const r = await this.prisma.extraVoiceToken.updateMany({
      where: { status: "RESERVED", reservedAt: { lt: cutoff } },
      data: { status: "AVAILABLE", usedOnClipId: null, reservedAt: null },
    });
    if (r.count > 0)
      this.logger.warn(
        `Released ${r.count} extra voice token(s) reserved for over ${minutes} minutes`,
      );
    return r.count;
  }

  /** AVAILABLE -> RESERVED for a clip in progress. */
  async reserve(
    userId: string,
    tokenId: string,
    clipId: string,
  ): Promise<{ maxSeconds: number }> {
    const r = await this.prisma.extraVoiceToken.updateMany({
      where: { id: tokenId, userId, status: "AVAILABLE" },
      data: {
        status: "RESERVED",
        usedOnClipId: clipId,
        reservedAt: new Date(),
      },
    });
    if (r.count !== 1)
      throw apiError(
        409,
        "CONFLICT",
        "That extra voice token is not available.",
      );
    const t = await this.prisma.extraVoiceToken.findUniqueOrThrow({
      where: { id: tokenId },
    });
    return { maxSeconds: t.maxSeconds };
  }

  /** RESERVED -> USED when the post publishes. Only the clip that reserved it can use it. */
  async consume(
    userId: string,
    tokenId: string,
    clipId: string,
  ): Promise<void> {
    const r = await this.prisma.extraVoiceToken.updateMany({
      where: { id: tokenId, userId, status: "RESERVED", usedOnClipId: clipId },
      data: { status: "USED", usedAt: new Date() },
    });
    if (r.count !== 1)
      throw apiError(
        409,
        "CONFLICT",
        "That extra voice token is not reserved for this recording.",
      );
  }

  /** RESERVED -> AVAILABLE when the clip is discarded or the post fails. Safe to call twice. */
  async release(
    userId: string,
    tokenId: string,
    clipId: string,
  ): Promise<void> {
    await this.prisma.extraVoiceToken.updateMany({
      where: { id: tokenId, userId, status: "RESERVED", usedOnClipId: clipId },
      data: { status: "AVAILABLE", usedOnClipId: null, reservedAt: null },
    });
  }

  /** My tokens that can still be used or are held for a post in progress. */
  async mine(userId: string) {
    return this.prisma.extraVoiceToken.findMany({
      where: { userId, status: { in: ["AVAILABLE", "RESERVED"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
}
