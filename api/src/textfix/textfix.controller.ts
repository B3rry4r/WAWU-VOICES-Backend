import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { IsString } from "class-validator";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { IdempotencyService } from "../talk/shared/idempotency.service";
import { ProfileService } from "../talk/shared/profile.service";
import { RateLimit, RateLimitGuard } from "../talk/shared/rate-limit";
import { TextFixService } from "./textfix.service";

class TextFixDto {
  @IsString() text!: string;
}

@Controller()
export class TextFixController {
  constructor(
    private readonly fixes: TextFixService,
    private readonly profiles: ProfileService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post("text/fix")
  @HttpCode(200)
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("textFix")
  async fix(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: TextFixDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = await this.profiles.requireWriter(u);
    const r = await this.idem.run(
      {
        actorId: me.id,
        key,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        body: dto,
        status: 200,
      },
      () => this.fixes.fix(me.id, dto.text, (key as string).trim()),
    );
    if (r.replay) res.setHeader("Idempotent-Replay", "true");
    return r.value;
  }
}
