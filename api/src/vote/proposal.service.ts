import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
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
  ) {}

  private async question(questionId: string) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!q || q.status === "DRAFT")
      throw apiError(404, "NOT_FOUND", "We could not find that question.");
    return q;
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
    return rows.map((p) => ({
      id: p.id,
      questionId: p.questionId,
      author: this.views.author(p.author),
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
    const question = await this.question(questionId);
    const maxChars = await this.cfg.num("text.max_chars");
    const created = await this.prisma.$transaction(async (tx) => {
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
        include: this.include,
      });
    });
    await this.redis.del(`vote:proposals:${questionId}`);
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
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${proposalId}), hashtext(${actor.id}))`;
      const p = await tx.proposal.findUnique({ where: { id: proposalId } });
      if (!p || p.status !== "PUBLISHED")
        throw apiError(404, "NOT_FOUND", "We could not find that proposal.");
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
