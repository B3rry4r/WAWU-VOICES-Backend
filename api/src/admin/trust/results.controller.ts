import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { MaybeVoicesUser, VoicesUser } from "../../common/auth/voices-user";
import { Roles } from "../../me";
import { UuidParam } from "../../me/views";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  CreateResultThreadDto,
  ListQueryDto,
  ResultDecisionDto,
} from "../../results/results.dto";
import { ResultsService } from "../../results/results.service";

/** Results admin: A6's ResultsService does the work and checks the role again; this adds the poster's notice. */
@Controller("admin/results")
export class AdminResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("threads")
  @Roles("EDITOR", "ADMIN")
  threads(@CurrentUser() u: MaybeVoicesUser, @Query() q: ListQueryDto) {
    return this.results.adminListThreads(u as VoicesUser, q);
  }

  @Post("threads")
  @Roles("EDITOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  createThread(@CurrentUser() u: MaybeVoicesUser, @Body() dto: CreateResultThreadDto) {
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
    if (r.decision !== "SEND_TO_MODERATION")
      await this.prisma.notification.upsert({
        where: {
          userId_groupKey: { userId: r.authorId, groupKey: `result-checked:${postId}` },
        },
        create: {
          userId: r.authorId,
          type: "RESULT_CHECKED",
          title:
            r.decision === "VERIFIED"
              ? "Your result was checked and marked Verified"
              : "Your result was checked and could not be confirmed",
          targetType: "result_post",
          targetId: postId,
          groupKey: `result-checked:${postId}`,
        },
        update: {
          title:
            r.decision === "VERIFIED"
              ? "Your result was checked and marked Verified"
              : "Your result was checked and could not be confirmed",
          readAt: null,
        },
      });
    return r.result;
  }
}
