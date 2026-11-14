import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import type { CurrentMeInfo } from "../me/me-context";
import { MailEvents } from "../mail/mail-events";
import {
  conflict,
  dateOnly,
  invalid,
  isoDate,
  lagosDay,
  lockRow,
  notFound,
} from "../admin/trust/common";
import { MAX_SCRUB_CHARS, REMOVED_MARK, scrub } from "../reach/scrub";
import { buildReport, mergeFree, type SurveyReport } from "./survey-report";
import { loadReportInputs, minGroup } from "./survey-inputs";
import { effectiveTarget } from "./survey-rules";
import {
  pct,
  readReviewCursor,
  reviewCursor,
  reviewHandle,
} from "./survey-rules";

const FULL = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

type Full = Prisma.SponsoredSurveyGetPayload<{ include: typeof FULL }>;
type Db = Prisma.TransactionClient;
/** A free answer in the kept sorted list: the item (hidden is filled in per page), its answer id and its question's position. */
type SortedItem = FreeItem & { raw: string; pos: number };

/** Where a survey's results are: still being collected, fixed and waiting for staff, or released to the brand. */
export type ResultsStage = "NOT_LIVE" | "RUNNING" | "REVIEW" | "RELEASED";

/** One free answer or transcript, as staff read it before it goes to a brand. It names no person. */
export interface FreeItem {
  id: string;
  questionId: string;
  prompt: string;
  kind: "TEXT" | "VOICE";
  text: string;
  seconds: number | null;
  hidden: boolean;
}

/** A survey is over when it is approved or paused and its end date has passed or its response target is reached. */
export function isOver(
  s: {
    status: string;
    endsOn: Date | null;
    responseTarget: number | null;
  },
  responses: number,
  floor: number,
  today = lagosDay(),
): boolean {
  if (s.status !== "APPROVED" && s.status !== "PAUSED") return false;
  const ends = isoDate(s.endsOn);
  if (ends && ends < today) return true;
  const target = effectiveTarget(s.responseTarget, floor);
  return target != null && responses >= target;
}

/**
 * Results of a sponsored survey (V-SURVEYS round 2). Three rules keep a brand, and an admin acting for it, from learning
 * who answered or what a person answered:
 * 1. Nothing is worked out while the survey runs. When it is over, the counts are computed once and stored (a snapshot)
 *    and every later read returns what was stored; no answer is accepted after that.
 * 2. Free answers and transcripts reach the brand only after staff read them (hide any, then release).
 * 3. Every read of a report or a free-answer list, and the release, is audited (who, when, which survey; never content).
 */
@Injectable()
export class SurveyResultsService {
  /** Surveys whose F04 is being sent from this process right now: a second call does not send again. */
  private readonly mailing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mails: MailEvents,
  ) {}

  /** The stored answers of a survey as the report builder wants them: no person on them. */
  private inputs(db: Db, s: Full) {
    return loadReportInputs(db, s);
  }

  /**
   * Fixes the results of a survey that is over, once, under the survey row's lock. Answers take the same lock, so none
   * can slip in after. Safe to call again: it returns at once when the snapshot exists. False while the survey runs.
   */
  async snapshotIn(tx: Db, surveyId: string): Promise<boolean> {
    await lockRow(tx, "SponsoredSurvey", "id", surveyId);
    const s = await tx.sponsoredSurvey.findUnique({
      where: { id: surveyId },
      include: FULL,
    });
    if (!s) throw notFound("We could not find that survey.");
    if (s.snapshotAt) return true;
    const n = await tx.surveyResponse.count({ where: { surveyId } });
    if (!isOver(s, n, await minGroup(tx))) return false;
    const report = buildReport(await this.inputs(tx, s), { free: false });
    await tx.sponsoredSurvey.update({
      where: { id: surveyId },
      data: {
        snapshotAt: new Date(),
        reportSnapshot: report as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  async ensureSnapshot(surveyId: string): Promise<boolean> {
    return this.prisma.$transaction((tx) => this.snapshotIn(tx, surveyId), {
      timeout: 20_000,
    });
  }

  private async audit(
    actor: CurrentMeInfo,
    action: string,
    surveyId: string,
    after?: Prisma.InputJsonValue,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action,
        targetType: "survey",
        targetId: surveyId,
        ...(after ? { after } : {}),
      },
    });
  }

  private async load(surveyId: string) {
    const s = await this.prisma.sponsoredSurvey.findUnique({
      where: { id: surveyId },
      include: FULL,
    });
    if (!s) throw notFound("We could not find that survey.");
    return s;
  }

  private head(s: Full) {
    return {
      id: s.id,
      brandName: s.brandName,
      title: s.title,
      status: s.status,
      startsOn: isoDate(s.startsOn),
      endsOn: isoDate(s.endsOn),
      responseTarget: s.responseTarget,
    };
  }

  /**
   * GET /admin/surveys/:id/report. Running: only how many people have answered so far, `ready: false`. Over but not
   * released: the same, `ready: true, released: false` (staff still have to read the free answers). Released: the stored
   * report, `released: true`. Never recomputed once stored.
   */
  async report(actor: CurrentMeInfo, surveyId: string) {
    await this.load(surveyId);
    await this.audit(actor, "survey.report.read", surveyId);
    const over = await this.ensureSnapshot(surveyId);
    const s = await this.load(surveyId);
    const answered = await this.prisma.surveyResponse.count({
      where: { surveyId },
    });
    if (s.releasedAt && s.releasedReport) {
      return {
        survey: this.head(s),
        stage: "RELEASED" as ResultsStage,
        ready: true,
        released: true,
        releasedAt: s.releasedAt.toISOString(),
        ...(s.releasedReport as unknown as SurveyReport),
      };
    }
    const stage: ResultsStage = over
      ? "REVIEW"
      : s.status === "APPROVED" || s.status === "PAUSED"
        ? "RUNNING"
        : "NOT_LIVE";
    return {
      survey: this.head(s),
      stage,
      ready: over,
      released: false,
      // OWNER RULING, 14 Nov 2026: staff may see running totals at any size (see the list in surveys-admin.service.ts).
      // Totals only: never a breakdown under the floor, and never anything of this kind to a brand.
      answeredSoFar: answered,
      note: over
        ? "The results are fixed. Read the free answers, then release them to the brand."
        : "The survey is not over. Nothing is worked out until it ends.",
    };
  }

  /** The sorted free answers of surveys read lately, kept by survey id; each is valid only while its fingerprint holds. */
  private readonly sortedCache = new Map<
    string,
    { fp: string; list: SortedItem[]; ids: Set<string> }
  >();

  /**
   * What the free answers look like in the database, in one cheap query: how many, and how much transcript text is ready.
   * The list below is rebuilt when it changes (a purge removes answers, a transcript lands) and not otherwise.
   */
  private async fingerprint(s: Full): Promise<string> {
    const qids = s.questions
      .filter((q) => q.kind === "TEXT" || q.kind === "VOICE")
      .map((q) => q.id);
    if (!qids.length) return "0:0:0";
    const rows = await this.prisma.$queryRaw<
      { n: number; ready: number; len: number }[]
    >`SELECT count(a."id")::int AS n,
             count(t."id") FILTER (WHERE c."status" = 'READY' AND t."text" IS NOT NULL)::int AS ready,
             coalesce(sum(length(t."text")) FILTER (WHERE c."status" = 'READY'), 0)::int AS len
        FROM "SurveyAnswer" a
        LEFT JOIN "VoiceClip" c ON c."id" = a."clipId"
        LEFT JOIN "Transcript" t ON t."clipId" = c."id"
       WHERE a."questionId" = ANY(${qids}::text[])`;
    const r = rows[0];
    return `${r.n}:${r.ready}:${r.len}`;
  }

  /**
   * Every free answer and transcript of a survey, scrubbed and in review order (question, then alphabetical, then handle;
   * never the order people answered). Built once per survey from only the free answers (not the choices), then served
   * from memory for each page; the hidden flags are never kept here and are read fresh for every page.
   */
  private async sorted(
    s: Full,
  ): Promise<{ list: SortedItem[]; ids: Set<string> }> {
    const fp = await this.fingerprint(s);
    const hit = this.sortedCache.get(s.id);
    if (hit && hit.fp === fp) {
      this.sortedCache.delete(s.id);
      this.sortedCache.set(s.id, hit);
      return hit;
    }
    const byQ = new Map(
      s.questions
        .filter((q) => q.kind === "TEXT" || q.kind === "VOICE")
        .map((q) => [q.id, q]),
    );
    const answers = await this.prisma.surveyAnswer.findMany({
      where: {
        response: { surveyId: s.id },
        question: { kind: { in: ["TEXT", "VOICE"] } },
      },
      select: { id: true, questionId: true, text: true, clipId: true },
    });
    const clipIds = answers.flatMap((a) => (a.clipId ? [a.clipId] : []));
    const clip = new Map<
      string,
      { durationMs: number | null; text: string | null }
    >();
    // Chunked: one query may not carry more than about 30,000 values.
    for (let i = 0; i < clipIds.length; i += 5000) {
      const rows = await this.prisma.voiceClip.findMany({
        where: { id: { in: clipIds.slice(i, i + 5000) }, status: "READY" },
        select: {
          id: true,
          durationMs: true,
          transcript: { select: { text: true } },
        },
      });
      for (const c of rows)
        clip.set(c.id, {
          durationMs: c.durationMs,
          text: c.transcript?.text ?? null,
        });
    }
    const out: SortedItem[] = [];
    for (const a of answers) {
      const q = byQ.get(a.questionId);
      if (!q) continue;
      if (q.kind === "TEXT") {
        const t = scrub(a.text ?? "", MAX_SCRUB_CHARS, REMOVED_MARK);
        if (t)
          out.push({
            ...this.item(reviewHandle(s.id, a.id), q, "TEXT", t, null, false),
            raw: a.id,
            pos: q.position,
          });
      } else if (q.kind === "VOICE") {
        const c = a.clipId ? clip.get(a.clipId) : undefined;
        if (c?.text?.trim())
          out.push({
            ...this.item(
              reviewHandle(s.id, a.id),
              q,
              "VOICE",
              scrub(c.text, MAX_SCRUB_CHARS, REMOVED_MARK),
              Math.round((c.durationMs ?? 0) / 1000),
              false,
            ),
            raw: a.id,
            pos: q.position,
          });
      }
    }
    out.sort(
      (a, b) =>
        a.pos - b.pos ||
        a.text.localeCompare(b.text) ||
        a.id.localeCompare(b.id),
    );
    const entry = { fp, list: out, ids: new Set(out.map((i) => i.raw)) };
    this.sortedCache.set(s.id, entry);
    // Only the few surveys read most lately are kept.
    while (this.sortedCache.size > 4)
      this.sortedCache.delete(this.sortedCache.keys().next().value as string);
    return entry;
  }

  private item(
    id: string,
    q: { id: string; prompt: string },
    kind: "TEXT" | "VOICE",
    text: string,
    seconds: number | null,
    hidden: boolean,
  ): FreeItem {
    return {
      id,
      questionId: q.id,
      prompt: q.prompt,
      kind,
      text,
      seconds,
      hidden,
    };
  }

  /**
   * GET /admin/surveys/:id/free-answers: every free answer and transcript, scrubbed, for staff to read, a page at a time
   * (`limit`, at most 50; `cursor` from the previous page's `nextCursor`, signed so pages can only be walked in order).
   * When the last page is served, `reviewedAt` and `reviewedById` are stored: release needs them.
   */
  async freeAnswers(
    actor: CurrentMeInfo,
    surveyId: string,
    q: { cursor?: string; limit?: number } = {},
  ) {
    await this.load(surveyId);
    await this.audit(actor, "survey.free.read", surveyId);
    if (!(await this.ensureSnapshot(surveyId)))
      throw conflict(
        "The survey is still running. Its free answers can be read once it is over.",
      );
    let offset = 0;
    if (q.cursor) {
      const o = readReviewCursor(surveyId, actor.id, q.cursor);
      if (o == null)
        throw invalid("cursor", "That page link is not valid. Start again.");
      offset = o;
    }
    const limit = Math.min(50, Math.max(1, q.limit ?? 50));
    const s = await this.load(surveyId);
    const { list, ids } = await this.sorted(s);
    // The hidden flags are staff's and change while they read: always read fresh, never from the kept list.
    const hiddenIds = new Set(
      (
        await this.prisma.surveyAnswer.findMany({
          where: {
            hidden: true,
            questionId: {
              in: s.questions
                .filter((q) => q.kind === "TEXT" || q.kind === "VOICE")
                .map((q) => q.id),
            },
          },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    const page = list.slice(offset, offset + limit).map((x) => ({
      id: x.id,
      questionId: x.questionId,
      prompt: x.prompt,
      kind: x.kind,
      text: x.text,
      seconds: x.seconds,
      hidden: hiddenIds.has(x.raw),
    }));
    const end = offset + limit;
    const last = end >= list.length;
    let hiddenCount = 0;
    for (const id of hiddenIds) if (ids.has(id)) hiddenCount++;
    if (last && !s.releasedAt)
      await this.prisma.sponsoredSurvey.update({
        where: { id: surveyId },
        data: { reviewedAt: new Date(), reviewedById: actor.id },
      });
    return {
      released: !!s.releasedAt,
      items: page,
      total: list.length,
      hiddenCount,
      nextCursor: last ? null : reviewCursor(surveyId, actor.id, end),
    };
  }

  /** PATCH /admin/surveys/:id/free-answers/:handle: hide (or show again) one free answer before release. `handle` is the review handle. */
  async setHidden(
    actor: CurrentMeInfo,
    surveyId: string,
    handle: string,
    hidden: boolean,
  ) {
    if (!/^[0-9a-f]{32}$/.test(handle))
      throw notFound("We could not find that answer.");
    await this.load(surveyId);
    await this.ensureSnapshot(surveyId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const s = await tx.sponsoredSurvey.findUnique({
        where: { id: surveyId },
        select: { snapshotAt: true, releasedAt: true },
      });
      if (!s?.snapshotAt)
        throw conflict(
          "The survey is still running. Its free answers can be read once it is over.",
        );
      if (s.releasedAt)
        throw conflict("The results are already released and cannot change.");
      const rows = await tx.surveyAnswer.findMany({
        where: {
          response: { surveyId },
          question: { kind: { in: ["TEXT", "VOICE"] } },
        },
        select: { id: true },
      });
      const a = rows.find((r) => reviewHandle(surveyId, r.id) === handle);
      if (!a) throw notFound("We could not find that answer.");
      await tx.surveyAnswer.update({
        where: { id: a.id },
        data: hidden
          ? { hidden: true, hiddenById: actor.id, hiddenAt: new Date() }
          : { hidden: false, hiddenById: null, hiddenAt: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: hidden ? "survey.free.hide" : "survey.free.show",
          targetType: "survey",
          targetId: surveyId,
          after: { handle },
        },
      });
    });
    return { id: handle, hidden };
  }

  /**
   * POST /admin/surveys/:id/release: staff have read the free answers. The brand's report is built once from the
   * snapshot and the free answers left in, and stored. Only now can the brand get the results (and F04).
   */
  async release(actor: CurrentMeInfo, surveyId: string) {
    await this.load(surveyId);
    await this.ensureSnapshot(surveyId);
    const done = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const s = await tx.sponsoredSurvey.findUnique({
        where: { id: surveyId },
        include: FULL,
      });
      if (!s) throw notFound("We could not find that survey.");
      if (!s.snapshotAt || !s.reportSnapshot)
        throw conflict(
          "The survey is still running. Results can be released once it is over.",
        );
      if (s.releasedAt) throw conflict("These results were already released.");
      // Written and voice answers reach the brand only after a person has been through the whole review list.
      if (!s.reviewedAt) {
        const written = await tx.surveyAnswer.count({
          where: {
            response: { surveyId },
            question: { kind: { in: ["TEXT", "VOICE"] } },
          },
        });
        if (written > 0)
          throw conflict(
            "Read the written answers before releasing the results.",
          );
      }
      const snap = s.reportSnapshot as unknown as SurveyReport;
      const withFree = buildReport(await this.inputs(tx, s), { free: true });
      const report = mergeFree(snap, withFree);
      const hiddenCount = await tx.surveyAnswer.count({
        where: { response: { surveyId }, hidden: true },
      });
      const at = new Date();
      await tx.sponsoredSurvey.update({
        where: { id: surveyId },
        data: {
          releasedAt: at,
          releasedById: actor.id,
          releasedHiddenCount: hiddenCount,
          releasedReport: report as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "survey.release",
          targetType: "survey",
          targetId: surveyId,
          after: { hiddenCount },
        },
      });
      return { releasedAt: at, hiddenCount };
    });
    const mailed = await this.mailResults(surveyId);
    return {
      released: true,
      releasedAt: done.releasedAt.toISOString(),
      hiddenCount: done.hiddenCount,
      mailed,
    };
  }

  /**
   * F04, only for released results. Sends first and records `resultsMailedAt` only when the mail went, so a failed one
   * is tried again by the sweep and never lost; the send log (once per survey) keeps it from going twice.
   */
  async mailResults(surveyId: string): Promise<boolean> {
    if (this.mailing.has(surveyId)) return false;
    this.mailing.add(surveyId);
    try {
      const s = await this.load(surveyId);
      if (!s.releasedAt || !s.releasedReport) return false;
      if (s.resultsMailedAt) return true;
      const rep = s.releasedReport as unknown as SurveyReport;
      const first = rep.questions.find((q) => q.options.length > 0);
      const top = first?.options
        .filter((o) => !o.hidden)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
      const below = rep.belowMinimum;
      const responses = rep.totals.responses ?? 0;
      const days = s.startsOn
        ? Math.max(
            1,
            Math.round(
              ((s.endsOn ?? s.snapshotAt ?? new Date()).getTime() -
                s.startsOn.getTime()) /
                86_400_000,
            ) + 1,
          )
        : 1;
      const outcome = await this.mails.surveyResultsReady(s.id, {
        responses: below ? `Fewer than ${rep.minGroupSize}` : responses,
        completionRate:
          below || rep.totals.completionRate == null
            ? `Fewer than ${rep.minGroupSize} answers`
            : `${rep.totals.completionRate}%`,
        topAnswer:
          below || !top
            ? "There were too few answers to show a result."
            : `${first?.prompt ?? ""} ${top.label}`.trim(),
        topAnswerPct:
          below || !top
            ? "None"
            : `${top.share ?? pct(top.count ?? 0, responses)}%`,
        daysLive: days,
      });
      // "limited": this event was already logged as sent. Anything else (relay off, capped, budget used, failed) is
      // tried again by the next sweep.
      if (outcome === "sent" || outcome === "limited") {
        await this.prisma.sponsoredSurvey.updateMany({
          where: { id: surveyId, resultsMailedAt: null },
          data: { resultsMailedAt: new Date() },
        });
        return true;
      }
      return false;
    } finally {
      this.mailing.delete(surveyId);
    }
  }

  /**
   * Every ten minutes: fixes the results of surveys that are over (their end date passed), and tries again the F04 of
   * released results whose mail has not gone. Returns how many F04 mails were sent now.
   */
  async sweep(now = new Date()): Promise<number> {
    const today = lagosDay(now);
    const due = await this.prisma.sponsoredSurvey.findMany({
      where: {
        snapshotAt: null,
        status: { in: ["APPROVED", "PAUSED"] },
        OR: [
          { endsOn: { lt: dateOnly(today) } },
          { responseTarget: { not: null } },
        ],
      },
      select: { id: true },
      take: 50,
    });
    for (const s of due) await this.ensureSnapshot(s.id);
    const waiting = await this.prisma.sponsoredSurvey.findMany({
      where: { releasedAt: { not: null }, resultsMailedAt: null },
      select: { id: true },
      take: 50,
    });
    let sent = 0;
    for (const s of waiting) if (await this.mailResults(s.id)) sent++;
    return sent;
  }
}
