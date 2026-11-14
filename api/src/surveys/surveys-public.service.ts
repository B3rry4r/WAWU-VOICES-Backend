import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import type { Prisma } from "../generated/prisma/client";
import type { CurrentMeInfo } from "../me/me-context";
import { KEPT_AWAY } from "../admin/trust/ads.service";
import {
  conflict,
  dateOnly,
  invalid,
  isoDate,
  lagosDay,
  lockRow,
  notFound,
} from "../admin/trust/common";
import type { SurveyResponseDto } from "./dto";
import { AGE_BANDS, respondentKey, TEXT_ANSWER_MAX } from "./survey-rules";
import { isLive } from "./surveys-admin.service";
import { SurveyResultsService } from "./surveys-results.service";

/** True when the survey's start date is still ahead (it has not opened yet, so it has not closed). */
function isFuture(s: { startsOn: Date | null }): boolean {
  const from = isoDate(s.startsOn);
  return !!from && from > lagosDay();
}

const WITH_QUESTIONS = {
  brand: { select: { slug: true, website: true, active: true } },
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

type Survey = Prisma.SponsoredSurveyGetPayload<{
  include: typeof WITH_QUESTIONS;
}>;

/** What the survey screens say, so the app and the API never drift: the note under every survey. */
export const SURVEY_NOTE =
  "This survey was paid for by the brand and approved by WAWU. Answering is free and optional, and it never uses a free post.";

/** The public side of sponsored surveys: the feed card, the survey, the answers. Signed-in people only. */
@Injectable()
export class SurveysPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly results: SurveyResultsService,
  ) {}

  private async num(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    return typeof row?.valueJson === "number" ? row.valueJson : fallback;
  }

  /** The signed-in person, or null for a guest. Only the fields targeting needs. */
  private async person(user: MaybeVoicesUser) {
    if (!user) return null;
    return this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      select: {
        id: true,
        state: true,
        status: true,
        settings: { select: { useMyStateForSurveys: true } },
      },
    });
  }

  /** A survey aimed at states is shown only to a person who turned that on and whose state is one of them. */
  private stateOk(
    s: { states: string[] },
    me: {
      state: string | null;
      settings?: { useMyStateForSurveys: boolean } | null;
    },
  ): boolean {
    if (!s.states.length) return true;
    return (
      me.settings?.useMyStateForSurveys === true &&
      !!me.state &&
      s.states.includes(me.state)
    );
  }

  private card(s: Survey) {
    return {
      id: s.id,
      label: "Sponsored Survey",
      brandName: s.brandName,
      brandSlug: s.brand?.active ? s.brand.slug : null,
      brandWebsite: s.brand?.active ? s.brand.website : null,
      title: s.title,
      questionCount: s.questions.length,
    };
  }

  /** The one feed slot for a survey. Null when nothing fits: never a guest, never beside a sensitive conversation. */
  async placement(
    user: MaybeVoicesUser,
    q: { questionId?: string; categoryId?: string },
  ) {
    const me = await this.person(user);
    if (!me || me.status !== "ACTIVE") return { survey: null };
    let categoryId = q.categoryId ?? null;
    if (q.questionId) {
      const question = await this.prisma.question.findUnique({
        where: { id: q.questionId },
        include: {
          topic: { select: { sensitive: true } },
          category: { select: { slug: true, name: true } },
        },
      });
      if (question && (question.sensitive || question.topic?.sensitive))
        return { survey: null };
      if (
        question?.category &&
        (KEPT_AWAY.test(question.category.slug) ||
          KEPT_AWAY.test(question.category.name))
      )
        return { survey: null };
      categoryId ??= question?.categoryId ?? null;
    }
    if (categoryId) {
      const c = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { slug: true, name: true },
      });
      if (c && (KEPT_AWAY.test(c.slug) || KEPT_AWAY.test(c.name)))
        return { survey: null };
    }
    const day = dateOnly(lagosDay());
    const maxSkips = await this.num("surveys.max_skips", 2);
    const rows = await this.prisma.sponsoredSurvey.findMany({
      where: {
        status: "APPROVED",
        AND: [
          { OR: [{ startsOn: null }, { startsOn: { lte: day } }] },
          { OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
        ],
      },
      include: WITH_QUESTIONS,
      orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    if (!rows.length) return { survey: null };
    const ids = rows.map((r) => r.id);
    const [done, seenRows, skipRows, counts] = await Promise.all([
      this.prisma.surveyResponse.findMany({
        where: {
          surveyId: { in: ids },
          respondentKey: { in: ids.map((id) => respondentKey(id, me.id)) },
        },
        select: { surveyId: true },
      }),
      this.prisma.surveyEvent.groupBy({
        by: ["surveyId"],
        where: {
          surveyId: { in: ids },
          userId: me.id,
          kind: "VIEW",
          day,
        },
        _count: { _all: true },
      }),
      this.prisma.surveyEvent.groupBy({
        by: ["surveyId"],
        where: { surveyId: { in: ids }, userId: me.id, kind: "SKIP" },
        _count: { _all: true },
      }),
      this.prisma.surveyResponse.groupBy({
        by: ["surveyId"],
        where: { surveyId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const answered = new Set(done.map((d) => d.surveyId));
    const seen = new Map(seenRows.map((r) => [r.surveyId, r._count._all]));
    const skips = new Map(skipRows.map((r) => [r.surveyId, r._count._all]));
    const total = new Map(counts.map((r) => [r.surveyId, r._count._all]));
    const eligible = rows.filter((s) => {
      if (!isLive(s, total.get(s.id) ?? 0)) return false;
      if (answered.has(s.id)) return false;
      if ((skips.get(s.id) ?? 0) >= maxSkips) return false;
      if (
        s.categoryIds.length &&
        (!categoryId || !s.categoryIds.includes(categoryId))
      )
        return false;
      if (!this.stateOk(s, me)) return false;
      return (seen.get(s.id) ?? 0) < s.frequencyCapPerDay;
    });
    eligible.sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));
    const s = eligible[0];
    return { survey: s ? this.card(s) : null };
  }

  /** A survey this person may open: live, in their state, not answered, not skipped past the limit. */
  private async openable(
    tx: Pick<
      Prisma.TransactionClient,
      "sponsoredSurvey" | "surveyResponse" | "surveyEvent"
    >,
    surveyId: string,
    me: {
      id: string;
      state: string | null;
      settings?: { useMyStateForSurveys: boolean } | null;
    },
    /** True when an answer is being sent: a survey that ended or reached its target answers 409 "closed", not 404. */
    forAnswer = false,
  ): Promise<{ survey: Survey; answered: boolean }> {
    const s = await tx.sponsoredSurvey.findUnique({
      where: { id: surveyId },
      include: WITH_QUESTIONS,
    });
    if (!s) throw notFound("We could not find that survey.");
    const total = await tx.surveyResponse.count({ where: { surveyId } });
    if (!this.stateOk(s, me)) throw notFound("We could not find that survey.");
    if (!isLive(s, total)) {
      const ran = s.status === "APPROVED" && !isFuture(s);
      if (forAnswer && ran) throw conflict("This survey has closed.");
      throw notFound("We could not find that survey.");
    }
    const mine = await tx.surveyResponse.findUnique({
      where: {
        surveyId_respondentKey: {
          surveyId,
          respondentKey: respondentKey(surveyId, me.id),
        },
      },
      select: { id: true },
    });
    if (mine) return { survey: s, answered: true };
    const skips = await tx.surveyEvent.count({
      where: { surveyId, userId: me.id, kind: "SKIP" },
    });
    if (skips >= (await this.num("surveys.max_skips", 2)))
      throw notFound("We could not find that survey.");
    return { survey: s, answered: false };
  }

  private async meRow(me: CurrentMeInfo) {
    const row = await this.prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        state: true,
        settings: { select: { useMyStateForSurveys: true } },
      },
    });
    if (!row) throw notFound("We could not find you.");
    return row;
  }

  async get(me: CurrentMeInfo, surveyId: string) {
    const row = await this.meRow(me);
    const { survey: s, answered } = await this.openable(
      this.prisma,
      surveyId,
      row,
    );
    const voiceMax = await this.num("surveys.voice_max_seconds", 30);
    return {
      ...this.card(s),
      note: SURVEY_NOTE,
      myStatus: answered ? "ANSWERED" : "OPEN",
      voiceMaxSeconds: voiceMax,
      ageBands: [...AGE_BANDS],
      questions: answered
        ? []
        : s.questions.map((q) => ({
            id: q.id,
            position: q.position,
            kind: q.kind,
            prompt: q.prompt,
            options: q.options.map((o) => ({ id: o.id, label: o.label })),
          })),
    };
  }

  async event(
    me: CurrentMeInfo,
    surveyId: string,
    kind: "VIEW" | "START" | "SKIP",
  ): Promise<void> {
    const row = await this.meRow(me);
    const { survey, answered } = await this.openable(
      this.prisma,
      surveyId,
      row,
    );
    // After an answer nothing more is counted: a person who answered cannot also have skipped.
    if (answered) return;
    // One person cannot inflate the counts: a START once per survey, a VIEW at most the day's frequency cap, a SKIP
    // only up to the limit (past that the survey is not shown to them at all).
    const day = dateOnly(lagosDay());
    if (kind === "START") {
      if (
        await this.prisma.surveyEvent.count({
          where: { surveyId, userId: row.id, kind: "START" },
        })
      )
        return;
    } else if (kind === "VIEW") {
      const cap = survey.frequencyCapPerDay;
      const seen = await this.prisma.surveyEvent.count({
        where: { surveyId, userId: row.id, kind: "VIEW", day },
      });
      if (seen >= cap) return;
    }
    await this.prisma.surveyEvent.create({
      data: {
        surveyId,
        kind,
        userId: row.id,
        day: dateOnly(lagosDay()),
      },
    });
  }

  /** POST /surveys/:id/responses. Touches no token, free post or posting-limit row: it only writes survey rows. */
  async respond(me: CurrentMeInfo, surveyId: string, dto: SurveyResponseDto) {
    const row = await this.meRow(me);
    const voiceMaxMs = (await this.num("surveys.voice_max_seconds", 30)) * 1000;
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "SponsoredSurvey", "id", surveyId);
      const { survey: s, answered } = await this.openable(
        tx,
        surveyId,
        row,
        true,
      );
      if (answered)
        throw conflict("You have already answered this survey. Thank you.");
      const byId = new Map(s.questions.map((q) => [q.id, q]));
      const seenQ = new Set<string>();
      const seenClips = new Set<string>();
      const used: {
        questionId: string;
        optionId: string | null;
        text: string | null;
        clipId: string | null;
      }[] = [];
      for (const [i, a] of dto.answers.entries()) {
        const path = `answers.${i}`;
        const q = byId.get(a.questionId);
        if (!q)
          throw invalid(
            `${path}.questionId`,
            "That question is not part of this survey.",
          );
        if (seenQ.has(q.id))
          throw invalid(
            `${path}.questionId`,
            "Each question is answered once.",
          );
        seenQ.add(q.id);
        const given = [a.optionId, a.text, a.clipId].filter(
          (x) => x !== undefined,
        ).length;
        if (given !== 1)
          throw invalid(path, "Give one answer for each question.");
        if (q.kind === "SINGLE_CHOICE") {
          if (!a.optionId || !q.options.some((o) => o.id === a.optionId))
            throw invalid(
              `${path}.optionId`,
              "Pick one of the choices for this question.",
            );
          used.push({
            questionId: q.id,
            optionId: a.optionId,
            text: null,
            clipId: null,
          });
        } else if (q.kind === "TEXT") {
          const text = (a.text ?? "").trim();
          if (!text || text.length > TEXT_ANSWER_MAX)
            throw invalid(
              `${path}.text`,
              `Write 1 to ${TEXT_ANSWER_MAX} characters.`,
            );
          used.push({
            questionId: q.id,
            optionId: null,
            text,
            clipId: null,
          });
        } else {
          if (!a.clipId)
            throw invalid(`${path}.clipId`, "Record a short voice answer.");
          const clip = await tx.voiceClip.findFirst({
            where: { id: a.clipId, ownerId: me.id },
          });
          if (!clip || clip.purpose !== "SURVEY_ANSWER" || clip.removedAt)
            throw invalid(`${path}.clipId`, "That recording was not found.");
          if (clip.status !== "READY")
            throw invalid(
              `${path}.clipId`,
              "That recording is still being prepared. Try again in a moment.",
            );
          if ((clip.durationMs ?? 0) > voiceMaxMs)
            throw invalid(
              `${path}.clipId`,
              `A voice answer is at most ${voiceMaxMs / 1000} seconds.`,
            );
          if (seenClips.has(a.clipId))
            throw invalid(`${path}.clipId`, "That recording was already used.");
          seenClips.add(a.clipId);
          const taken = await tx.surveyAnswer.count({
            where: { clipId: a.clipId },
          });
          if (taken)
            throw invalid(`${path}.clipId`, "That recording was already used.");
          used.push({
            questionId: q.id,
            optionId: null,
            text: null,
            clipId: a.clipId,
          });
        }
      }
      // Anonymous: nothing about the person is kept beside the answer, whatever else was sent.
      const anon = dto.anonymous === true;
      const shareState = !anon && dto.shareState === true && !!row.state;
      const ageBand = !anon && dto.ageBand ? dto.ageBand : null;
      await tx.surveyResponse.create({
        data: {
          surveyId,
          respondentKey: respondentKey(surveyId, me.id),
          anonymous: anon,
          shareDemo: shareState || !!ageBand,
          state: shareState ? row.state : null,
          ageBand,
          answers: { create: used },
        },
      });
      await tx.surveyEvent.create({
        data: {
          surveyId,
          kind: "COMPLETE",
          // No user id: nothing in the database may tie a completed survey to the person who finished it.
          day: dateOnly(lagosDay()),
        },
      });
      const total = await tx.surveyResponse.count({ where: { surveyId } });
      // The answer that reaches the target fixes the results in the same transaction: no later answer can follow it.
      if (s.responseTarget != null && total >= s.responseTarget)
        await this.results.snapshotIn(tx, surveyId);
    });
    return { ok: true, note: SURVEY_NOTE };
  }
}
