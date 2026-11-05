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
import { NewsDecisionDto, NewsListQuery } from "./dto";
import { AdminNewsService } from "./news.service";

@Controller("admin/news")
export class AdminNewsController {
  constructor(private readonly svc: AdminNewsService) {}

  @Get("items")
  @Roles("EDITOR", "ADMIN")
  list(@Query() q: NewsListQuery) {
    return this.svc.list(q);
  }

  @Post(":answerId/decision")
  @HttpCode(200)
  @Roles("EDITOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  decide(
    @CurrentMe() me: CurrentMeInfo,
    @Param("answerId", new UuidParam()) answerId: string,
    @Body() dto: NewsDecisionDto,
  ) {
    return this.svc.decide(me, answerId, dto);
  }
}
