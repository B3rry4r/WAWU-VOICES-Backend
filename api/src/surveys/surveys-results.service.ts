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
import { buildReport, type SurveyReport } from "./survey-report";
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
  today = lagosDay(),
): boolean {
  if (s.status !== "APPROVED" && s.status !== "PAUSED") return false;
  const ends = isoDate(s.endsOn);
  if (ends && ends < today) return true;
  return s.responseTarget != null && responses >= s.responseTarget;
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

  private async minGroup(db: Pick<Db, "configEntry">): Promise<number> {
    const row = await db.configEntry.findUnique({
      where: { key: "weekly.min_group_size" },
    });
    return typeof row?.valueJson === "number" ? row.valueJson : 20;
  }

  /** The stored answers of a survey as the report builder wants them: no person on them. */
  private async inputs(db: Db, s: Full) {
    const [responses, evs] = await Promise.all([
      db.surveyResponse.findMany({
        where: { surveyId: s.id },
        select: {
          shareDemo: true,
          state: true,
          ageBand: true,
          answers: {
            select: {
              id: true,
              hidden: true,
              questionId: true,
              optionId: true,
              text: true,
              clipId: true,
            },
          },
        },
      }),
      db.surveyEvent.groupBy({
        by: ["kind"],
        where: { surveyId: s.id },
        _count: { _all: true },
      }),
    ]);
    const clipIds = responses.flatMap((r) =>
      r.answers.flatMap((a) => (a.clipId ? [a.clipId] : [])),
    );
    const clips = clipIds.length
      ? await db.voiceClip.findMany({
          where: { id: { in: clipIds }, status: "READY" },
          select: {
            id: true,
            durationMs: true,
            transcript: { select: { text: true } },
          },
        })
      : [];
    const clip = new Map(clips.map((c) => [c.id, c]));
    const n = (k: string) =>
      evs.find((e) => (e.kind as string) === k)?._count._all ?? 0;
    return {
      minGroup: await this.minGroup(db),
      questions: s.questions.map((q) => ({
        id: q.id,
        position: q.position,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
      })),
      responses: responses.map((r) => ({
        shareDemo: r.shareDemo,
        state: r.state,
        ageBand: r.ageBand,
        answers: r.answers.map((a) => ({
          id: a.id,
          hidden: a.hidden,
          questionId: a.questionId,
          optionId: a.optionId,
          text: a.text,
          voiceText: a.clipId
            ? (clip.get(a.clipId)?.transcript?.text ?? null)
            : null,
          voiceMs: a.clipId ? (clip.get(a.clipId)?.durationMs ?? null) : null,
        })),
      })),
      events: { views: n("VIEW"), starts: n("START"), skips: n("SKIP") },
    };
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
    if (!isOver(s, n)) return false;
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
      answeredSoFar: answered,
      note: over
        ? "The results are fixed. Read the free answers, then release them to the brand."
        : "The survey is not over. Nothing is worked out until it ends.",
    };
  }

  private async items(s: Full): Promise<FreeItem[]> {
    const h = (id: string) => reviewHandle(s.id, id);
    const inp = await this.inputs(this.prisma, s);
    const byQ = new Map(inp.questions.map((q) => [q.id, q]));
    const out: FreeItem[] = [];
    for (const r of inp.responses)
      for (const a of r.answers) {
        const q = byQ.get(a.questionId);
        if (!q || a.id === undefined) continue;
        if (q.kind === "TEXT") {
          const t = scrub(a.text ?? "", MAX_SCRUB_CHARS, REMOVED_MARK);
          if (t) out.push(this.item(h(a.id), q, "TEXT", t, null, !!a.hidden));
        } else if (q.kind === "VOICE" && a.voiceText?.trim()) {
          out.push(
            this.item(
              h(a.id),
              q,
              "VOICE",
              scrub(a.voiceText, MAX_SCRUB_CHARS, REMOVED_MARK),
              Math.round((a.voiceMs ?? 0) / 1000),
              !!a.hidden,
            ),
          );
        }
      }
    // Alphabetical inside a question: never in the order people answered.
    return out.sort(
      (a, b) =>
        (byQ.get(a.questionId)?.position ?? 0) -
          (byQ.get(b.questionId)?.position ?? 0) ||
        a.text.localeCompare(b.text) ||
        a.id.localeCompare(b.id),
    );
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
    const items = await this.items(s);
    const page = items.slice(offset, offset + limit);
    const end = offset + limit;
    const last = end >= items.length;
    if (last && !s.releasedAt)
      await this.prisma.sponsoredSurvey.update({
        where: { id: surveyId },
        data: { reviewedAt: new Date(), reviewedById: actor.id },
      });
    return {
      released: !!s.releasedAt,
      items: page,
      total: items.length,
      hiddenCount: items.filter((i) => i.hidden).length,
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
      const free = new Map(withFree.questions.map((q) => [q.id, q]));
      const report: SurveyReport = {
        ...snap,
        questions: snap.questions.map((q) => ({
          ...q,
          // For a written or voice question `answered` is the number of items in the list the brand gets.
          answered:
            q.kind === "SINGLE_CHOICE"
              ? q.answered
              : (free.get(q.id)?.answered ?? null),
          texts: free.get(q.id)?.texts ?? [],
          voices: free.get(q.id)?.voices ?? [],
        })),
      };
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
