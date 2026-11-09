import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { IsString } from "class-validator";
import type { Response } from "express";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import { ProfileService } from "../talk/shared/profile.service";
import { RateLimit, RateLimitGuard } from "../talk/shared/rate-limit";
import { UuidParam } from "../talk/shared/uuid-pipe";
import { VoiceVideoService } from "./voice-video.service";

class MakeVideoDto {
  @IsString() shape!: string;
}

/** LCH-07: "Make a video" on a person's own answer. Nothing here is public: every route is the author's. */
@Controller()
export class VoiceVideoController {
  constructor(
    private readonly videos: VoiceVideoService,
    private readonly profiles: ProfileService,
  ) {}

  @Post("answers/:answerId/videos")
  @HttpCode(202)
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("post")
  async make(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: MakeVideoDto,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.videos.request(me, id, dto.shape);
  }

  @Get("answers/:answerId/videos")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async list(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    const me = await this.profiles.requireProfile(u);
    return this.videos.list(me, id);
  }

  @Get("voice-videos/:videoId/file")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async file(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("videoId", UuidParam) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const me = await this.profiles.requireProfile(u);
    const mp4 = await this.videos.file(me, id);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", 'inline; filename="voices-video.mp4"');
    res.status(200).end(mp4);
  }
}
