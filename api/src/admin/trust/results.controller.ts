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
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type {
  MaybeVoicesUser,
  VoicesUser,
} from "../../common/auth/voices-user";
import { Roles } from "../../me";
import { UuidParam } from "../../me/views";
import {
  CreateResultThreadDto,
  ListQueryDto,
  ResultDecisionDto,
} from "../../results/results.dto";
import { ResultsService } from "../../results/results.service";

/** Results admin: A6's ResultsService does the work and checks the role again and tells the poster. */
@Controller("admin/results")
export class AdminResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get("threads")
  @Roles("EDITOR", "ADMIN")
  threads(@CurrentUser() u: MaybeVoicesUser, @Query() q: ListQueryDto) {
    return this.results.adminListThreads(u as VoicesUser, q);
  }

  @Post("threads")
  @Roles("EDITOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  createThread(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: CreateResultThreadDto,
  ) {
    return this.results.adminCreateThread(u as VoicesUser, dto);
  }

  @Get("posts")
  @Roles("EDITOR", "ADMIN")
  posts(@CurrentUser() u: MaybeVoicesUser, @Query() q: ListQueryDto) {
    return this.results.adminListPosts(u as VoicesUser, q);
  }

  @Post("posts/:postId/decision")
  @HttpCode(200)
  @Roles("EDITOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async decide(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("postId", new UuidParam()) postId: string,
    @Body() dto: ResultDecisionDto,
  ) {
    const r = await this.results.decide(u as VoicesUser, postId, dto);
    // The poster's RESULT_CHECKED alert is written by ResultsService.decide (one row per post, updated on a re-decision).
    return r.result;
  }
}
