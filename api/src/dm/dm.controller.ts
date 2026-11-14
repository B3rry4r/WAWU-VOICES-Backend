import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { IdempotencyService } from "../talk/shared/idempotency.service";
import { ProfileService } from "../talk/shared/profile.service";
import { RateLimit, RateLimitGuard } from "../talk/shared/rate-limit";
import { UuidParam } from "../talk/shared/uuid-pipe";
import { DM_MAX_CHARS, DmService } from "./dm.service";

class SendDmDto {
  @IsUUID() toUserId!: string;
  @IsIn(["TEXT", "VOICE"]) kind!: "TEXT" | "VOICE";
  // Longer than the limit is refused by the service with the one validation shape; this only stops a huge body.
  @IsOptional() @IsString() @MaxLength(DM_MAX_CHARS * 4) body?: string;
  @IsOptional() @IsUUID() clipId?: string;
}

class PageQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() limit?: string;
}

type Req2 = Request & { originalUrl: string };

/** V-DM: direct messages between two members. */
@Controller("dm")
export class DmController {
  constructor(
    private readonly dm: DmService,
    private readonly profiles: ProfileService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post("messages")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("post")
  async send(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: SendDmDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: Req2,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Suspended and banned members cannot send (403 ACCOUNT_SUSPENDED).
    const me = await this.profiles.requireWriter(u);
    const r = await this.idem.run(
      {
        actorId: me.id,
        key,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        body: dto,
        status: 201,
      },
      () => this.dm.send(me, dto, (key as string).trim()),
    );
    if (r.replay) res.setHeader("Idempotent-Replay", "true");
    return r.value;
  }

  @Get("conversations")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async conversations(
    @CurrentUser() u: MaybeVoicesUser,
    @Query() q: PageQuery,
  ) {
    return this.dm.conversations(await this.profiles.requireProfile(u), q);
  }

  @Get("conversations/:id/messages")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async messages(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("id", UuidParam) id: string,
    @Query() q: PageQuery,
  ) {
    return this.dm.messages(await this.profiles.requireProfile(u), id, q);
  }

  @Post("conversations/:id/read")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async read(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("id", UuidParam) id: string,
  ) {
    await this.dm.markRead(await this.profiles.requireProfile(u), id);
  }

  @Get("unread")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async unread(@CurrentUser() u: MaybeVoicesUser) {
    return this.dm.unreadTotal(await this.profiles.requireProfile(u));
  }

  @Get("with/:userId")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async withPerson(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("userId", UuidParam) userId: string,
  ) {
    return this.dm.withPerson(await this.profiles.requireProfile(u), userId);
  }
}
