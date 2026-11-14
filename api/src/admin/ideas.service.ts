import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { invalid, notFound, type Json } from "./support";

const MAX_ITEMS = 300;
const MAX_QUESTIONS = 30;
const MAX_SUGGESTIONS = 10;
const SIMILAR = 0.4;

const words = (t: string): Set<string> =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

function title(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t;
  const cut = t.slice(0, 80);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}`.trim();
}

/**
 * What the moderator groups on (V-FIX-C). The questions that have proposals, the proposals of one question with their
 * groups, and automatic suggestions of proposals that say nearly the same thing. A suggestion is only a suggestion: nothing
 * is grouped until a moderator confirms it with POST /admin/proposal-groups.
 */
@Injectable()
export class IdeasAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async questions(): Promise<Json> {
    const recent = await this.prisma.proposal.groupBy({
      by: ["questionId"],
      where: { status: "PUBLISHED" },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: MAX_QUESTIONS,
    });
    const ids = recent.map((r) => r.questionId);
    const [qs, loose, groups] = await Promise.all([
      this.prisma.question.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          text: true,
          topic: { select: { weekNumber: true } },
        },
      }),
      this.prisma.proposal.groupBy({
        by: ["questionId"],
        where: { questionId: { in: ids }, status: "PUBLISHED", groupId: null },
        _count: { _all: true },
      }),
      this.prisma.proposalGroup.groupBy({
        by: ["questionId"],
        where: { questionId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const q = new Map(qs.map((x) => [x.id, x]));
    const l = new Map(loose.map((x) => [x.questionId, x._count._all]));
    const g = new Map(groups.map((x) => [x.questionId, x._count._all]));
    return {
      items: recent.flatMap((r) => {
        const row = q.get(r.questionId);
        if (!row) return [];
        return [
          {
            questionId: r.questionId,
            text: row.text,
            weekNumber: row.topic?.weekNumber ?? null,
            proposalCount: r._count._all,
            groupCount: g.get(r.questionId) ?? 0,
            ungroupedCount: l.get(r.questionId) ?? 0,
          },
        ];
      }),
    };
  }

  async proposals(questionId: unknown): Promise<Json> {
    if (typeof questionId !== "string" || !/^[0-9a-f-]{36}$/i.test(questionId))
      throw invalid({ path: "questionId", message: "Choose a question." });
    const qid = questionId.toLowerCase();
    const question = await this.prisma.question.findUnique({
      where: { id: qid },
      select: { id: true, text: true },
    });
    if (!question) throw notFound("that question");
    const rows = await this.prisma.proposal.findMany({
      where: { questionId: qid, status: "PUBLISHED" },
      include: {
        group: { select: { id: true, title: true, confirmedAt: true } },
        clip: { select: { transcript: { select: { text: true } } } },
      },
      orderBy: [{ supportCount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: MAX_ITEMS,
    });
    const items = rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      text: (p.body ?? p.clip?.transcript?.text ?? "").slice(0, 400),
      supportCount: p.supportCount,
      challengeCount: p.challengeCount,
      groupId: p.groupId,
      groupTitle: p.group?.title ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
    const groupRows = await this.prisma.proposalGroup.findMany({
      where: { questionId: qid },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    const counts = new Map<string, number>();
    for (const p of items)
      if (p.groupId) counts.set(p.groupId, (counts.get(p.groupId) ?? 0) + 1);

    // Suggestions: ungrouped proposals with words in common, the best supported first.
    const free = items.filter((p) => !p.groupId && p.text.length > 0);
    const sets = new Map(free.map((p) => [p.id, words(p.text)]));
    const used = new Set<string>();
    const suggestions: { title: string; proposalIds: string[] }[] = [];
    for (const seed of free) {
      if (used.has(seed.id) || suggestions.length >= MAX_SUGGESTIONS) continue;
      const mates = free.filter(
        (o) =>
          o.id !== seed.id &&
          !used.has(o.id) &&
          jaccard(
            sets.get(seed.id) ?? new Set(),
            sets.get(o.id) ?? new Set(),
          ) >= SIMILAR,
      );
      if (mates.length === 0) continue;
      const ids = [seed, ...mates].slice(0, 50).map((p) => p.id);
      for (const id of ids) used.add(id);
      suggestions.push({ title: title(seed.text), proposalIds: ids });
    }
    return {
      question,
      items,
      groups: groupRows.map((g) => ({
        id: g.id,
        title: g.title,
        confirmed: g.confirmedAt !== null,
        proposalCount: counts.get(g.id) ?? 0,
      })),
      suggestions,
    };
  }
}
