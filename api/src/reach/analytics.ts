import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Injectable,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { isUuid, validationFailed } from "./reach-support";

export class AnalyticsEventIn {
  @IsString()
  @Matches(/^[a-z0-9_.:-]{1,64}$/)
  name!: string;

  @IsDateString()
  at!: string;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}

export class AnalyticsBatch {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsEventIn)
  events!: AnalyticsEventIn[];
}

const DAY = 24 * 3600_000;
const PROPS_MAX_BYTES = 2048;

/** First-party analytics only: rows in our own database, no third-party tracker (v4.0 section 12, addendum 6). */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    user: MaybeVoicesUser,
    guestId: string | undefined,
    events: AnalyticsEventIn[],
  ): Promise<void> {
    events.forEach((e, i) => {
      if (
        e.props &&
        Buffer.byteLength(JSON.stringify(e.props)) > PROPS_MAX_BYTES
      )
        throw validationFailed(`events.${i}.props`, "props is too large");
    });
    const row = user
      ? await this.prisma.user.findUnique({
          where: { wawuId: user.sub },
          select: { id: true },
        })
      : null;
    const now = Date.now();
    await this.prisma.analyticsEvent.createMany({
      data: events.map((e) => {
        const at = new Date(e.at).getTime();
        // A phone clock far from ours is not trusted: those events are stamped with the server time.
        return {
          name: e.name,
          userId: row?.id ?? null,
          guestId: row ? null : (guestId ?? null),
          sessionId: e.sessionId ?? null,
          props: (e.props ?? undefined) as Prisma.InputJsonValue | undefined,
          createdAt: Math.abs(at - now) <= DAY ? new Date(at) : new Date(now),
        };
      }),
    });
  }
}

@Controller("events")
@UseGuards(OptionalAuthGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post()
  @HttpCode(204)
  async post(
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guestId: string | undefined,
    @Body() body: AnalyticsBatch,
  ): Promise<void> {
    if (guestId !== undefined && !isUuid(guestId))
      throw validationFailed("X-Guest-Id", "must be a UUID");
    await this.analytics.record(user, guestId, body.events);
  }
}
