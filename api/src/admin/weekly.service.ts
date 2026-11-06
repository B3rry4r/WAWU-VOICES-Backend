import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import type { WeeklyReportStatus } from "../generated/prisma/enums";
import { PrismaService } from "../common/prisma/prisma.service";
import { cut, decodeCursor, pageLimit } from "../me/paging";
import type { EditWeeklyDto } from "./dto";
import {
  conflict,
  invalid,
  notFound,
  writeAudit,
  type FieldIssue,
  type Json,
} from "./support";
import { AdminViews } from "./views";

const STATUSES = ["DRAFT", "HELD", "APPROVED", "PUBLISHED"];
const ABSOLUTES =
  /\b(everyone|everybody|nobody|no one|all nigerians|all voices|every voice)\b/i;
const HANDLE = /(^|[^a-z0-9._])@[a-z0-9._]{3,}/i;
/** Phone numbers in any layout: drop spaces, dashes, dots and brackets, then look for 10 digits in a row. */
const hasPhone = (t: string): boolean =>
  /\d{10,}/.test(t.replace(/[\s\-.()[\]]/g, ""));

type Db = Prisma.TransactionClient | PrismaService;

type Report = Prisma.WeeklyReportGetPayload<{
  include: { quotes: true; topic: true };
}>;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The weekly report: AI draft, human edits, checks, approval. Publishing itself is the reach module's job. */
@Injectable()
export class WeeklyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: AdminViews,
  ) {}

  // ---------------------------------------------------------------- the checks the editor sees

  private textsOf(r: Report): string[] {
    const themes = asArray(r.themes).flatMap((t) => {
      const o = t as { label?: unknown; complaints?: unknown };
      return [
        typeof o.label === "string" ? o.label : "",
        ...asArray(o.complaints).filter(
          (c): c is string => typeof c === "string",
        ),
      ];
    });
    return [
      r.headline ?? "",
      r.mood ?? "",
      r.summary ?? "",
      r.cardTitle ?? "",
      r.editorNote ?? "",
      ...r.quotes.map((q) => q.excerpt),
      ...r.quotes.map((q) => q.placeLabel),
      ...themes,
    ];
  }

  /** Names, handles or phone numbers: an @handle, a phone, or the handle of anyone quoted. */
  private async leaks(r: Report, db: Db = this.prisma): Promise<string[]> {
    const texts = this.textsOf(r);
    const found: string[] = [];
    if (texts.some((t) => HANDLE.test(t))) found.push("an @handle");
    if (texts.some(hasPhone)) found.push("a phone number");
    const answers = r.quotes.length
      ? await db.answer.findMany({
          where: { id: { in: r.quotes.map((q) => q.answerId) } },
          select: { author: { select: { handle: true, displayName: true } } },
        })
      : [];
    const hay = texts.join("\n").toLowerCase();
    for (const a of answers) {
      const h = a.author.handle.toLowerCase();
      if (h.length >= 3 && hay.includes(h))
        found.push("a quoted person's handle");
      const dn = a.author.displayName?.trim().toLowerCase();
      if (dn && dn.length >= 3 && hay.includes(dn))
        found.push("a quoted person's name");
    }
    // Anyone who spoke this week: a word in the text that is the handle of a person with an answer or reply on this week's questions.
    const words = new Set<string>();
    for (const w of hay.match(/[a-z0-9._]{3,20}/g) ?? []) {
      words.add(w);
      words.add(w.replace(/^[._]+|[._]+$/g, ""));
    }
    const candidates = [...words].filter((w) => w.length >= 3).slice(0, 2000);
    if (candidates.length) {
      const week = await db.user.findFirst({
        where: {
          handle: { in: candidates },
          OR: [
            { answers: { some: { question: { topicId: r.topicId } } } },
            {
              replies: {
                some: { answer: { question: { topicId: r.topicId } } },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (week) found.push("a handle of someone who spoke this week");
    }
    return found;
  }

  private async minGroup(): Promise<number> {
    return this.views.numConfig("weekly.min_group_size", 20);
  }

  private async checks(r: Report): Promise<{ text: string; ok: boolean }[]> {
    const out: { text: string; ok: boolean }[] = [];
    const leaks = await this.leaks(r);
    out.push({
      text: "No names, handles or phone numbers",
      ok: leaks.length === 0,
    });
    const min = await this.minGroup();
    const small = asArray(r.themes).filter((t) => {
      const c = (t as { count?: unknown }).count;
      return typeof c === "number" && c < min;
    });
    out.push({
      text: "Groups too small to stay anonymous left out",
      ok: small.length === 0,
    });
    out.push({
      text: "Leading view and the main opposing view both shown",
      ok: asArray(r.themes).length >= 2,
    });
    const answers = r.quotes.length
      ? await this.prisma.answer.findMany({
          where: {
            id: { in: r.quotes.map((q) => q.answerId) },
            status: "PUBLISHED",
            deletedAt: null,
          },
          select: { id: true },
        })
      : [];
    const live = new Set(answers.map((a) => a.id));
    const consented = r.quotes.filter(
      (q) => q.consentAt && live.has(q.answerId),
    ).length;
    out.push({
      text: r.quotes.length
        ? `Quotes: ${consented} of ${r.quotes.length} with the speaker’s consent`
        : "Quotes: none yet, a quote needs the speaker’s consent",
      ok: consented === r.quotes.length,
    });
    out.push({
      text: `Languages read: ${r.languagesRead.length ? r.languagesRead.join(", ") : "none yet"}`,
      ok: r.languagesRead.length > 0,
    });
    const hit = this.textsOf(r)
      .map((t) => ABSOLUTES.exec(t)?.[0])
      .find((w) => !!w);
    out.push({
      text: hit
        ? `"${hit[0].toUpperCase()}${hit.slice(1)}" in the summary: say "most voices" instead`
        : "No claim that everyone thinks the same",
      ok: !hit,
    });
    return out;
  }

  // ---------------------------------------------------------------- views

  private async view(r: Report): Promise<Json> {
    const poll = await this.prisma.poll.findFirst({
      where: { topicId: r.topicId, kind: "WEEKLY" },
      select: { endsAt: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    const closed =
      poll && (poll.status === "CLOSED" || poll.endsAt <= new Date())
        ? poll.endsAt
        : null;
    return {
      emotions: asArray(r.emotions),
      cardTitle: r.cardTitle,
      editorNote: r.editorNote,
      id: r.id,
      topicId: r.topicId,
      weekNumber: r.topic.weekNumber,
      status: r.status,
      draftedAt: r.draftedAt.toISOString(),
      pollClosedAt: closed?.toISOString() ?? null,
      publishAt: r.publishAt?.toISOString() ?? null,
      headline: r.headline,
      mood: r.mood,
      summary: r.summary,
      themes: r.themes ?? [],
      sentiment: r.sentiment ?? {},
      pollSummary: r.pollSummary ?? {},
      quotes: [...r.quotes]
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((q) => ({
          answerId: q.answerId,
          excerpt: q.excerpt,
          placeLabel: q.placeLabel,
          consent: q.consentAt !== null,
        })),
      basedOnVoices: r.basedOnVoices ?? 0,
      basedOnVotes: r.basedOnVotes ?? 0,
      languagesRead: r.languagesRead,
      checks: await this.checks(r),
    };
  }

  private load(id: string): Promise<Report | null> {
    return this.prisma.weeklyReport.findUnique({
      where: { id },
      include: { quotes: true, topic: true },
    });
  }

  async list(
    cursor: string | undefined,
    limitRaw: unknown,
    status: string | undefined,
  ): Promise<Json> {
    const limit = pageLimit(limitRaw);
    if (status !== undefined && status !== "" && !STATUSES.includes(status))
      throw invalid({
        path: "status",
        message: "Use DRAFT, HELD, APPROVED or PUBLISHED.",
      });
    const c = decodeCursor(cursor);
    const rows = await this.prisma.weeklyReport.findMany({
      where: {
        ...(status ? { status: status as WeeklyReportStatus } : {}),
        ...(c
          ? {
              OR: [
                { draftedAt: { lt: c.t } },
                { draftedAt: c.t, id: { lt: c.id } },
              ],
            }
          : {}),
      },
      include: { quotes: true, topic: true },
      orderBy: [{ draftedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = cut(rows, limit, (r) => r.draftedAt);
    return {
      items: await Promise.all(page.items.map((r) => this.view(r))),
      nextCursor: page.nextCursor,
    };
  }

  async get(id: string): Promise<Json> {
    const r = await this.load(id);
    if (!r) throw notFound("that report");
    return this.view(r);
  }

  // ---------------------------------------------------------------- edit, approve, hold

  private snap(r: Report): Json {
    return {
      status: r.status,
      headline: r.headline,
      mood: r.mood,
      summary: r.summary,
      cardTitle: r.cardTitle,
      editorNote: r.editorNote,
      themes: r.themes,
      emotions: r.emotions,
      publishAt: r.publishAt,
      heldNote: r.heldNote,
      quotes: r.quotes.map((q) => ({
        answerId: q.answerId,
        excerpt: q.excerpt,
      })),
    };
  }

  private checkThemes(v: unknown): FieldIssue[] {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 12)
      return [{ path: "themes", message: "Use a list of up to 12 themes." }];
    for (const t of v as Record<string, unknown>[]) {
      const ok =
        t &&
        typeof t === "object" &&
        typeof t.label === "string" &&
        t.label.length > 0 &&
        t.label.length <= 120 &&
        typeof t.count === "number" &&
        Number.isInteger(t.count) &&
        t.count >= 0 &&
        (t.complaints === undefined ||
          (Array.isArray(t.complaints) &&
            t.complaints.length <= 20 &&
            t.complaints.every(
              (c) => typeof c === "string" && c.length <= 300,
            )));
      if (!ok)
        return [
          {
            path: "themes",
            message:
              "Each theme needs a label, a count and optional complaints.",
          },
        ];
    }
    return [];
  }

  async edit(actorId: string, id: string, dto: EditWeeklyDto): Promise<Json> {
    const issues = this.checkThemes(dto.themes);
    for (const [i, q] of (dto.quotes ?? []).entries())
      if (!q.consent)
        issues.push({
          path: `quotes.${i}.consent`,
          message: "A quote cannot be used without the speaker's consent.",
        });
    if (
      new Set((dto.quotes ?? []).map((q) => q.answerId)).size !==
      (dto.quotes ?? []).length
    )
      issues.push({ path: "quotes", message: "A voice can be quoted once." });
    if (issues.length) throw invalid(...issues);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WeeklyReport" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.weeklyReport.findUnique({
        where: { id },
        include: { quotes: true, topic: true },
      });
      if (!cur) throw notFound("that report");
      if (cur.status === "APPROVED" || cur.status === "PUBLISHED")
        throw conflict(
          cur.status === "PUBLISHED"
            ? "A published report cannot be edited."
            : "Hold the report before editing it.",
        );
      if (dto.quotes) {
        const answers = await tx.answer.findMany({
          where: {
            id: { in: dto.quotes.map((q) => q.answerId) },
            status: "PUBLISHED",
            deletedAt: null,
          },
          select: { id: true },
        });
        const have = new Set(answers.map((a) => a.id));
        const gone = dto.quotes.findIndex((q) => !have.has(q.answerId));
        if (gone >= 0)
          throw invalid({
            path: `quotes.${gone}.answerId`,
            message: "That voice is not published.",
          });
        const old = new Map(cur.quotes.map((q) => [q.answerId, q]));
        await tx.weeklyQuote.deleteMany({ where: { reportId: id } });
        for (const q of dto.quotes)
          await tx.weeklyQuote.create({
            data: {
              reportId: id,
              answerId: q.answerId,
              excerpt: q.excerpt,
              placeLabel: q.placeLabel,
              consentAt: old.get(q.answerId)?.consentAt ?? new Date(),
            },
          });
      }
      await tx.weeklyReport.update({
        where: { id },
        data: {
          ...(dto.headline !== undefined ? { headline: dto.headline } : {}),
          ...(dto.mood !== undefined ? { mood: dto.mood } : {}),
          ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
          ...(dto.cardTitle !== undefined ? { cardTitle: dto.cardTitle } : {}),
          ...(dto.editorNote !== undefined
            ? { editorNote: dto.editorNote }
            : {}),
          ...(dto.themes !== undefined
            ? { themes: dto.themes as Prisma.InputJsonValue }
            : {}),
          ...(dto.emotions !== undefined
            ? {
                emotions: dto.emotions.map((e) => ({
                  name: e.name,
                  share: e.share,
                  change: e.change,
                })),
              }
            : {}),
        },
      });
      const next = await tx.weeklyReport.findUniqueOrThrow({
        where: { id },
        include: { quotes: true, topic: true },
      });
      await writeAudit(tx, {
        actorId,
        action: "weekly.edit",
        targetType: "WeeklyReport",
        targetId: id,
        reason: dto.editorNote ?? null,
        before: this.snap(cur),
        after: this.snap(next),
      });
    });
    return this.get(id);
  }

  async approve(
    actorId: string,
    id: string,
    publishAtRaw: string,
  ): Promise<Json> {
    const publishAt = new Date(publishAtRaw);
    if (publishAt.getTime() < Date.now() - 60_000)
      throw invalid({
        path: "publishAt",
        message: "The publish time cannot be in the past.",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WeeklyReport" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.weeklyReport.findUnique({
        where: { id },
        include: { quotes: true, topic: true },
      });
      if (!cur) throw notFound("that report");
      if (cur.status === "APPROVED")
        throw conflict("That report is already approved.");
      if (cur.status === "PUBLISHED")
        throw conflict("That report is already published.");
      // Nothing is published unreviewed, and a quote without the speaker's consent blocks approval.
      const answers = cur.quotes.length
        ? await tx.answer.findMany({
            where: {
              id: { in: cur.quotes.map((q) => q.answerId) },
              status: "PUBLISHED",
              deletedAt: null,
            },
            select: { id: true },
          })
        : [];
      const live = new Set(answers.map((a) => a.id));
      const blocked = cur.quotes.filter(
        (q) => !q.consentAt || !live.has(q.answerId),
      );
      if (blocked.length)
        throw invalid({
          path: "quotes",
          message:
            "A quote has no consent or its post is gone. Fix it before approving.",
        });
      const leaks = await this.leaks(cur, tx);
      if (leaks.length)
        throw invalid({
          path: "summary",
          message: `The report still shows ${leaks[0]}. Take it out before approving.`,
        });
      if (!cur.headline || !cur.summary)
        throw invalid({
          path: "summary",
          message: "The report needs a headline and a summary.",
        });
      await tx.weeklyReport.update({
        where: { id },
        data: {
          status: "APPROVED",
          publishAt,
          approvedById: actorId,
          approvedAt: new Date(),
          humanReviewed: true,
          heldNote: null,
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "weekly.approve",
        targetType: "WeeklyReport",
        targetId: id,
        reason: cur.editorNote ?? null,
        before: { status: cur.status, publishAt: cur.publishAt },
        after: { status: "APPROVED", publishAt },
      });
    });
    return this.get(id);
  }

  async hold(actorId: string, id: string, reason: string): Promise<Json> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WeeklyReport" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.weeklyReport.findUnique({ where: { id } });
      if (!cur) throw notFound("that report");
      if (cur.status === "PUBLISHED")
        throw conflict("A published report cannot be held.");
      if (cur.status === "HELD") throw conflict("That report is already held.");
      await tx.weeklyReport.update({
        where: { id },
        data: {
          status: "HELD",
          heldNote: reason,
          approvedById: null,
          approvedAt: null,
          humanReviewed: false,
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "weekly.hold",
        targetType: "WeeklyReport",
        targetId: id,
        reason,
        before: { status: cur.status, publishAt: cur.publishAt },
        after: { status: "HELD" },
      });
    });
    return this.get(id);
  }
}
