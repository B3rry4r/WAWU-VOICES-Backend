import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import type { VoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import { PrismaService } from "../common/prisma/prisma.service";
import { ReachService } from "./reach.service";
import { requireProfile } from "./reach-support";

export class ListNotificationsQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : (value as unknown),
  )
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(["replies", "reactions", "polls", "all"])
  type?: string;
}

export class MarkReadBody {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  ids?: string[];
}

@Controller("notifications")
@UseGuards(WawuAuthGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class NotificationsController {
  constructor(
    private readonly reach: ReachService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: VoicesUser,
    @Query() q: ListNotificationsQuery,
  ) {
    const me = await requireProfile(this.prisma, user.sub);
    return this.reach.list(me.id, {
      cursor: q.cursor,
      limit: q.limit ?? 20,
      unreadOnly: q.unreadOnly,
      type: q.type,
    });
  }

  @Post("read")
  @HttpCode(200)
  async read(@CurrentUser() user: VoicesUser, @Body() body: MarkReadBody) {
    const me = await requireProfile(this.prisma, user.sub);
    return { unread: await this.reach.markRead(me.id, body.ids) };
  }

  @Get("unread-count")
  async unread(@CurrentUser() user: VoicesUser) {
    const me = await requireProfile(this.prisma, user.sub);
    return { unread: await this.reach.unread(me.id) };
  }
}
