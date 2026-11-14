import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentMe, Roles } from "../../me";
import type { CurrentMeInfo } from "../../me";
import { UuidParam } from "../../me/views";
import { ModerationDecisionDto, ModerationListQuery } from "./dto";
import { ModerationService } from "./moderation.service";

/** Moderation queues (V-12). MODERATOR or ADMIN. */
@Controller("admin/moderation")
export class ModerationController {
  constructor(private readonly svc: ModerationService) {}

  @Get("items")
  @Roles("MODERATOR", "ADMIN")
  list(@Query() q: ModerationListQuery) {
    return this.svc.list(q);
  }

  @Get("items/:itemId")
  @Roles("MODERATOR", "ADMIN")
  get(
    @CurrentMe() me: CurrentMeInfo,
    @Param("itemId", new UuidParam()) itemId: string,
  ) {
    return this.svc.get(itemId, me);
  }

  @Post("items/:itemId/action")
  @HttpCode(200)
  @Roles("MODERATOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  act(
    @CurrentMe() me: CurrentMeInfo,
    @Param("itemId", new UuidParam()) itemId: string,
    @Body() dto: ModerationDecisionDto,
  ) {
    return this.svc.act(me, itemId, dto);
  }
}
