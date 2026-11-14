import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import {
  CreateProposalDto,
  ExplainVoteDto,
  StanceDto,
  VoteRequestDto,
} from "./dto";
import { VerificationService } from "../verify/verification.service";
import { requireVerified } from "../verify/verified";
import { PollService } from "./poll.service";
import { ProposalService } from "./proposal.service";
import {
  Actors,
  Idempotency,
  RateLimiter,
  apiError,
  uuidOr404,
} from "./support";
import { VoteConfig } from "./vote-config";

type Json = Record<string, unknown>;

const publicCache = (res: Response, seconds: number): void => {
  res.setHeader("Cache-Control", `public, max-age=${seconds}`);
  res.setHeader("Vary", "Authorization");
};

@Controller()
export class VoteController {
  constructor(
    private readonly polls: PollService,
    private readonly proposals: ProposalService,
    private readonly actors: Actors,
    private readonly limiter: RateLimiter,
    private readonly idem: Idempotency,
    private readonly cfg: VoteConfig,
    private readonly verification: VerificationService,
  ) {}

  // ---------------------------------------------------------------- polls

  @Get("polls/current")
  @UseGuards(OptionalAuthGuard)
  async current(
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json | string> {
    const poll = await this.polls.current(await this.actors.optional(user));
    if (poll) return poll;
    // A literal JSON null body (Nest would send nothing for a null return).
    res.type("application/json");
    return "null";
  }

  @Get("polls/flash")
  @UseGuards(OptionalAuthGuard)
  async flash(@CurrentUser() user: MaybeVoicesUser): Promise<Json> {
    return this.polls.flash(await this.actors.optional(user));
  }

  @Get("polls/:pollId")
  @UseGuards(OptionalAuthGuard)
  async getPoll(
    @Param("pollId") id: string,
    @CurrentUser() user: MaybeVoicesUser,
  ): Promise<Json> {
    return this.polls.get(uuidOr404(id), await this.actors.optional(user));
  }

  @Post("polls/:pollId/votes")
  @UseGuards(WawuAuthGuard)
  async castVote(
    @Param("pollId") id: string,
    @Body() dto: VoteRequestDto,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentUser() user: MaybeVoicesUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const pollId = uuidOr404(id);
    const actor = await this.actors.require(user);
    await this.limiter.check(
      res,
      "vote",
      actor.id,
      await this.cfg.num("ratelimit.vote_per_min"),
      60,
    );
    const out = await this.idem.run(
      actor.id,
      key,
      "POST",
      req.path,
      dto,
      201,
      () => this.polls.castVote(actor, pollId, dto.optionIds, key as string),
    );
    res.status(out.status);
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    return out.body;
  }

  @Get("polls/:pollId/results")
  @UseGuards(OptionalAuthGuard)
  async results(
    @Param("pollId") id: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const out = await this.polls.results(
      uuidOr404(id),
      await this.actors.optional(user),
    );
    publicCache(res, 5);
    return out;
  }

  /** Server-sent events: a PollResults line when the counters change. Ends after five minutes; the client reconnects. */
  @Get("polls/:pollId/results/stream")
  @SkipThrottle()
  @UseGuards(OptionalAuthGuard)
  async stream(
    @Param("pollId") id: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Res() res: Response,
  ): Promise<void> {
    const pollId = uuidOr404(id);
    const actor = await this.actors.optional(user);
    let last = JSON.stringify(await this.polls.results(pollId, actor, true));
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (data: string): void => {
      res.write(`data: ${data}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    };
    send(last);
    const every =
      Math.max(1, await this.cfg.num("poll.results_cache_seconds")) * 1000;
    const tick = setInterval(() => {
      this.polls
        .results(pollId, actor)
        .then((r) => {
          const now = JSON.stringify({ ...r, asOf: undefined });
          const prev = JSON.stringify({
            ...(JSON.parse(last) as Json),
            asOf: undefined,
          });
          if (now !== prev) {
            last = JSON.stringify(r);
            send(last);
          }
        })
        .catch(() => undefined);
    }, every);
    const stop = setTimeout(() => res.end(), 300_000);
    res.on("close", () => {
      clearInterval(tick);
      clearTimeout(stop);
    });
  }

  @Post("polls/:pollId/explanation")
  @UseGuards(WawuAuthGuard)
  async explain(
    @Param("pollId") id: string,
    @Body() dto: ExplainVoteDto,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentUser() user: MaybeVoicesUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const pollId = uuidOr404(id);
    const actor = await this.actors.require(user);
    await this.limiter.check(
      res,
      "post",
      actor.id,
      await this.cfg.num("ratelimit.post_per_10min"),
      600,
    );
    const out = await this.idem.run(
      actor.id,
      key,
      "POST",
      req.path,
      dto,
      201,
      () => this.polls.explain(actor, pollId, dto),
    );
    res.status(out.status);
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    return out.body;
  }

  // ---------------------------------------------------------------- What Next?

  @Get("questions/:questionId/what-next")
  @UseGuards(OptionalAuthGuard)
  async whatNext(
    @Param("questionId") id: string,
    @Query() q: { cursor?: string; limit?: string; sort?: string },
    @CurrentUser() user: MaybeVoicesUser,
  ): Promise<Json> {
    return this.proposals.whatNext(
      uuidOr404(id),
      await this.actors.optional(user),
      q,
    );
  }

  @Get("questions/:questionId/proposals/similar")
  @UseGuards(OptionalAuthGuard)
  async similar(
    @Param("questionId") id: string,
    @Query("text") text: string | undefined,
    @CurrentUser() user: MaybeVoicesUser,
  ): Promise<Json> {
    return this.proposals.similar(
      uuidOr404(id),
      text,
      await this.actors.optional(user),
    );
  }

  @Get("questions/:questionId/proposals")
  @UseGuards(OptionalAuthGuard)
  async listProposals(
    @Param("questionId") id: string,
    @Query()
    q: { cursor?: string; limit?: string; sort?: string; groupId?: string },
    @CurrentUser() user: MaybeVoicesUser,
  ): Promise<Json> {
    if (q.groupId) uuidOr404(q.groupId);
    return this.proposals.list(
      uuidOr404(id),
      await this.actors.optional(user),
      q,
    );
  }

  @Post("questions/:questionId/proposals")
  @UseGuards(WawuAuthGuard)
  async createProposal(
    @Param("questionId") id: string,
    @Body() dto: CreateProposalDto,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentUser() user: MaybeVoicesUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const questionId = uuidOr404(id);
    const actor = await this.actors.require(user);
    // V-46: only a verified person suggests an idea. Reading and voting stay open to everyone.
    requireVerified(await this.verification.fresh(actor));
    await this.limiter.check(
      res,
      "post",
      actor.id,
      await this.cfg.num("ratelimit.post_per_10min"),
      600,
    );
    const out = await this.idem.run(
      actor.id,
      key,
      "POST",
      req.path,
      dto,
      201,
      () => this.proposals.create(actor, questionId, dto),
    );
    res.status(out.status);
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    return out.body;
  }

  @Put("proposals/:proposalId/stance")
  @UseGuards(WawuAuthGuard)
  async setStance(
    @Param("proposalId") id: string,
    @Body() dto: StanceDto,
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const proposalId = uuidOr404(id);
    const actor = await this.actors.require(user);
    await this.limiter.check(res, "reaction", actor.id, 60, 60);
    return this.proposals.setStance(actor, proposalId, dto.kind);
  }

  @Delete("proposals/:proposalId/stance")
  @UseGuards(WawuAuthGuard)
  async removeStance(
    @Param("proposalId") id: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const proposalId = uuidOr404(id);
    const actor = await this.actors.require(user);
    await this.limiter.check(res, "reaction", actor.id, 60, 60);
    return this.proposals.setStance(actor, proposalId, null);
  }

  @Delete("proposals/:proposalId")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async deleteProposal(
    @Param("proposalId") id: string,
    @CurrentUser() user: MaybeVoicesUser,
  ): Promise<void> {
    const proposalId = uuidOr404(id);
    if (!user) throw apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    await this.proposals.remove(await this.actors.require(user), proposalId);
  }
}
