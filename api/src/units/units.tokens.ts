import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { apiError } from "./units.errors";

/**
 * Extra voice tokens: one token, one message. Every change is one conditional UPDATE on the status, so two requests
 * racing for one token cannot both win: the loser changes zero rows.
 */
@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** AVAILABLE -> RESERVED for a clip in progress. */
  async reserve(
    userId: string,
    tokenId: string,
    clipId: string,
  ): Promise<{ maxSeconds: number }> {
    const r = await this.prisma.extraVoiceToken.updateMany({
      where: { id: tokenId, userId, status: "AVAILABLE" },
      data: { status: "RESERVED", usedOnClipId: clipId },
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
      data: { status: "AVAILABLE", usedOnClipId: null },
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
