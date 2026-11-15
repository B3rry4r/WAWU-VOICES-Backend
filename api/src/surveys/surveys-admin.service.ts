import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  AdStatus,
  Prisma,
  SponsoredSurvey,
} from "../generated/prisma/client";
import type { CurrentMeInfo } from "../me/me-context";
import { MailEvents } from "../mail/mail-events";
import { hasBannedWording, KEPT_AWAY } from "../admin/trust/ads.service";
import {
  conflict,
  dateOnly,
  invalid,
  isoDate,
  isRealDate,
  lagosDay,
  lockRow,
  notFound,
} from "../admin/trust/common";
import { decodeCursor, encodeCursor, pageLimit } from "../results/cursor";
import type {
  SurveyDecisionDto,
  SurveyListQuery,
  SurveyQuestionDto,
  UpdateSurveyDto,
  UpsertSurveyDto,
} from "./dto";
import { SurveyResultsService } from "./surveys-results.service";
import {
  MAX_QUESTIONS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  effectiveTarget,
} from "./survey-rules";
import { minGroup } from "./survey-inputs";

type Full = Prisma.SponsoredSurveyGetPayload<{
  include: { questions: { include: { options: true } } };
}>;

const FULL = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

/** Everything the survey says, in one string, for the wording screen. */
function wording(s: {
  brandName: string;
  title: string;
  questions: { prompt: string; options: { label: string }[] }[];
}): string {
  return [
    s.brandName,
    s.title,
    ...s.questions.flatMap((q) => [q.prompt, ...q.options.map((o) => o.label)]),
  ].join(" ");
}

/** True while a survey can be shown: approved, inside its dates, and under its response target. */
export function isLive(
  s: Pick<
    SponsoredSurvey,
    "status" | "startsOn" | "endsOn" | "responseTarget"
  > & { snapshotAt?: Date | null },
  responses: number,
  floor: number,
  today = lagosDay(),
): boolean {
  if (s.status !== "APPROVED") return false;
  // Once the results are fixed no answer, view or skip is accepted.
  if (s.snapshotAt) return false;
  const starts = isoDate(s.startsOn);
  const ends = isoDate(s.endsOn);
  if (starts && starts > today) return false;
  if (ends && ends < today) return false;
  const target = effectiveTarget(s.responseTarget, floor);
  if (target != null && responses >= target) return false;
  return true;
}

/** The five totals stored at release, or null when the survey was not released (or holds nothing usable). */
export function releasedShown(raw: unknown): {
  views: number;
  starts: number;
  completes: number;
  skips: number;
  responses: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const num = (k: string) => (typeof t[k] === "number" ? t[k] : null);
  const [views, starts, completes, skips, responses] = [
    "views",
    "starts",
    "completes",
    "skips",
    "responses",
  ].map(num);
  if (
    views == null ||
    starts == null ||
    completes == null ||
    skips == null ||
    responses == null
  )
    return null;
  return { views, starts, completes, skips, responses };
}

/** Sponsored surveys in the admin ads area: create, edit, send for approval, decide, report. Adverts' rules, copied. */
@Injectable()
export class AdminSurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mails: MailEvents,
    private readonly results: SurveyResultsService,
  ) {}

  private async configNum(key: string): Promise<number | null> {
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    return typeof row?.valueJson === "number" ? row.valueJson : null;
  }

  private async cats(ids: string[]) {
    return ids.length
      ? this.prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, slug: true, name: true },
        })
      : [];
  }

  private screens(
    s: Full,
    categories: { slug: string; name: string }[],
  ): { wordsOk: boolean; categoriesOk: boolean; badCategories: string[] } {
    const bad = categories
      .filter((c) => KEPT_AWAY.test(c.slug) || KEPT_AWAY.test(c.name))
      .map((c) => c.name);
    return {
      wordsOk: !hasBannedWording(wording(s)),
      categoriesOk: bad.length === 0,
      badCategories: bad,
    };
  }

  /** The checks the approval card shows. APPROVE refuses while any fails. */
  private checks(
    s: Full,
    screens: { wordsOk: boolean; categoriesOk: boolean },
  ): { text: string; ok: boolean }[] {
    const questionsOk =
      s.questions.length >= 1 &&
      s.questions.length <= MAX_QUESTIONS &&
      s.questions.every((q) =>
        q.kind === "SINGLE_CHOICE"
          ? q.options.length >= MIN_OPTIONS && q.options.length <= MAX_OPTIONS
          : q.options.length === 0,
      );
    return [
      {
        text: "Labelled Sponsored Survey, with the brand name and a contact email",
        ok: !!s.brandName.trim() && /^\S+@\S+\.\S+$/.test(s.contactEmail),
      },
      { text: "Has 1 to 5 questions that can be answered", ok: questionsOk },
      {
        text: "Not political, betting, tobacco or a health claim",
        ok: screens.wordsOk && screens.categoriesOk,
      },
      {
        text: "Dates are set and in order",
        ok:
          !!s.startsOn &&
          !!s.endsOn &&
          s.endsOn.getTime() >= s.startsOn.getTime(),
      },
      { text: "A price is set", ok: s.priceKobo != null },
    ];
  }

  private async assertScreens(tx: Prisma.TransactionClient, s: Full) {
    const cats = s.categoryIds.length
      ? await tx.category.findMany({
          where: { id: { in: s.categoryIds } },
          select: { slug: true, name: true },
        })
      : [];
    const sc = this.screens(s, cats);
    if (!sc.wordsOk)
      throw invalid(
        "decision",
        "This survey has betting, gambling, lending-app, tobacco, political or health-claim wording. Ask for changes or reject it.",
      );
    if (!sc.categoriesOk)
      throw invalid(
        "decision",
        `This survey is aimed at ${sc.badCategories.join(", ")}, which sponsored surveys are kept away from. Ask for changes or reject it.`,
      );
  }

  private async assertChecks(tx: Prisma.TransactionClient, s: Full) {
    await this.assertScreens(tx, s);
    const floor = await minGroup(tx);
    if (s.responseTarget != null && s.responseTarget < floor)
      throw invalid(
        "responseTarget",
        `The target must be at least ${floor} answers.`,
      );
    const cats = s.categoryIds.length
      ? await tx.category.findMany({
          where: { id: { in: s.categoryIds } },
          select: { slug: true, name: true },
        })
      : [];
    const failing = this.checks(s, this.screens(s, cats)).find((c) => !c.ok);
    if (failing)
      throw invalid(
        "decision",
        `This survey cannot be approved yet. It fails a check: ${failing.text}.`,
      );
  }

  private async view(rows: Full[]) {
    const ids = rows.map((r) => r.id);
    const cats = await this.cats([
      ...new Set(rows.flatMap((r) => r.categoryIds)),
    ]);
    const [evs, resp] = ids.length
      ? await Promise.all([
          this.prisma.surveyEvent.groupBy({
            by: ["surveyId", "kind"],
            where: { surveyId: { in: ids } },
            _count: { _all: true },
          }),
          this.prisma.surveyResponse.groupBy({
            by: ["surveyId"],
            where: { surveyId: { in: ids } },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    const today = lagosDay();
    const floor = await minGroup(this.prisma);
    return rows.map((s) => {
      const n = (k: string) =>
        evs.find((e) => e.surveyId === s.id && (e.kind as string) === k)?._count
          ._all ?? 0;
      const responses = resp.find((r) => r.surveyId === s.id)?._count._all ?? 0;
      const screens = this.screens(
        s,
        cats.filter((c) => s.categoryIds.includes(c.id)),
      );
      return {
        id: s.id,
        brandId: s.brandId,
        brandName: s.brandName,
        contactEmail: s.contactEmail,
        title: s.title,
        status: s.status,
        label: "Sponsored Survey",
        live: isLive(s, responses, floor, today),
        checks: this.checks(s, screens),
        questions: s.questions.map((q) => ({
          id: q.id,
          position: q.position,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options.map((o) => ({ id: o.id, label: o.label })),
        })),
        categoryIds: s.categoryIds,
        states: s.states,
        startsOn: isoDate(s.startsOn),
        endsOn: isoDate(s.endsOn),
        frequencyCapPerDay: s.frequencyCapPerDay,
        priceKobo: s.priceKobo,
        responseTarget: s.responseTarget,
        // OWNER RULING, 14 Nov 2026: the team (ADMIN and AD_MANAGER) MAY see the running TOTALS of a survey at any size
        // (responses, completes, starts, skips, views here; answeredSoFar on the report route), so they can tell a slow
        // survey from a broken one. This is not a fault. What stays true, with tests: no staff route gives a BREAKDOWN
        // (by state, age band, gender, mood, day or question choice) under the floor, and brands and released reports
        // never show anything under the floor.
        // Served from the answers themselves, not from the COMPLETE event rows: one answer set is one finish, so the two
        // can never drift apart (a purge removes the answer set, and the number falls with it). A RELEASED survey shows
        // the totals it was released with (round 6, owner ruling "Numbers stay"): a later purge changes none of them.
        ...(releasedShown(s.releasedTotals) ?? {
          views: n("VIEW"),
          starts: n("START"),
          completes: responses,
          skips: n("SKIP"),
          responses,
        }),
        rejectReason: s.rejectReason,
        changeRequest: s.changeRequest,
        submittedAt: s.submittedAt?.toISOString() ?? null,
        approvedAt: s.approvedAt?.toISOString() ?? null,
        snapshotAt: s.snapshotAt?.toISOString() ?? null,
        releasedAt: s.releasedAt?.toISOString() ?? null,
      };
    });
  }

  async list(q: SurveyListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.sponsoredSurvey.findMany({
      where: {
        ...(q.status ? { status: q.status as AdStatus } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: new Date(cur.k) } },
                { createdAt: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      include: FULL,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: await this.view(slice),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
      awaitingApproval: await this.prisma.sponsoredSurvey.count({
        where: { status: "AWAITING_APPROVAL" },
      }),
    };
  }

  async get(id: string) {
    const s = await this.prisma.sponsoredSurvey.findUnique({
      where: { id },
      include: FULL,
    });
    if (!s) throw notFound("We could not find that survey.");
    return (await this.view([s]))[0];
  }

  /** Rules the DTO cannot state: question shape, dates, categories, brand. */
  private async check(dto: Partial<UpsertSurveyDto>) {
    if (dto.responseTarget != null) {
      const floor = await minGroup(this.prisma);
      if (dto.responseTarget < floor)
        throw invalid(
          "responseTarget",
          `The target must be at least ${floor} answers.`,
        );
    }
    for (const k of ["startsOn", "endsOn"] as const) {
      const v = dto[k];
      if (v && !isRealDate(v)) throw invalid(k, "Use a real date.");
    }
    if (dto.startsOn && dto.endsOn && dto.endsOn < dto.startsOn)
      throw invalid("endsOn", "The end date comes before the start date.");
    if (dto.categoryIds?.length) {
      const n = await this.prisma.category.count({
        where: { id: { in: dto.categoryIds } },
      });
      if (n !== new Set(dto.categoryIds).size)
        throw invalid("categoryIds", "One of those categories does not exist.");
    }
    if (dto.brandId) {
      const b = await this.prisma.brand.findUnique({
        where: { id: dto.brandId },
      });
      if (!b) throw invalid("brandId", "That brand was not found.");
    }
    if (dto.questions) this.checkQuestions(dto.questions);
  }

  private checkQuestions(qs: SurveyQuestionDto[]) {
    if (qs.length < 1 || qs.length > MAX_QUESTIONS)
      throw invalid("questions", "A survey has 1 to 5 questions.");
    qs.forEach((q, i) => {
      const path = `questions.${i}`;
      if (q.kind === "SINGLE_CHOICE") {
        const opts = q.options ?? [];
        if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS)
          throw invalid(
            `${path}.options`,
            "A poll question needs 2 to 6 choices.",
          );
        if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length)
          throw invalid(`${path}.options`, "Each choice must be different.");
      } else if ((q.options ?? []).length > 0) {
        throw invalid(`${path}.options`, "Only a poll question has choices.");
      }
    });
  }

  private questionRows(qs: SurveyQuestionDto[]) {
    return qs.map((q, i) => ({
      position: i + 1,
      kind: q.kind as "SINGLE_CHOICE" | "TEXT" | "VOICE",
      prompt: q.prompt,
      options: {
        create: (q.kind === "SINGLE_CHOICE" ? (q.options ?? []) : []).map(
          (label, j) => ({ position: j + 1, label }),
        ),
      },
    }));
  }

  async create(actor: CurrentMeInfo, dto: UpsertSurveyDto) {
    await this.check(dto);
    // The price: what the admin gave, else the admin price list. Never a number written in code.
    const price =
      dto.priceKobo ?? (await this.configNum("surveys.price.flat_kobo"));
    const cap =
      dto.frequencyCapPerDay ??
      (await this.configNum("surveys.frequency_cap_per_day")) ??
      1;
    const id = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sponsoredSurvey.create({
        data: {
          brandName: dto.brandName,
          brandId: dto.brandId ?? null,
          contactEmail: dto.contactEmail,
          title: dto.title,
          status: "DRAFT",
          categoryIds: dto.categoryIds ?? [],
          states: dto.states ?? [],
          startsOn: dto.startsOn ? dateOnly(dto.startsOn) : null,
          endsOn: dto.endsOn ? dateOnly(dto.endsOn) : null,
          frequencyCapPerDay: cap,
          priceKobo: price,
          responseTarget: dto.responseTarget ?? null,
          createdById: actor.id,
          questions: { create: this.questionRows(dto.questions) },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "survey.create",
          targetType: "survey",
          targetId: s.id,
          after: { brandName: s.brandName, title: s.title, status: s.status },
        },
      });
      return s.id;
    });
    return this.get(id);
  }

  async update(actor: CurrentMeInfo, surveyId: string, dto: UpdateSurveyDto) {
    await this.check(dto);
    // A survey that is already over is fixed here, in this request, before any edit is looked at: moving its end date or
    // target cannot bring it back to life.
    await this.results.ensureSnapshot(surveyId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const s = await tx.sponsoredSurvey.findUnique({
        where: { id: surveyId },
        select: {
          status: true,
          title: true,
          brandName: true,
          startsOn: true,
          endsOn: true,
          snapshotAt: true,
        },
      });
      if (!s) throw notFound("We could not find that survey.");
      if (s.snapshotAt)
        throw conflict("This survey is over and its results are fixed.");
      if (s.status === "APPROVED" || s.status === "REJECTED")
        throw conflict(
          s.status === "APPROVED"
            ? "Pause the survey before you edit it."
            : "A rejected survey cannot be edited. Make a new one.",
        );
      {
        const from = dto.startsOn ?? isoDate(s.startsOn);
        const to = dto.endsOn ?? isoDate(s.endsOn);
        if (from && to && to < from)
          throw invalid("endsOn", "The end date comes before the start date.");
      }
      if (dto.questions) {
        const answered = await tx.surveyResponse.count({ where: { surveyId } });
        if (answered > 0)
          throw conflict(
            "People have already answered, so the questions cannot change.",
          );
        await tx.surveyQuestion.deleteMany({ where: { surveyId } });
        for (const q of this.questionRows(dto.questions))
          await tx.surveyQuestion.create({ data: { ...q, surveyId } });
      }
      // What people see changed on a paused survey: it goes back to the queue, it was approved as it was.
      const touched =
        s.status === "PAUSED" &&
        (dto.brandName !== undefined ||
          dto.title !== undefined ||
          dto.questions !== undefined ||
          dto.categoryIds !== undefined);
      const next: AdStatus = touched ? "AWAITING_APPROVAL" : s.status;
      const d: Prisma.SponsoredSurveyUncheckedUpdateInput = { status: next };
      if (dto.brandName !== undefined) d.brandName = dto.brandName;
      if (dto.brandId !== undefined) d.brandId = dto.brandId;
      if (dto.contactEmail !== undefined) d.contactEmail = dto.contactEmail;
      if (dto.title !== undefined) d.title = dto.title;
      if (dto.categoryIds !== undefined) d.categoryIds = dto.categoryIds;
      if (dto.states !== undefined) d.states = dto.states;
      if (dto.startsOn !== undefined) d.startsOn = dateOnly(dto.startsOn);
      if (dto.endsOn !== undefined) d.endsOn = dateOnly(dto.endsOn);
      if (dto.frequencyCapPerDay !== undefined)
        d.frequencyCapPerDay = dto.frequencyCapPerDay;
      if (dto.priceKobo !== undefined) d.priceKobo = dto.priceKobo;
      if (dto.responseTarget !== undefined)
        d.responseTarget = dto.responseTarget;
      if (s.status === "DRAFT") d.changeRequest = null;
      const after = await tx.sponsoredSurvey.update({
        where: { id: surveyId },
        data: d,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "survey.update",
          targetType: "survey",
          targetId: surveyId,
          before: { title: s.title, brandName: s.brandName, status: s.status },
          after: {
            title: after.title,
            brandName: after.brandName,
            status: after.status,
          },
        },
      });
    });
    return this.get(surveyId);
  }

  /** DRAFT to AWAITING_APPROVAL. The brand's contact is told it was received (F01). */
  async submit(actor: CurrentMeInfo, surveyId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const s = await tx.sponsoredSurvey.findUnique({
        where: { id: surveyId },
        include: FULL,
      });
      if (!s) throw notFound("We could not find that survey.");
      if (s.status !== "DRAFT")
        throw conflict("Only a draft can be sent for approval.");
      if (s.questions.length < 1)
        throw invalid("questions", "Add at least one question first.");
      await tx.sponsoredSurvey.update({
        where: { id: surveyId },
        data: {
          status: "AWAITING_APPROVAL",
          submittedAt: new Date(),
          changeRequest: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "survey.submit",
          targetType: "survey",
          targetId: surveyId,
          before: { status: "DRAFT" },
          after: { status: "AWAITING_APPROVAL" },
        },
      });
    });
    void this.mails.surveySubmitted(surveyId);
    return this.get(surveyId);
  }

  async decide(actor: CurrentMeInfo, surveyId: string, dto: SurveyDecisionDto) {
    const needsReason =
      dto.decision === "REJECT" || dto.decision === "ASK_FOR_CHANGES";
    if (needsReason && !dto.reason)
      throw invalid("reason", "Say why, so the brand can act on it.");
    // Same as an edit: an over survey is fixed in this request, so a resume cannot reopen it.
    await this.results.ensureSnapshot(surveyId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const s = await tx.sponsoredSurvey.findUnique({
        where: { id: surveyId },
        include: FULL,
      });
      if (!s) throw notFound("We could not find that survey.");
      if (s.snapshotAt)
        throw conflict("This survey is over and its results are fixed.");
      const from = s.status;
      let data: Prisma.SponsoredSurveyUncheckedUpdateInput;
      switch (dto.decision) {
        case "APPROVE":
          if (from !== "AWAITING_APPROVAL")
            throw conflict("Only a survey awaiting approval can be approved.");
          await this.assertChecks(tx, s);
          data = {
            status: "APPROVED",
            approvedById: actor.id,
            approvedAt: new Date(),
            rejectReason: null,
            changeRequest: null,
          };
          break;
        case "REJECT":
          if (from === "REJECTED")
            throw conflict("This survey is already rejected.");
          data = { status: "REJECTED", rejectReason: dto.reason };
          break;
        case "ASK_FOR_CHANGES":
          if (from !== "AWAITING_APPROVAL")
            throw conflict("Only a survey awaiting approval can be sent back.");
          data = { status: "DRAFT", changeRequest: dto.reason };
          break;
        case "PAUSE":
          if (from !== "APPROVED")
            throw conflict("Only a running survey can be paused.");
          data = { status: "PAUSED" };
          break;
        default:
          if (from !== "PAUSED")
            throw conflict("Only a paused survey can be resumed.");
          await this.assertScreens(tx, s);
          data = { status: "APPROVED" };
      }
      const after = await tx.sponsoredSurvey.update({
        where: { id: surveyId },
        data,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "survey.decision",
          targetType: "survey",
          targetId: surveyId,
          reason: dto.reason ?? null,
          before: { status: from },
          after: { decision: dto.decision, status: after.status },
        },
      });
    });
    if (dto.decision === "APPROVE") void this.mails.surveyApproved(surveyId);
    if (dto.decision === "ASK_FOR_CHANGES")
      void this.mails.surveyNeedsChanges(surveyId, dto.reason as string);
    return this.get(surveyId);
  }

  /** GET /admin/surveys/:id/report: see SurveyResultsService.report. */
  report(actor: CurrentMeInfo, surveyId: string) {
    return this.results.report(actor, surveyId);
  }

  /** Fixes the results of surveys that are over and retries F04 for released ones. Run by a timer. */
  sweepFinished(now = new Date()): Promise<number> {
    return this.results.sweep(now);
  }
}
