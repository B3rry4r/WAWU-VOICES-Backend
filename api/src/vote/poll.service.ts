import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Actor } from "./support";
import { apiError } from "./support";
import {
  UNITS_PORT,
  type ChargeResult,
  type UnitsPort,
} from "../units/units.port";
import { RedisCache } from "./redis-cache";
import { VoteConfig } from "./vote-config";
import { Views } from "./views";
import { checkContent } from "./post-content";
import type { ExplainVoteDto } from "./dto";

type Json = Record<string, unknown>;

/** What the cache holds for a poll: its header and the stored counters. Never a row count. */
export interface PollSnapshot {
  id: string;
  kind: string;
  title: string;
  choiceMode: string;
  publicInterest: boolean;
  status: string;
  startsAt: string;
  endsAt: string;
  showLiveResults: boolean;
  questionId: string | null;
  topicId: string | null;
  totalVotes: number;
  options: { id: string; label: string; votes: number; sortOrder: number }[];
  asOf: string;
}

const resultsKey = (id: string): string => `vote:results:${id}`;

@Injectable()
export class PollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCache,
    private readonly cfg: VoteConfig,
    private readonly views: Views,
    @Optional() @Inject(UNITS_PORT) private readonly units?: UnitsPort,
  ) {}

  /** The poll as the results screens need it. Cached for poll.results_cache_seconds; `fresh` skips the cache. */
  async snapshot(pollId: string, fresh = false): Promise<PollSnapshot | null> {
    if (!fresh) {
      const hit = await this.redis.getJson<PollSnapshot>(resultsKey(pollId));
      if (hit) return hit;
    }
    const p = await this.prisma.poll.findUnique({
      where: { id: pollId },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    if (!p) return null;
    const snap: PollSnapshot = {
      id: p.id,
      kind: p.kind,
      title: p.title,
      choiceMode: p.choiceMode,
      publicInterest: p.publicInterest,
      status: p.status,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      showLiveResults: p.showLiveResults,
      questionId: p.questionId,
      topicId: p.topicId,
      totalVotes: p.totalVotes,
      options: p.options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: o.voteCount,
        sortOrder: o.sortOrder,
      })),
      asOf: new Date().toISOString(),
    };
    await this.redis.setJson(
      resultsKey(pollId),
      snap,
      await this.cfg.num("poll.results_cache_seconds"),
    );
    return snap;
  }

  /** SCHEDULED, OPEN or CLOSED by the clock as well as the stored status. */
  effectiveStatus(
    s: Pick<PollSnapshot, "status" | "startsAt" | "endsAt">,
  ): string {
    const now = Date.now();
    if (s.status === "CLOSED" || new Date(s.endsAt).getTime() <= now)
      return "CLOSED";
    if (s.status === "SCHEDULED" || new Date(s.startsAt).getTime() > now)
      return "SCHEDULED";
    return "OPEN";
  }

  async myVoteOptions(
    pollId: string,
    actor: Actor | null,
  ): Promise<string[] | null> {
    if (!actor) return null;
    const v = await this.prisma.vote.findUnique({
      where: { pollId_userId: { pollId, userId: actor.id } },
      include: { choices: true },
    });
    return v ? v.choices.map((c) => c.optionId).sort() : null;
  }

  private async canSeeCounts(
    s: PollSnapshot,
    voted: boolean,
  ): Promise<boolean> {
    if (this.effectiveStatus(s) === "CLOSED" || voted) return true;
    return (
      s.showLiveResults &&
      (await this.cfg.get<boolean>("poll.show_live_results"))
    );
  }

  private options(s: PollSnapshot, show: boolean): Json[] {
    return s.options.map((o) => ({
      id: o.id,
      label: o.label,
      ...(show
        ? {
            votes: o.votes,
            percent: s.totalVotes
              ? Math.round((o.votes / s.totalVotes) * 1000) / 10
              : 0,
          }
        : {}),
    }));
  }

  async toPoll(s: PollSnapshot, actor: Actor | null): Promise<Json> {
    const mine = await this.myVoteOptions(s.id, actor);
    const show = await this.canSeeCounts(s, !!mine);
    let cost = 0;
    if (!s.publicInterest) {
      const free = actor ? await this.views.freeLeft(actor.id, "VOTE") : 0;
      cost = free > 0 ? 0 : await this.cfg.num("cost.vote_milli");
    }
    return {
      id: s.id,
      kind: s.kind,
      title: s.title,
      label: "Open poll",
      choiceMode: s.choiceMode,
      status: this.effectiveStatus(s),
      publicInterest: s.publicInterest,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      questionId: s.questionId,
      topicId: s.topicId,
      totalVotes: show ? s.totalVotes : 0,
      options: this.options(s, show),
      myVote: mine,
      costToVoteMilli: cost,
    };
  }

  async get(pollId: string, actor: Actor | null): Promise<Json> {
    const s = await this.snapshot(pollId);
    if (!s) throw apiError(404, "NOT_FOUND", "We could not find that poll.");
    return this.toPoll(s, actor);
  }

  private async toList(ids: string[], actor: Actor | null): Promise<Json> {
    const items: Json[] = [];
    for (const id of ids) {
      const s = await this.snapshot(id);
      if (s) items.push(await this.toPoll(s, actor));
    }
    return { items };
  }

  async current(actor: Actor | null): Promise<Json> {
    const p = await this.prisma.poll.findFirst({
      where: {
        kind: "FLASH",
        status: "OPEN",
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
      },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!p) throw apiError(404, "NOT_FOUND", "No flash poll is open.");
    return this.get(p.id, actor);
  }

  async flash(actor: Actor | null): Promise<Json> {
    const rows = await this.prisma.poll.findMany({
      where: {
        kind: "FLASH",
        status: "OPEN",
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
      },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      select: { id: true },
      take: 50,
    });
    return this.toList(
      rows.map((r) => r.id),
      actor,
    );
  }

  async forQuestion(questionId: string, actor: Actor | null): Promise<Json> {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, topicId: true, status: true },
    });
    if (!q || q.status === "DRAFT")
      throw apiError(404, "NOT_FOUND", "We could not find that question.");
    const rows = await this.prisma.poll.findMany({
      where: {
        OR: [
          { questionId },
          ...(q.topicId
            ? [{ topicId: q.topicId, kind: "WEEKLY" as const }]
            : []),
        ],
        status: { not: "SCHEDULED" },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: 20,
    });
    return this.toList(
      rows.map((r) => r.id),
      actor,
    );
  }

  async results(
    pollId: string,
    actor: Actor | null,
    fresh = false,
  ): Promise<Json> {
    const s = await this.snapshot(pollId, fresh);
    if (!s) throw apiError(404, "NOT_FOUND", "We could not find that poll.");
    const mine = await this.myVoteOptions(pollId, actor);
    return this.resultsFor(s, mine);
  }

  async resultsFor(s: PollSnapshot, mine: string[] | null): Promise<Json> {
    if (!(await this.canSeeCounts(s, !!mine)))
      throw apiError(403, "FORBIDDEN", "Vote to see the results.", {
        reason: "RESULTS_HIDDEN",
      });
    const top = Math.max(0, ...s.options.map((o) => o.votes));
    const leaders = s.options.filter((o) => o.votes === top);
    return {
      pollId: s.id,
      status: this.effectiveStatus(s),
      totalVotes: s.totalVotes,
      options: this.options(s, true),
      leadingOptionId: top > 0 && leaders.length === 1 ? leaders[0].id : null,
      asOf: s.asOf,
      myVote: mine,
    };
  }

  /** One vote per account. Parallel requests meet at an advisory lock, then at the database unique keys. */
  async castVote(
    actor: Actor,
    pollId: string,
    optionIds: string[],
    key: string,
  ): Promise<Json> {
    const s = await this.snapshot(pollId, true);
    if (!s) throw apiError(404, "NOT_FOUND", "We could not find that poll.");
    const status = this.effectiveStatus(s);
    if (status === "CLOSED")
      throw apiError(409, "POLL_CLOSED", "This poll has closed.");
    if (status === "SCHEDULED")
      throw apiError(409, "POLL_NOT_STARTED", "This poll has not opened yet.");
    const valid = new Set(s.options.map((o) => o.id));
    const picked = [...new Set(optionIds)];
    if (picked.some((id) => !valid.has(id)))
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [
          { path: "optionIds", message: "Pick options from this poll." },
        ],
      });
    if (s.choiceMode === "SINGLE" && picked.length !== 1)
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "optionIds", message: "Pick one option." }],
      });
    const phoneHash = actor.phoneHash ?? `account:${actor.id}`;
    const alreadyVoted = (): Error =>
      apiError(409, "ALREADY_VOTED", "You have already voted in this poll.");

    const voted = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pollId}), hashtext(${actor.id}))`;
        const dup = await tx.vote.findFirst({
          where: { pollId, OR: [{ userId: actor.id }, { phoneHash }] },
          select: { id: true },
        });
        if (dup) throw alreadyVoted();
        let charge: ChargeResult | null = null;
        if (!s.publicInterest) {
          if (!this.units)
            throw apiError(
              503,
              "UNAVAILABLE",
              "Voting is not available right now. Try again soon.",
            );
          charge = await this.units.charge(actor.id, "VOTE", `vote:${key}`);
        }
        const vote = await tx.vote.create({
          data: {
            pollId,
            userId: actor.id,
            phoneHash,
            chargeId: charge?.chargeId ?? null,
            idempotencyKey: key,
            choices: { create: picked.map((optionId) => ({ optionId })) },
          },
        });
        await tx.pollOption.updateMany({
          where: { id: { in: picked } },
          data: { voteCount: { increment: 1 } },
        });
        await tx.poll.update({
          where: { id: pollId },
          data: { totalVotes: { increment: 1 } },
        });
        return { vote, charge };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    await this.redis.del(resultsKey(pollId));
    const fresh = await this.snapshot(pollId, true);
    const mine = picked.slice().sort();
    return {
      vote: {
        id: voted.vote.id,
        pollId,
        optionIds: mine,
        createdAt: voted.vote.createdAt.toISOString(),
      },
      results: await this.resultsFor(fresh as PollSnapshot, mine),
      charge: {
        costMilli: voted.charge?.costMilli ?? 0,
        usedFreePost: voted.charge?.usedFreePost ?? false,
        usedFreeDaily: voted.charge?.usedFreeDaily ?? false,
        balanceMilli: await this.views.balanceMilli(actor.id),
      },
    };
  }

  /** Explain my vote: an answer under the poll's question, only from the voter. Free at launch (V-15). */
  async explain(
    actor: Actor,
    pollId: string,
    dto: ExplainVoteDto,
  ): Promise<Json> {
    const poll = await this.prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll) throw apiError(404, "NOT_FOUND", "We could not find that poll.");
    const vote = await this.prisma.vote.findUnique({
      where: { pollId_userId: { pollId, userId: actor.id } },
    });
    if (!vote)
      throw apiError(
        403,
        "FORBIDDEN",
        "Only people who voted can explain their vote.",
      );
    let questionId = poll.questionId;
    if (!questionId && poll.topicId) {
      const q = await this.prisma.question.findFirst({
        where: { topicId: poll.topicId, isSpare: false },
        orderBy: [{ slotIndex: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      questionId = q?.id ?? null;
    }
    if (!questionId)
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [
          {
            path: "pollId",
            message: "This poll has no conversation to post to.",
          },
        ],
      });
    const maxChars = await this.cfg.num("text.max_chars");

    const answer = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"explain:" + vote.id}), 0)`;
      const had = await tx.answer.findUnique({
        where: { explainsVoteId: vote.id },
      });
      if (had && had.status !== "DELETED_BY_AUTHOR")
        throw apiError(
          409,
          "CONFLICT",
          "You have already explained this vote.",
        );
      const content = await checkContent(tx, actor, dto, maxChars, 1);
      const created = await tx.answer.create({
        data: {
          questionId: questionId,
          authorId: actor.id,
          kind: content.kind,
          body: content.body,
          clipId: content.clipId,
          explainsVoteId: had ? null : vote.id,
        },
      });
      await tx.question.update({
        where: { id: questionId },
        data: {
          answerCount: { increment: 1 },
          ...(content.kind === "VOICE" ? { voiceCount: { increment: 1 } } : {}),
        },
      });
      return { created, content };
    });

    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { category: true },
    });
    const clip = answer.created.clipId
      ? await this.prisma.voiceClip.findUnique({
          where: { id: answer.created.clipId },
          include: { transcript: true },
        })
      : null;
    return {
      answer: {
        id: answer.created.id,
        questionId,
        questionText: q?.text ?? null,
        categoryName: q?.category?.name ?? null,
        author: this.views.author(actor),
        kind: answer.created.kind,
        body: answer.created.body,
        clip: this.views.clip(clip),
        createdAt: answer.created.createdAt.toISOString(),
        editedAt: null,
        status: answer.created.status,
        news: null,
        likeCount: 0,
        replyCount: 0,
        agreeCount: 0,
        disagreeCount: 0,
        reactionCount: 0,
        reactionBreakdown: [],
        myReaction: null,
        iLiked: false,
        iSaved: false,
        isMine: true,
        explainsVote: true,
        labels: [],
      },
      charge: {
        costMilli: 0,
        usedFreePost: false,
        usedFreeDaily: false,
        balanceMilli: await this.views.balanceMilli(actor.id),
      },
      allowances: await this.views.allowances(actor),
    };
  }
}
