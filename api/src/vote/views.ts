import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UNITS_PORT, type UnitsPort } from "../units/units.port";
import { displayKoboPerUnit } from "../units/units.display-rate";
import { VoteConfig } from "./vote-config";
import { lagosDay, type Actor } from "./support";

type Json = Record<string, unknown>;

/** Builds the contract shapes this module returns. Everything is read from the database, never typed here. */
@Injectable()
export class Views {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: VoteConfig,
    @Optional() @Inject(UNITS_PORT) private readonly units?: UnitsPort,
  ) {}

  async balanceMilli(userId: string): Promise<number> {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    return w?.balanceMilli ?? 0;
  }

  async freeLeft(userId: string, action: "VOTE" | "REACTION"): Promise<number> {
    if (this.units) return (await this.units.freeLeft(userId, action)).freeLeft;
    // No units module: read today's use from the same counter table.
    const [used, per] = await Promise.all([
      this.prisma.usageCounter.findUnique({
        where: {
          userId_day_action: { userId, day: new Date(lagosDay()), action },
        },
      }),
      this.cfg.num(
        action === "VOTE"
          ? "allowance.free_votes_per_day"
          : "allowance.free_reactions_per_day",
      ),
    ]);
    return Math.max(0, per - (used?.used ?? 0));
  }

  author(u: {
    id: string;
    handle: string;
    displayName: string | null;
    state: string | null;
  }): Json {
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: null,
      state: u.state,
    };
  }

  clip(
    c: {
      id: string;
      status: string;
      durationMs: number | null;
      maxDurationMs: number;
      peaks: unknown;
      transcript?: {
        status: string;
        language: string | null;
        text: string | null;
      } | null;
    } | null,
  ): Json | null {
    if (!c) return null;
    return {
      id: c.id,
      status: c.status,
      durationMs: c.durationMs,
      maxDurationMs: c.maxDurationMs,
      peaks: Array.isArray(c.peaks) ? (c.peaks as number[]) : null,
      transcript: c.transcript
        ? {
            status: c.transcript.status,
            language: c.transcript.language,
            text: c.transcript.text,
          }
        : null,
    };
  }

  /** The Question card for What Next? (recent voices and overrides are the feed module's, left empty here). */
  async question(
    q: {
      id: string;
      topicId: string | null;
      categoryId: string | null;
      kind: string;
      status: string;
      text: string;
      hint: string | null;
      scheduledFor: Date | null;
      startsAt: Date | null;
      endsAt: Date | null;
      pinned: boolean;
      sensitive: boolean;
      voiceCount: number;
      answerCount: number;
    },
    proposalCount: number,
    actor: Actor | null,
  ): Promise<Json> {
    const [topic, category, saved, openPoll] = await Promise.all([
      q.topicId
        ? this.prisma.topic.findUnique({ where: { id: q.topicId } })
        : null,
      q.categoryId
        ? this.prisma.category.findUnique({ where: { id: q.categoryId } })
        : null,
      actor
        ? this.prisma.savedQuestion.findFirst({
            where: { userId: actor.id, questionId: q.id },
            select: { id: true },
          })
        : null,
      this.prisma.poll.findFirst({
        where: {
          OR: [
            { questionId: q.id },
            ...(q.topicId
              ? [{ topicId: q.topicId, kind: "WEEKLY" as const }]
              : []),
          ],
          status: "OPEN",
          endsAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    ]);
    return {
      id: q.id,
      topicId: q.topicId,
      topicTitle: topic?.title ?? null,
      weekNumber: topic?.weekNumber ?? null,
      kind: q.kind,
      status: q.status,
      text: q.text,
      hint: q.hint,
      scheduledFor: q.scheduledFor?.toISOString().slice(0, 10) ?? null,
      startsAt: q.startsAt?.toISOString() ?? null,
      endsAt: q.endsAt?.toISOString() ?? null,
      pinned: q.pinned,
      sensitive: q.sensitive,
      voiceCount: q.voiceCount,
      answerCount: q.answerCount,
      // lead ruling WF, 6 Nov (RW1): voices are top-level answers, voice or text, not removed or deleted.
      voicesCount: q.answerCount,
      hasOpenPoll: !!openPoll,
      proposalCount,
      iSaved: !!saved,
      recentVoices: [],
      override: null,
      category: category
        ? {
            id: category.id,
            slug: category.slug,
            name: category.name,
            blurb: category.blurb,
            voicesThisWeek: 0,
            questionCount: 0,
          }
        : null,
    };
  }

  /** The Allowances block of a post receipt: what is left and what it costs, from config and the ledger. */
  async allowances(actor: Actor): Promise<Json> {
    const [bal, free, fv, fr, tokens] = await Promise.all([
      this.balanceMilli(actor.id),
      this.prisma.freeAllowance.findUnique({ where: { userId: actor.id } }),
      this.freeLeft(actor.id, "VOTE"),
      this.freeLeft(actor.id, "REACTION"),
      this.prisma.extraVoiceToken.findMany({
        where: { userId: actor.id, status: "AVAILABLE" },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const n = (k: string): Promise<number> => this.cfg.num(k);
    return {
      freePostsRemaining:
        free?.freePostsRemaining ?? (await n("allowance.free_posts")),
      balanceMilli: bal,
      maxVoiceSeconds: await n("voice.extra60.max_seconds"),
      freeReactionsLeftToday: fr,
      freeVotesLeftToday: fv,
      costs: {
        freeReactionsPerDay: await n("allowance.free_reactions_per_day"),
        freeVotesPerDay: await n("allowance.free_votes_per_day"),
        baseKoboPerUnit: await displayKoboPerUnit(this.prisma, () =>
          n("units.base_rate_kobo"),
        ),
        textPostMilli: await n("cost.text_post_milli"),
        voicePostMilli: await n("cost.voice_post_milli"),
        reactionAfterFreeMilli: await n("cost.reaction_milli"),
        voteAfterFreeMilli: await n("cost.vote_milli"),
        minPackKobo: await n("units.min_purchase_kobo"),
        extraVoice30Kobo: await n("voice.extra30.price_kobo"),
        extraVoice60Kobo: await n("voice.extra60.price_kobo"),
        textMaxChars: await n("text.max_chars"),
        textPriceChars: await n("text.price_chars"),
        freePostTextChars: await n("allowance.free_post_text_chars"),
        messagesPerDay: await n("allowance.messages_per_day"),
        textFixMilli: await n("textfix.cost_milli"),
        voiceTier1Seconds: await n("voice.extra30.max_seconds"),
        voiceMaxSeconds: await n("voice.extra60.max_seconds"),
        freeVoiceSeconds: await n("voice.free_seconds"),
      },
      extraVoiceTokens: tokens.map((t) => ({
        id: t.id,
        kind: t.kind,
        maxSeconds: t.maxSeconds,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
}
