import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { ConfigReader } from "./shared/config-reader";
import { IdempotencyService } from "./shared/idempotency.service";
import { ProfileService } from "./shared/profile.service";
import { RateLimit, RateLimitGuard } from "./shared/rate-limit";
import { UuidParam } from "./shared/uuid-pipe";
import { EngagementService } from "./engagement.service";
import { visitorKeyOf } from "./listen-record";
import { PostsService } from "./posts.service";
import { REACTION_KINDS } from "./views";
import type {
  Mood,
  NewsTag,
  PostKind,
  ReactionKind,
  ReplyStance,
} from "../generated/prisma/client";

const KINDS = ["TEXT", "VOICE"];
const STANCES = ["AGREE", "DISAGREE", "EXPERIENCE"];
const TAGS = ["VERIFIED_NEWS", "UNVERIFIED_NEWS", "GOSSIP"];
const MOOD_WORDS = ["ANGRY", "TIRED", "PROUD", "HOPEFUL"];
const REACTIONS = REACTION_KINDS.map((k) => k.kind);

class CreateAnswerDto {
  @IsIn(KINDS) kind!: PostKind;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsUUID() clipId?: string;
  @IsOptional() @IsUUID() extraVoiceTokenId?: string;
  @IsOptional() @IsBoolean() isNews?: boolean;
  @IsOptional() @IsIn(TAGS) newsTag?: NewsTag;
  @IsOptional() @IsString() newsSourceName?: string;
  @IsOptional() @IsString() newsSourceUrl?: string;
  /** V-FIX-B: ask the editors for Verified News on this post (it posts as Unverified News until an editor decides). Needs newsSourceName. */
  @IsOptional() @IsBoolean() requestVerified?: boolean;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  /** LCH-02: the one word of an answer to a mood question (required there, refused anywhere else). */
  @IsOptional() @IsIn(MOOD_WORDS) mood?: Mood;
  /** LCH-03: "Show my name on the card", off unless the person turns it on. */
  @IsOptional() @IsBoolean() showNameOnCard?: boolean;
}
class EditAnswerDto {
  @IsString() body!: string;
}
class CreateReplyDto {
  @IsIn(STANCES) stance!: ReplyStance;
  @IsIn(KINDS) kind!: PostKind;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsUUID() clipId?: string;
  @IsOptional() @IsUUID() extraVoiceTokenId?: string;
  /** V-FIX-D: "Post without my name", off unless the person turns it on. */
  @IsOptional() @IsBoolean() anonymous?: boolean;
}
class ListenDto {
  /** The old body: completed says the clip was played to the end. Optional now, so an empty body is a start. */
  @IsOptional() @IsBoolean() completed?: boolean;
  @IsOptional() @IsInt() @Min(0) positionMs?: number;
  /** LISTEN-1: the most seconds this person has reached in the clip. */
  @IsOptional() @IsInt() @Min(0) @Max(86_400) secondsPlayed?: number;
  /** LISTEN-1: the player says the clip was played to the end (the server decides from the clip's length). */
  @IsOptional() @IsBoolean() finished?: boolean;
}
class ReactionDto {
  @IsIn(REACTIONS) kind!: ReactionKind;
}
class ReportDto {
  @IsIn(["ANSWER", "REPLY", "PROPOSAL", "RESULT_POST", "USER", "DM_MESSAGE"])
  targetType!:
    "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER" | "DM_MESSAGE";
  @IsUUID() targetId!: string;
  @IsIn([
    "HATE_OR_HARASSMENT",
    "THREAT_OR_VIOLENCE",
    "SCAM_OR_SPAM",
    "PERSONAL_DETAILS",
    "MISLEADING_NEWS_TAG",
    "ABOUT_ME",
    "OTHER",
  ])
  reason!: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() alsoBlock?: boolean;
}
class AppealDto {
  @IsIn(["ANSWER", "REPLY", "PROPOSAL", "RESULT_POST", "USER", "DM_MESSAGE"])
  targetType!:
    "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER" | "DM_MESSAGE";
  @IsUUID() targetId!: string;
  // lead ruling WF, 6 Nov (RW2): up to 500 characters, as the sheet says.
  @IsString() @MaxLength(500) note!: string;
}
class SupportDto {
  @IsIn(["PAYMENT", "ACCOUNT", "CONTENT", "OTHER"]) topic!: string;
  @IsString() message!: string;
  @IsOptional() @IsUUID() paymentId?: string;
  @IsOptional() @IsString() contactEmail?: string;
}
class RepliesQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsIn(STANCES) stance?: ReplyStance;
}

type Req2 = Request & { originalUrl: string };

@Controller()
export class TalkController {
  constructor(
    private readonly posts: PostsService,
    private readonly engage: EngagementService,
    private readonly profiles: ProfileService,
    private readonly idem: IdempotencyService,
    private readonly limiter: RateLimitGuard,
    private readonly config: ConfigReader,
  ) {}

  /**
   * V-PRELAUNCH: a write refused with the 409 QUESTION_NOT_OPEN (the question shown as coming up) does not count against
   * the post bucket: the try is given back. C22 (lead ruling): ONLY for that 409. Every 404, a draft, a hidden spare
   * question and a question that has not opened but is not shown as coming up included, counts like any other 404,
   * so one person cannot post to a draft for ever without meeting the per-person limit.
   */
  private async notCountedWhenNotOpen<T>(
    u: MaybeVoicesUser,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        u &&
        e instanceof HttpException &&
        e.getStatus() === 409 &&
        (e.getResponse() as { code?: string })?.code === "QUESTION_NOT_OPEN"
      )
        this.limiter.give("post", u.sub);
      throw e;
    }
  }

  /** How long a post-creating route keeps its Idempotency-Key record: config `idempotency.post_keep_days`, default 8 days. */
  private async postKeepMs(): Promise<number> {
    const days = await this.config.num("idempotency.post_keep_days");
    return (days > 0 ? days : 8) * 24 * 3600 * 1000;
  }

  private async once<T>(
    req: Req2,
    res: Response,
    actorId: string,
    key: string | undefined,
    body: unknown,
    status: number,
    fn: () => Promise<T>,
    ttlMs?: number,
    beforeReplay?: () => Promise<void>,
  ): Promise<T> {
    const r = await this.idem.run(
      {
        actorId,
        key,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        body,
        status,
        ...(ttlMs ? { ttlMs } : {}),
        ...(beforeReplay ? { beforeReplay } : {}),
      },
      fn,
    );
    if (r.replay) res.setHeader("Idempotent-Replay", "true");
    return r.value;
  }

  // ---- answers ----

  @Post("questions/:questionId/answers")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("post")
  async createAnswer(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("questionId", UuidParam) questionId: string,
    @Body() dto: CreateAnswerDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: Req2,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.notCountedWhenNotOpen(u, async () =>
      this.once(
        req,
        res,
        me.id,
        key,
        dto,
        201,
        () =>
          this.posts.createAnswer(me, questionId, dto, (key as string).trim()),
        await this.postKeepMs(),
        () => this.posts.assertReplayReadable({ questionId }),
      ),
    );
  }

  @Get("answers/:answerId")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async getAnswer(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    const me = await this.profiles.optional(u);
    return this.posts.getAnswer(id, me?.id ?? null);
  }

  @Patch("answers/:answerId")
  @UseGuards(WawuAuthGuard)
  async edit(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: EditAnswerDto,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.posts.editAnswer(me, id, dto.body);
  }

  @Delete("answers/:answerId")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async delete(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    const me = await this.profiles.requireWriter(u);
    await this.posts.deleteAnswer(me, id);
  }

  // Lead ruling LS, 6 Nov (LS10): the listen route has its own limits (per visitor and per address, in config), so the
  // global per-address throttler does not apply to it.
  @SkipThrottle()
  @Post("answers/:answerId/listen")
  @HttpCode(204)
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("listen")
  async listen(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: ListenDto,
    @Headers("x-visitor-id") visitor?: string,
  ) {
    const me = await this.profiles.optional(u);
    await this.engage.listen(id, dto, me?.id ?? null, visitorKeyOf(visitor));
  }

  @Put("answers/:answerId/save")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async saveAnswer(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    await this.engage.saveAnswer(
      await this.profiles.requireWriter(u),
      id,
      true,
    );
  }

  @Delete("answers/:answerId/save")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async unsaveAnswer(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    await this.engage.saveAnswer(
      await this.profiles.requireWriter(u),
      id,
      false,
    );
  }

  @Put("questions/:questionId/save")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async saveQuestion(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("questionId", UuidParam) id: string,
  ) {
    await this.engage.saveQuestion(
      await this.profiles.requireWriter(u),
      id,
      true,
    );
  }

  @Delete("questions/:questionId/save")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async unsaveQuestion(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("questionId", UuidParam) id: string,
  ) {
    await this.engage.saveQuestion(
      await this.profiles.requireWriter(u),
      id,
      false,
    );
  }

  // ---- replies ----

  @Get("answers/:answerId/replies")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async listReplies(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Query() q: RepliesQuery,
  ) {
    return this.posts.listReplies(id, await this.profiles.optional(u), q);
  }

  @Post("answers/:answerId/replies")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("post")
  async createReply(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: CreateReplyDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: Req2,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.notCountedWhenNotOpen(u, async () =>
      this.once(
        req,
        res,
        me.id,
        key,
        dto,
        201,
        () => this.posts.createReply(me, id, dto, (key as string).trim()),
        await this.postKeepMs(),
        () => this.posts.assertReplayReadable({ answerId: id }),
      ),
    );
  }

  @Delete("replies/:replyId")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async deleteReply(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("replyId", UuidParam) id: string,
  ) {
    await this.posts.deleteReply(await this.profiles.requireWriter(u), id);
  }

  // ---- likes ----

  @Put("answers/:answerId/like")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("like")
  async like(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Headers("x-guest-id") guest: string | undefined,
  ) {
    const me = u ? await this.profiles.requireWriter(u) : null;
    return this.engage.like(id, me, guest);
  }

  @Delete("answers/:answerId/like")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("like")
  async unlike(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Headers("x-guest-id") guest: string | undefined,
  ) {
    const me = u ? await this.profiles.requireWriter(u) : null;
    return this.engage.unlike(id, me, guest);
  }

  // ---- reactions ----

  @Get("reactions")
  listReactionKinds() {
    return { items: REACTION_KINDS };
  }

  @Put("answers/:answerId/reaction")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("reaction")
  async setReaction(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: ReactionDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: Req2,
    @Res({ passthrough: true }) res: Response,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.once(req, res, me.id, key, dto, 200, () =>
      this.engage.setReaction(me, id, dto.kind, (key as string).trim()),
    );
  }

  @Delete("answers/:answerId/reaction")
  @UseGuards(WawuAuthGuard)
  async removeReaction(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    return this.engage.removeReaction(await this.profiles.requireWriter(u), id);
  }

  // ---- reports ----

  @Post("reports")
  @UseGuards(WawuAuthGuard)
  async report(@CurrentUser() u: MaybeVoicesUser, @Body() dto: ReportDto) {
    return this.engage.report(await this.profiles.requireWriter(u), dto);
  }

  @Post("appeals")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("appeal")
  async appeal(@CurrentUser() u: MaybeVoicesUser, @Body() dto: AppealDto) {
    // The one write a suspended or banned person may still make: appeal their own items.
    return this.engage.appeal(await this.profiles.requireProfile(u), dto);
  }

  @Post("support/messages")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("support")
  async support(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: SupportDto,
    @Headers("x-guest-id") guest: string | undefined,
  ) {
    const me = u ? await this.profiles.requireWriter(u) : null;
    return this.engage.support(me, guest, dto);
  }

  @Put("answers/:answerId/helpful")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async helpful(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    await this.engage.helpful(await this.profiles.requireWriter(u), id, true);
  }

  @Delete("answers/:answerId/helpful")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async unhelpful(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    await this.engage.helpful(await this.profiles.requireWriter(u), id, false);
  }
}
