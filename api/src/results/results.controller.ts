import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser, VoicesUser } from "../common/auth/voices-user";
import { ActorService } from "./actor.service";
import { IdempotencyService } from "./idempotency.service";
import { CreateResultPostDto, ListQueryDto } from "./results.dto";
import { ResultsService } from "./results.service";

/** Live results threads and posted numbers (V-7, V-8). Routes are exactly the contract's `result-posts` group. */
@Controller()
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly actors: ActorService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get("result-threads")
  @UseGuards(OptionalAuthGuard)
  listThreads(@Query() q: ListQueryDto) {
    return this.results.listThreads(q);
  }

  @Get("result-threads/:threadId")
  @UseGuards(OptionalAuthGuard)
  getThread(@Param("threadId", new ParseUUIDPipe()) threadId: string) {
    return this.results.getThread(threadId);
  }

  @Get("result-threads/:threadId/posts")
  @UseGuards(OptionalAuthGuard)
  listPosts(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("threadId", new ParseUUIDPipe()) threadId: string,
    @Query() q: ListQueryDto,
  ) {
    return this.results.listPosts(user, threadId, q);
  }

  @Post("result-threads/:threadId/posts")
  @UseGuards(WawuAuthGuard)
  async createPost(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("threadId", new ParseUUIDPipe()) threadId: string,
    @Body() dto: CreateResultPostDto,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await this.actors.resolve(user as VoicesUser, {
      write: true,
    });
    try {
      const out = await this.idem.run(
        actor.id,
        key,
        "POST",
        `/result-threads/${threadId}/posts`,
        dto,
        async () => ({
          status: 201,
          body: await this.results.createPost(
            actor,
            threadId,
            dto,
            key as string,
          ),
        }),
      );
      res.status(out.status);
      if (out.replay) res.setHeader("Idempotent-Replay", "true");
      return out.body;
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) {
        const wait = (
          e.getResponse() as { details?: { retryAfterSeconds?: number } }
        ).details?.retryAfterSeconds;
        if (wait) res.setHeader("Retry-After", String(wait));
      }
      throw e;
    }
  }

  @Delete("result-posts/:postId")
  @UseGuards(WawuAuthGuard)
  @HttpCode(204)
  async deletePost(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("postId", new ParseUUIDPipe()) postId: string,
  ): Promise<void> {
    const actor = await this.actors.resolve(user as VoicesUser, {
      write: true,
    });
    await this.results.deletePost(actor, postId);
  }
}
