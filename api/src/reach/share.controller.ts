import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import type { Response } from "express";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { PrismaService } from "../common/prisma/prisma.service";
import { isUuid, validationFailed } from "./reach-support";
import { ShareCardService, ShareService, type Sharer } from "./share.service";

const OBJECT_TYPES = [
  "QUESTION",
  "ANSWER",
  "POLL_RESULT",
  "WEEKLY_REPORT",
  "PROFILE",
  "CATEGORY",
  "RESULT_THREAD",
  "WHAT_NEXT_SUMMARY",
] as const;
const TARGETS = [
  "WHATSAPP",
  "WHATSAPP_STATUS",
  "INSTAGRAM_STORIES",
  "FACEBOOK",
  "X",
  "TIKTOK",
  "TELEGRAM",
  "SMS",
  "COPY_LINK",
  "SYSTEM_SHEET",
] as const;
const EVENT_KINDS = [
  "intent",
  "link_open",
  "add_voice_tap",
  "recording_started",
  "published_from_link",
] as const;

export class CreateShareLinkBody {
  @IsIn(OBJECT_TYPES)
  objectType!: (typeof OBJECT_TYPES)[number];

  @IsUUID()
  objectId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)
  language?: string;
}

export class ShareEventBody {
  @IsIn(EVENT_KINDS)
  kind!: (typeof EVENT_KINDS)[number];

  @IsOptional()
  @IsIn(TARGETS)
  target?: (typeof TARGETS)[number];
}

@Controller("share")
export class ShareController {
  constructor(
    private readonly share: ShareService,
    private readonly cards: ShareCardService,
    private readonly prisma: PrismaService,
  ) {}

  private async me(user: MaybeVoicesUser) {
    if (!user) return null;
    return this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      select: { id: true, referralCode: true },
    });
  }

  @Post("links")
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async create(
    @CurrentUser() user: MaybeVoicesUser,
    @Body() body: CreateShareLinkBody,
  ) {
    const row = await this.me(user);
    const sharer: Sharer | null = row
      ? { userId: row.id, referralCode: row.referralCode }
      : null;
    return this.share.createLink(sharer, body);
  }

  @Get(":code")
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Header("Cache-Control", "public, max-age=30")
  page(@Param("code") code: string) {
    return this.share.page(code);
  }

  @Get(":code/card")
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async card(@Param("code") code: string, @Res() res: Response): Promise<void> {
    // The contract still lists ?size=, but only one card is drawn (V-22), so it is ignored.
    const out = await this.cards.image(code);
    if (!out) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "We could not find that.",
          requestId: res.getHeader("X-Request-Id"),
        },
      });
      return;
    }
    if ("pending" in out) {
      res.setHeader("Retry-After", "2");
      res.status(202).end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).end(out.png);
  }

  @Post(":code/events")
  @HttpCode(204)
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async event(
    @Param("code") code: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guestId: string | undefined,
    @Body() body: ShareEventBody,
  ): Promise<void> {
    if (guestId !== undefined && !isUuid(guestId))
      throw validationFailed("X-Guest-Id", "must be a UUID");
    const row = await this.me(user);
    await this.share.recordEvent(
      code,
      { userId: row?.id ?? null, guestId: guestId ?? null },
      { kind: body.kind, target: body.target },
    );
  }
}
