import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { PrismaService } from "../common/prisma/prisma.service";
import type { AdEventKind, AdKind } from "../generated/prisma/client";
import { isUuid, validationFailed } from "./reach-support";

/** The Lagos calendar day as a plain date (UTC+1, no daylight saving). */
export function lagosDay(now = new Date()): Date {
  return new Date(
    `${new Date(now.getTime() + 3600_000).toISOString().slice(0, 10)}T00:00:00Z`,
  );
}

const KINDS: AdKind[] = ["FEED_CARD", "BANNER", "AUDIO_SLOT", "WALLET_OFFER"];
const EVENTS: AdEventKind[] = ["IMPRESSION", "TAP", "LISTEN"];

export class PlacementQuery {
  @IsOptional()
  @IsIn(KINDS)
  kind?: AdKind;

  @IsOptional()
  @IsUUID()
  questionId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class AdEventBody {
  @IsIn(EVENTS)
  kind!: AdEventKind;
}

/**
 * The public ad slot. Organic ranking never reads this (CONVENTIONS.md, Ranking). An ad never shows beside a sensitive
 * topic, never past its daily cap for that person, and always carries a label. "Never in the first 3 items" is the
 * client's rule (ads.never_in_first): this route has no item position, so the client must not ask for those slots.
 */
@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  private async who(user: MaybeVoicesUser, guestId?: string) {
    const row = user
      ? await this.prisma.user.findUnique({
          where: { wawuId: user.sub },
          select: { id: true, state: true },
        })
      : null;
    return {
      userId: row?.id ?? null,
      state: row?.state ?? null,
      guestId: row ? null : (guestId ?? null),
    };
  }

  async placement(
    user: MaybeVoicesUser,
    guestId: string | undefined,
    q: { kind?: AdKind; questionId?: string; categoryId?: string },
  ) {
    const me = await this.who(user, guestId);
    let categoryId = q.categoryId ?? null;
    if (q.questionId) {
      const question = await this.prisma.question.findUnique({
        where: { id: q.questionId },
        include: { topic: { select: { sensitive: true } } },
      });
      if (question && (question.sensitive || question.topic?.sensitive))
        return { ad: null };
      categoryId ??= question?.categoryId ?? null;
    }
    const day = lagosDay();
    const ads = await this.prisma.ad.findMany({
      where: {
        status: "APPROVED",
        ...(q.kind ? { kind: q.kind } : {}),
        AND: [
          { OR: [{ startsOn: null }, { startsOn: { lte: day } }] },
          { OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
        ],
      },
      orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    const viewer = me.userId
      ? { userId: me.userId }
      : me.guestId
        ? { guestId: me.guestId }
        : null;
    const seen = new Map<string, number>();
    if (viewer && ads.length) {
      const rows = await this.prisma.adEvent.groupBy({
        by: ["adId"],
        where: {
          adId: { in: ads.map((a) => a.id) },
          kind: "IMPRESSION",
          day,
          ...viewer,
        },
        _count: { _all: true },
      });
      for (const r of rows) seen.set(r.adId, r._count._all);
    }
    const eligible = ads.filter((a) => {
      if (
        a.categoryIds.length &&
        (!categoryId || !a.categoryIds.includes(categoryId))
      )
        return false;
      if (a.states.length && (!me.state || !a.states.includes(me.state)))
        return false;
      return (seen.get(a.id) ?? 0) < a.frequencyCapPerDay;
    });
    // Rotate: the ad this person has seen least today goes first.
    eligible.sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));
    const ad = eligible[0];
    if (!ad) return { ad: null };
    const image = ad.imageFileId
      ? await this.prisma.storedFile.findUnique({
          where: { id: ad.imageFileId },
        })
      : null;
    const cdn = process.env.SPACES_CDN_BASE?.replace(/\/$/, "");
    // An audio advert plays only when tapped. The clip is private like every voice; the page asks GET /voice-clips/{id}/play
    // for a short-lived link when the person taps play (ClipsService lets a clip on an approved advert be played).
    const clip =
      ad.kind === "AUDIO_SLOT" && ad.audioClipId
        ? await this.prisma.voiceClip.findFirst({
            where: { id: ad.audioClipId, status: "READY", removedAt: null },
            select: { durationMs: true },
          })
        : null;
    return {
      ad: {
        id: ad.id,
        kind: ad.kind,
        brand: ad.brand,
        label:
          ad.kind === "FEED_CARD" || ad.kind === "WALLET_OFFER"
            ? "Sponsored"
            : "Ad",
        headline: ad.headline,
        body: ad.body,
        imageUrl: image && cdn ? `${cdn}/${image.key}` : null,
        audioClipId: clip ? ad.audioClipId : null,
        ...(clip ? { audioDurationMs: clip.durationMs ?? null } : {}),
        linkUrl: ad.linkUrl,
        ctaLabel: ad.ctaLabel,
      },
    };
  }

  async record(
    adId: string,
    user: MaybeVoicesUser,
    guestId: string | undefined,
    kind: AdEventKind,
  ): Promise<void> {
    const ad = await this.prisma.ad.findFirst({
      where: { id: adId, status: "APPROVED" },
      select: { id: true },
    });
    if (!ad) throw new NotFoundException();
    const me = await this.who(user, guestId);
    const day = lagosDay();
    if (kind === "LISTEN") {
      // A listen counts once per person per advert per day (addendum 3B: "listens"). A person with neither an account nor
      // a guest id cannot be told apart from anyone else, so nothing is counted for them. The lock makes two taps that
      // arrive together count once.
      const who = me.userId ?? me.guestId;
      if (!who) return;
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ad-listen:${adId}:${who}:${day.toISOString()}`}))`;
        const seen = await tx.adEvent.findFirst({
          where: {
            adId,
            kind: "LISTEN",
            day,
            ...(me.userId ? { userId: me.userId } : { guestId: me.guestId }),
          },
          select: { id: true },
        });
        if (!seen)
          await tx.adEvent.create({
            data: {
              adId,
              kind,
              userId: me.userId,
              guestId: me.guestId,
              day,
            },
          });
      });
      return;
    }
    await this.prisma.adEvent.create({
      data: {
        adId,
        kind,
        userId: me.userId,
        guestId: me.guestId,
        day,
      },
    });
  }
}

@Controller("ads")
@UseGuards(OptionalAuthGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get("placement")
  placement(
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guestId: string | undefined,
    @Query() q: PlacementQuery,
  ) {
    if (guestId !== undefined && !isUuid(guestId))
      throw validationFailed("X-Guest-Id", "must be a UUID");
    return this.ads.placement(user, guestId, q);
  }

  @Post(":adId/events")
  @HttpCode(204)
  async event(
    @Param(
      "adId",
      new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException() }),
    )
    adId: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guestId: string | undefined,
    @Body() body: AdEventBody,
  ): Promise<void> {
    if (guestId !== undefined && !isUuid(guestId))
      throw validationFailed("X-Guest-Id", "must be a UUID");
    await this.ads.record(adId, user, guestId, body.kind);
  }
}
