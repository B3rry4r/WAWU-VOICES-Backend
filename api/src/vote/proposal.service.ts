import { MailEvents } from "../mail/mail-events";
import { Injectable, Optional } from "@nestjs/common";
import {
  isQuestionOver,
  isQuestionReadable,
  notOpenYet,
} from "../feed/question-window";
import { ReachService } from "../reach/reach.service";
import { quoteOf } from "../reach/reach-support";
import { hiddenUserIdsOf } from "../me/blocks";
import { PrismaService } from "../common/prisma/prisma.service";
import { avatarUrls } from "../common/people";
import { apiError, type Actor } from "./support";
import { RedisCache } from "./redis-cache";
import { VoteConfig } from "./vote-config";
import { Views } from "./views";
import { checkContent } from "./post-content";
import type { CreateProposalDto } from "./dto";

type Json = Record<string, unknown>;

const CURSOR_LIFE_MS = 24 * 3_600_000;

interface Cursor {
  sort: string;
  k: number | string;
  id: string;
  at: number;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | undefined, sort: string): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (
      c.sort !== sort ||
      typeof c.id !== "string" ||
      Date.now() - c.at > CURSOR_LIFE_MS
    )
      throw new Error("bad");
    return c;
  } catch {
    throw apiError(
      400,
      "BAD_REQUEST",
      "That page link is out of date. Reload the list.",
    );
  }
}

const words = (t: string): Set<string> =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

@Injectable()
export class ProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCache,
    private readonly cfg: VoteConfig,
    private readonly views: Views,
    private readonly reach: ReachService,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  /** B11: reads the improved proposal's words, then hands the mail over. Never throws. */
  private async sendImproved(
    authorId: string,
    improvesId: string | null,
    handle: string,
    body: string | null,
    questionId: string,
    newId: string,
  ): Promise<void> {
    const parent = improvesId
      ? await this.prisma.proposal.findUnique({
          where: { id: improvesId },
          select: { body: true },
        })
      : null;
    await this.mails?.proposalImproved(
      authorId,
      parent?.body ?? null,
      handle,
      body,
      questionId,
      newId,
    );
  }

  /** V-27: 404 before the window; with `write`, 409 QUESTION_CLOSED after it. */
  private async question(questionId: string, write = false) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    await this.assertWindow(q, write);
    return q as NonNullable<typeof q>;
  }

  private async assertWindow(
    q: {
      id: string;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
    } | null,
    write: boolean,
  ): Promise<void> {
    const now = new Date();
    if (q && write) {
      const early = await notOpenYet(this.prisma, q, now);
      if (early) throw early;
    }
    if (!q || !isQuestionReadable(q, now))
      throw apiError(404, "NOT_FOUND", "We could not find that question.");
    if (write && isQuestionOver(q, now))
      throw apiError(409, "QUESTION_CLOSED", "This question is closed.");
  }

  /** Contract Proposal, with isMine and myStance for a signed-in caller. */
  private async shape(
    rows: ProposalRow[],
    actor: Actor | null,
  ): Promise<Json[]> {
    const stances = actor
      ? await this.prisma.proposalStance.findMany({
          where: {
            userId: actor.id,
            proposalId: { in: rows.map((r) => r.id) },
          },
        })
      : [];
    const mine = new Map(stances.map((s) => [s.proposalId, s.kind]));
    const pictures = await avatarUrls(
      this.prisma,
      rows.map((r) => ({
        id: r.author.id,
        avatarFileId: r.author.avatarFileId ?? null,
        status: r.author.status ?? null,
      })),
    );
    return rows.map((p) => ({
      id: p.id,
      questionId: p.questionId,
      author: this.views.author(p.author, pictures.get(p.author.id) ?? null),
      kind: p.kind,
      body: p.body,
      clip: this.views.clip(p.clip),
      label: "PROPOSED",
      supportCount: p.supportCount,
      challengeCount: p.challengeCount,
      improveCount: p.improveCount,
      groupId: p.groupId,
      improvesId: p.improvesId,
      myStance: mine.get(p.id) ?? null,
      createdAt: p.createdAt.toISOString(),
      isMine: actor ? p.authorId === actor.id : false,
    }));
  }

  private readonly include = {
    author: true,
    clip: { include: { transcript: true } },
  } as const;

  async list(
    questionId: string,
    actor: Actor | null,
    q: { cursor?: string; limit?: string; sort?: string; groupId?: string },
  ): Promise<{ items: Json[]; nextCursor: string | null }> {
    await this.question(questionId);
    const sort = q.sort === "NEW" ? "NEW" : "SUPPORT";
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const cur = decodeCursor(q.cursor, sort);
    const keyset =
      cur &&
      (sort === "NEW"
        ? {
            OR: [
              { createdAt: { lt: new Date(String(cur.k)) } },
              { createdAt: new Date(String(cur.k)), id: { lt: cur.id } },
            ],
          }
        : {
            OR: [
              { supportCount: { lt: Number(cur.k) } },
              { supportCount: Number(cur.k), id: { lt: cur.id } },
            ],
          });
    const rows = await this.prisma.proposal.findMany({
      where: {
        questionId,
        status: "PUBLISHED",
        ...(q.groupId ? { groupId: q.groupId } : {}),
        ...(keyset ?? {}),
      },
      orderBy:
        sort === "NEW"
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ supportCount: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: this.include,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.shape(page, actor),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({
              sort,
              k:
                sort === "NEW"
                  ? last.createdAt.toISOString()
                  : last.supportCount,
              id: last.id,
              at: Date.now(),
            })
          : null,
    };
  }

  /** Published proposals under a question. Cached a few seconds: the only count this module takes. */
  private async total(questionId: string): Promise<number> {
    const key = `vote:proposals:${questionId}`;
    const hit = await this.redis.getJson<{ n: number }>(key);
    if (hit) return hit.n;
    const n = await this.prisma.proposal.count({
      where: { questionId, status: "PUBLISHED" },
    });
    await this.redis.setJson(key, { n }, 5);
    return n;
  }

  async whatNext(
    questionId: string,
    actor: Actor | null,
    q: { cursor?: string; limit?: string; sort?: string },
  ): Promise<Json> {
    const question = await this.question(questionId);
    const [page, proposalTotal, groups, summaryRow] = await Promise.all([
      this.list(questionId, actor, q),
      this.total(questionId),
      this.prisma.proposalGroup.findMany({
        where: { questionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 50,
      }),
      question.topicId
        ? this.prisma.editorialSummary.findUnique({
            where: { topicId: question.topicId },
          })
        : null,
    ]);
    const ids = groups.map((g) => g.id);
    const agg = ids.length
      ? await this.prisma.proposal.groupBy({
          by: ["groupId"],
          where: { groupId: { in: ids }, status: "PUBLISHED" },
          _count: { _all: true },
          _sum: { supportCount: true, challengeCount: true },
        })
      : [];
    const tops = await Promise.all(
      ids.map((id) =>
        this.prisma.proposal.findFirst({
          where: { groupId: id, status: "PUBLISHED" },
          orderBy: [{ supportCount: "desc" }, { id: "desc" }],
          include: this.include,
        }),
      ),
    );
    const topShaped = await this.shape(
      tops.filter((t): t is NonNullable<typeof t> => !!t),
      actor,
    );
    const topById = new Map(topShaped.map((t) => [t.id as string, t]));
    const sumBy = new Map(agg.map((a) => [a.groupId, a]));
    const reviewed =
      summaryRow && summaryRow.reviewedById && summaryRow.reviewedAt;
    return {
      question: await this.views.question(question, proposalTotal, actor),
      summary: reviewed
        ? {
            topicId: summaryRow.topicId,
            mainView: summaryRow.mainView,
            mainViewVoices: summaryRow.mainViewVoices,
            opposingView: summaryRow.opposingView,
            opposingViewVoices: summaryRow.opposingViewVoices,
            pollLine: summaryRow.pollLine,
            nextStepsLine: summaryRow.nextStepsLine,
            basedOnVoices: summaryRow.basedOnVoices,
            basedOnVotes: summaryRow.basedOnVotes,
            updatedAt: summaryRow.updatedAt.toISOString(),
            reviewedByEditor: true,
          }
        : null,
      proposalTotal,
      groupTotal: groups.length,
      groups: groups.map((g, i) => {
        const a = sumBy.get(g.id);
        const top = tops[i];
        return {
          id: g.id,
          title: g.title,
          confirmed: !!g.confirmedById,
          proposalCount: a?._count._all ?? 0,
          supportCount: a?._sum.supportCount ?? 0,
          challengeCount: a?._sum.challengeCount ?? 0,
          topProposal: top ? (topById.get(top.id) ?? null) : null,
        };
      }),
      proposals: page.items,
      nextCursor: page.nextCursor,
    };
  }

  /** Proposals whose words overlap a draft: so the person can support one instead of repeating it. */
  private async similarTo(
    questionId: string,
    text: string,
    actor: Actor | null,
    exceptId?: string,
  ): Promise<Json[]> {
    const draft = words(text);
    if (draft.size === 0) return [];
    const max = await this.cfg.num("search.similar_proposals_max");
    const pool = await this.prisma.proposal.findMany({
      where: {
        questionId,
        status: "PUBLISHED",
        body: { not: null },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: [{ supportCount: "desc" }, { id: "desc" }],
      take: 200,
      include: this.include,
    });
    const scored = pool
      .map((p) => {
        const w = words(p.body ?? "");
        let shared = 0;
        for (const x of draft) if (w.has(x)) shared++;
        const score = shared / Math.max(1, draft.size + w.size - shared);
        return { p, score };
      })
      .filter((s) => s.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((s) => s.p);
    return this.shape(scored, actor);
  }

  async similar(
    questionId: string,
    text: string | undefined,
    actor: Actor | null,
  ): Promise<Json> {
    await this.question(questionId);
    if (!text || text.trim().length < 5)
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "text", message: "Write at least 5 characters." }],
      });
    return { items: await this.similarTo(questionId, text, actor) };
  }

  async create(
    actor: Actor,
    questionId: string,
    dto: CreateProposalDto,
  ): Promise<Json> {
    const question = await this.question(questionId, true);
    const maxChars = await this.cfg.num("proposal.max_chars");
    let improvedAuthorId: string | null = null;
    const createdRow = await this.prisma.$transaction(async (tx) => {
      const content = await checkContent(
        tx,
        actor,
        dto,
        maxChars,
        dto.kind === "TEXT" ? 5 : 0,
      );
      if (dto.improvesId) {
        const parent = await tx.proposal.findUnique({
          where: { id: dto.improvesId },
        });
        if (
          !parent ||
          parent.questionId !== questionId ||
          parent.status !== "PUBLISHED"
        )
          throw apiError(
            404,
            "NOT_FOUND",
            "We could not find the proposal you are improving.",
          );
        await tx.proposal.update({
          where: { id: parent.id },
          data: { improveCount: { increment: 1 } },
        });
        improvedAuthorId = parent.authorId;
      }
      return tx.proposal.create({
        data: {
          questionId,
          authorId: actor.id,
          improvesId: dto.improvesId ?? null,
          kind: content.kind,
          body: content.body,
          clipId: content.clipId,
        },
      });
    });
    // Read with the relations after the commit: an include inside a transaction runs side by side on its one
    // connection (the pg warning, C-L8).
    const created = await this.prisma.proposal.findUniqueOrThrow({
      where: { id: createdRow.id },
      include: this.include,
    });
    await this.redis.del(`vote:proposals:${questionId}`);
    // After the commit: the author of the proposal that was improved hears about the new one.
    if (
      improvedAuthorId &&
      improvedAuthorId !== actor.id &&
      !(await hiddenUserIdsOf(this.prisma, actor.id)).includes(improvedAuthorId)
    )
      await this.reach.notifySafe({
        userId: improvedAuthorId,
        type: "REPLY",
        title: `@${actor.handle} improved your proposal`,
        body: quoteOf(created.body) ?? "A voice proposal",
        targetType: "question",
        targetId: questionId,
        dedupeKey: `proposal-improved:${created.id}`,
      });
    // V-44 (M-b): B11, after the commit (the proposal's own text is read there).
    if (
      improvedAuthorId &&
      improvedAuthorId !== actor.id &&
      !(await hiddenUserIdsOf(this.prisma, actor.id)).includes(improvedAuthorId)
    )
      void this.sendImproved(
        improvedAuthorId,
        created.improvesId,
        actor.handle,
        created.body,
        questionId,
        created.id,
      );
    const [proposal] = await this.shape([created], actor);
    const similar = created.body
      ? await this.similarTo(questionId, created.body, actor, created.id)
      : [];
    void question;
    return {
      proposal,
      similar,
      charge: {
        costMilli: 0,
        usedFreePost: false,
        usedFreeDaily: false,
        balanceMilli: await this.views.balanceMilli(actor.id),
      },
    };
  }

  /** One stance per person per proposal, changeable. Counters move in the same transaction. */
  async setStance(
    actor: Actor,
    proposalId: string,
    kind: "SUPPORT" | "CHALLENGE" | null,
  ): Promise<Json> {
    let challenged: {
      authorId: string;
      questionId: string;
      body: string | null;
    } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${proposalId}), hashtext(${actor.id}))`;
      const p = await tx.proposal.findUnique({ where: { id: proposalId } });
      if (!p || p.status !== "PUBLISHED")
        throw apiError(404, "NOT_FOUND", "We could not find that proposal.");
      await this.assertWindow(
        await tx.question.findUnique({ where: { id: p.questionId } }),
        kind !== null, // taking a stance back is not a new contribution
      );
      const old = await tx.proposalStance.findUnique({
        where: { proposalId_userId: { proposalId, userId: actor.id } },
      });
      if ((old?.kind ?? null) === kind) return;
      const data: {
        supportCount?: { increment: number };
        challengeCount?: { increment: number };
      } = {};
      const bump = (k: string | null | undefined, by: number): void => {
        if (k === "SUPPORT")
          data.supportCount = {
            increment: (data.supportCount?.increment ?? 0) + by,
          };
        if (k === "CHALLENGE")
          data.challengeCount = {
            increment: (data.challengeCount?.increment ?? 0) + by,
          };
      };
      bump(old?.kind, -1);
      bump(kind, 1);
      if (kind === null)
        await tx.proposalStance.delete({ where: { id: old!.id } });
      else if (old)
        await tx.proposalStance.update({
          where: { id: old.id },
          data: { kind },
        });
      else
        await tx.proposalStance.create({
          data: { proposalId, userId: actor.id, kind },
        });
      await tx.proposal.update({ where: { id: proposalId }, data });
      if (kind === "CHALLENGE")
        challenged = {
          authorId: p.authorId,
          questionId: p.questionId,
          body: p.body,
        };
    });
    // After the commit: challenges on one proposal fold into one alert for its author.
    const c = challenged as {
      authorId: string;
      questionId: string;
      body: string | null;
    } | null;
    if (c && c.authorId !== actor.id)
      await this.reach.notifySafe({
        userId: c.authorId,
        type: "REACTIONS",
        title: "People challenged your proposal",
        body: quoteOf(c.body) ?? "A voice proposal",
        targetType: "question",
        targetId: c.questionId,
        dedupeKey: `proposal-challenged:${proposalId}`,
        fold: true,
      });
    const row = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: this.include,
    });
    const [shaped] = await this.shape([row as ProposalRow], actor);
    return shaped;
  }

  async remove(actor: Actor, proposalId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id: proposalId } });
      if (!p || p.status === "DELETED_BY_AUTHOR" || p.status === "REMOVED")
        throw apiError(404, "NOT_FOUND", "We could not find that proposal.");
      if (p.authorId !== actor.id)
        throw apiError(
          403,
          "FORBIDDEN",
          "You can only delete your own proposal.",
        );
      await tx.proposal.update({
        where: { id: p.id },
        data: { status: "DELETED_BY_AUTHOR" },
      });
      if (p.improvesId)
        await tx.proposal.update({
          where: { id: p.improvesId },
          data: { improveCount: { decrement: 1 } },
        });
    });
  }
}

type ProposalRow = Awaited<
  ReturnType<PrismaService["proposal"]["findFirstOrThrow"]>
> & {
  author: {
    id: string;
    handle: string;
    displayName: string | null;
    state: string | null;
    avatarFileId?: string | null;
    status?: string | null;
    verifiedUntil?: Date | null;
    verificationStatus?: string | null;
  };
  clip: {
    id: string;
    status: string;
    durationMs: number | null;
    maxDurationMs: number;
    peaks: unknown;
    transcript: {
      status: string;
      language: string | null;
      text: string | null;
    } | null;
  } | null;
};
