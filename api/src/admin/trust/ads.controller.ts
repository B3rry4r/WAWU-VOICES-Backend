import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentMe, Roles } from "../../me";
import type { CurrentMeInfo } from "../../me";
import { UuidParam } from "../../me/views";
import { AdminAdsService } from "./ads.service";
import { AdDecisionDto, AdListQuery, UpsertAdDto } from "./dto";

@Controller("admin/ads")
export class AdminAdsController {
  constructor(private readonly svc: AdminAdsService) {}

  @Get()
  @Roles("AD_MANAGER", "ADMIN")
  list(@Query() q: AdListQuery) {
    return this.svc.list(q);
  }

  @Post()
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  create(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpsertAdDto) {
    return this.svc.create(me, dto);
  }

  @Patch(":adId")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  update(
    @CurrentMe() me: CurrentMeInfo,
    @Param("adId", new UuidParam()) adId: string,
    @Body() dto: UpsertAdDto,
  ) {
    return this.svc.update(me, adId, dto);
  }

  @Post(":adId/decision")
  @HttpCode(200)
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  decide(
    @CurrentMe() me: CurrentMeInfo,
    @Param("adId", new UuidParam()) adId: string,
    @Body() dto: AdDecisionDto,
  ) {
    return this.svc.decide(me, adId, dto);
  }
}
