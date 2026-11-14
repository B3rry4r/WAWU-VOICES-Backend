import { ConflictException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import type {
  PollKind,
  QuestionKind,
  QuestionStatus,
  TopicStatus,
} from "../generated/prisma/enums";
import { invalidateUnreadableQuestions } from "../feed/question-window";
import { PrismaService } from "../common/prisma/prisma.service";
import { decodeNumCursor, encodeNumCursor } from "./support";
import { pageLimit } from "../me/paging";
import type {
  SummaryEditDto,
  UpsertPollDto,
  UpsertQuestionDto,
  UpsertTopicDto,
} from "./dto";
import {
  CALENDAR_LOCK,
  addDays,
  conflict,
  dateOnly,
  dayString,
  invalid,
  isDateString,
  lagosDayEnd,
  lagosDayStart,
  lagosDayString,
  notFound,
  writeAudit,
  type FieldIssue,
  type Json,
} from "./support";
import { AdminViews, POLL_INCLUDE } from "./views";

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;

const STATUS_WORD: Record<string, TopicStatus> = {
  DRAFT: "DRAFT",
  IN_REVIEW: "IN_REVIEW",
  INREVIEW: "IN_REVIEW",
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  CLOSED: "CLOSED",
};

const NO_BAD_WORDS =
  /\b(everyone agrees|everybody agrees|all agree|unanimous(ly)?|we all agree|everyone is)\b/i;

/** The calendar: weeks (topics), their daily and spare questions, their polls and the What Next? summary. */
@Injectable()
export class TopicsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: AdminViews,
  ) {}

  // ---------------------------------------------------------------- topics

  async list(q: {
    cursor?: string;
    limit?: unknown;
    status?: string;
    sensitive?: string;
    q?: string;
  }): Promise<Json> {
    const limit = pageLimit(q.limit);
    const after = decodeNumCursor(q.cursor);
    const where: Prisma.TopicWhereInput = {};
    if (q.status !== undefined && q.status !== "") {
      const s = STATUS_WORD[q.status.toUpperCase().replace(/[\s-]/g, "_")];
      if (!s || q.status.toLowerCase() === "all")
        throw invalid({
          path: "status",
          message: "Use draft, in_review, scheduled, live or closed.",
        });
      where.status = s;
    }
    if (q.sensitive !== undefined && q.sensitive !== "") {
      if (q.sensitive !== "true" && q.sensitive !== "false")
        throw invalid({ path: "sensitive", message: "Use true or false." });
      if (q.sensitive === "true") where.sensitive = true;
    }
    const term = q.q?.trim();
    if (term) {
      const ors: Prisma.TopicWhereInput[] = [
        { title: { contains: term, mode: "insensitive" } },
        {
          questions: {
            some: { text: { contains: term, mode: "insensitive" } },
          },
        },
      ];
      if (/^\d{1,5}$/.test(term)) ors.push({ weekNumber: Number(term) });
      where.OR = ors;
    }
    const [rows, byStatus, sensitive, weeks, questions] = await Promise.all([
      this.prisma.topic.findMany({
        where: {
          ...where,
          ...(after !== null ? { weekNumber: { gt: after } } : {}),
        },
        orderBy: { weekNumber: "asc" },
        take: limit + 1,
      }),
      this.prisma.topic.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.topic.count({ where: { sensitive: true } }),
      this.prisma.topic.count(),
      this.prisma.question.count({ where: { topicId: { not: null } } }),
    ]);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const n = (s: TopicStatus): number =>
      byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      items: items.map((t) => ({
        weekNumber: t.weekNumber,
        topicId: t.id,
        title: t.title,
        startsOn: dayString(t.startsOn),
        status: t.status,
      })),
      nextCursor:
        rows.length > limit && last ? encodeNumCursor(last.weekNumber) : null,
      counts: {
        live: n("LIVE"),
        scheduled: n("SCHEDULED"),
        inReview: n("IN_REVIEW"),
        draft: n("DRAFT"),
        sensitive,
      },
      totals: { weeks, questions },
    };
  }

  async get(id: string): Promise<Json> {
    return this.topicDetail(this.prisma, id);
  }

  private async topicDetail(db: Tx | PrismaService, id: string): Promise<Json> {
    const t = await db.topic.findUnique({ where: { id } });
    if (!t) throw notFound("that week");
    // One after the other: `db` may be a transaction's connection (C-L8).
    const qs = await db.question.findMany({
      where: { topicId: id, isSpare: false, kind: { not: "OVERRIDE" } },
      orderBy: [
        { slotIndex: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    });
    const spare = await db.question.findMany({
      where: { topicId: id, isSpare: true, kind: { not: "OVERRIDE" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const poll = await db.poll.findFirst({
      where: { topicId: id, kind: "WEEKLY" },
      include: POLL_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    return {
      topic: await this.views.topic(t, db),
      questions: qs.map((q) => this.views.adminQuestion(q)),
      spare: spare.map((q) => this.views.adminQuestion(q)),
      poll: poll ? await this.views.poll(poll, db) : null,
    };
  }

  /** A week must keep seven dated questions before it can be scheduled or go live. */
  private async assertReady(tx: Tx, topicId: string, next: TopicStatus) {
    if (next !== "SCHEDULED" && next !== "LIVE") return;
    const slots = await tx.question.findMany({
      where: {
        topicId,
        isSpare: false,
        kind: { not: "OVERRIDE" },
        slotIndex: { not: null },
      },
      select: { slotIndex: true },
    });
    const have = new Set(slots.map((s) => s.slotIndex));
    const missing = [1, 2, 3, 4, 5, 6, 7].filter((n) => !have.has(n));
    if (missing.length)
      throw invalid({
        path: "status",
        message: `Add a question for ${missing.length === 1 ? "day" : "days"} ${missing.join(", ")} before this week can be scheduled.`,
      });
  }

  private assertTransition(from: TopicStatus | null, to: TopicStatus) {
    if (from === null) {
      if (to === "LIVE" || to === "CLOSED")
        throw invalid({
          path: "status",
          message: "A new week starts as a draft, in review or scheduled.",
        });
      return;
    }
    if (from === to) return;
    if (from === "CLOSED") throw conflict("A closed week cannot change.");
    if (from === "LIVE" && to !== "CLOSED")
      throw conflict("A live week can only be closed.");
    if (to === "LIVE" && from !== "SCHEDULED")
      throw conflict("Schedule the week before it goes live.");
    if (to === "CLOSED" && from !== "LIVE")
      throw conflict("Only a live week can be closed.");
  }

  private async checkOverlap(
    tx: Tx,
    startsOn: Date,
    endsOn: Date,
    exceptId: string | null,
  ) {
    const other = await tx.topic.findFirst({
      where: {
        id: exceptId ? { not: exceptId } : undefined,
        startsOn: { lte: endsOn },
        endsOn: { gte: startsOn },
      },
      select: { weekNumber: true },
    });
    if (other) throw conflict(`Those dates overlap week ${other.weekNumber}.`);
  }

  async create(actorId: string, dto: UpsertTopicDto): Promise<Json> {
    if (!isDateString(dto.startsOn))
      throw invalid({
        path: "startsOn",
        message: "Use a real date, like 2026-11-12.",
      });
    const startsOn = dateOnly(dto.startsOn);
    const endsOn = addDays(startsOn, 6);
    const status = (dto.status ?? "DRAFT") as TopicStatus;
    this.assertTransition(null, status);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      if (
        await tx.topic.findUnique({
          where: { weekNumber: dto.weekNumber },
          select: { id: true },
        })
      )
        throw conflict(`Week ${dto.weekNumber} already exists.`);
      await this.checkOverlap(tx, startsOn, endsOn, null);
      const t = await tx.topic.create({
        data: {
          weekNumber: dto.weekNumber,
          title: dto.title,
          blurb: dto.blurb ?? null,
          startsOn,
          endsOn,
          status: "DRAFT",
          sensitive: dto.sensitive ?? false,
          whatNextPrompt: dto.whatNextPrompt ?? null,
        },
      });
      if (status !== "DRAFT") {
        await this.assertReady(tx, t.id, status);
        await tx.topic.update({ where: { id: t.id }, data: { status } });
      }
      const after = await tx.topic.findUniqueOrThrow({ where: { id: t.id } });
      await writeAudit(tx, {
        actorId,
        action: "topic.create",
        targetType: "Topic",
        targetId: t.id,
        after: this.topicSnap(after),
      });
      return t.id;
    });
    return this.topicDetail(this.prisma, id);
  }

  private topicSnap(t: Prisma.TopicGetPayload<object>): Json {
    return {
      weekNumber: t.weekNumber,
      title: t.title,
      blurb: t.blurb,
      startsOn: dayString(t.startsOn),
      endsOn: dayString(t.endsOn),
      status: t.status,
      sensitive: t.sensitive,
      whatNextPrompt: t.whatNextPrompt,
    };
  }

  async update(
    actorId: string,
    id: string,
    dto: UpsertTopicDto,
  ): Promise<Json> {
    if (!isDateString(dto.startsOn))
      throw invalid({
        path: "startsOn",
        message: "Use a real date, like 2026-11-12.",
      });
    const newStart = dateOnly(dto.startsOn);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const t = await tx.topic.findUnique({ where: { id } });
      if (!t) throw notFound("that week");
      if (dto.weekNumber !== t.weekNumber) {
        const dup = await tx.topic.findUnique({
          where: { weekNumber: dto.weekNumber },
          select: { id: true },
        });
        if (dup) throw conflict(`Week ${dto.weekNumber} already exists.`);
      }
      const nextStatus = (dto.status ?? t.status) as TopicStatus;
      this.assertTransition(t.status, nextStatus);
      const deltaDays = Math.round(
        (newStart.getTime() - t.startsOn.getTime()) / DAY_MS,
      );
      const moves: { id: string; from: string | null; to: string | null }[] =
        [];
      let newEnd = t.endsOn;
      if (deltaDays !== 0) {
        if (t.status === "LIVE" || t.status === "CLOSED")
          throw conflict("A week that has started cannot move.");
        newEnd = addDays(newStart, 6);
        if (nextStatus === "SCHEDULED" && dto.startsOn < lagosDayString())
          throw invalid({
            path: "startsOn",
            message: "A scheduled week cannot start in the past.",
          });
        await this.checkOverlap(tx, newStart, newEnd, t.id);
        // only this week moves: its dated questions and its polls that have not opened
        const qs = await tx.question.findMany({
          where: {
            topicId: t.id,
            kind: { not: "OVERRIDE" },
            scheduledFor: { not: null },
            status: { in: ["DRAFT", "SCHEDULED"] },
          },
        });
        for (const q of qs) {
          const from = q.scheduledFor as Date;
          const to = addDays(from, deltaDays);
          await tx.question.update({
            where: { id: q.id },
            data: {
              scheduledFor: to,
              startsAt: q.startsAt
                ? new Date(q.startsAt.getTime() + deltaDays * DAY_MS)
                : null,
              endsAt: q.endsAt
                ? new Date(q.endsAt.getTime() + deltaDays * DAY_MS)
                : null,
            },
          });
          moves.push({ id: q.id, from: dayString(from), to: dayString(to) });
        }
        const polls = await tx.poll.findMany({
          where: {
            status: "SCHEDULED",
            OR: [
              { topicId: t.id },
              { questionId: { in: qs.map((q) => q.id) } },
            ],
          },
        });
        for (const p of polls)
          await tx.poll.update({
            where: { id: p.id },
            data: {
              startsAt: new Date(p.startsAt.getTime() + deltaDays * DAY_MS),
              endsAt: new Date(p.endsAt.getTime() + deltaDays * DAY_MS),
            },
          });
      }
      if (nextStatus !== t.status) await this.assertReady(tx, t.id, nextStatus);
      const after = await tx.topic.update({
        where: { id: t.id },
        data: {
          weekNumber: dto.weekNumber,
          title: dto.title,
          ...(dto.blurb !== undefined ? { blurb: dto.blurb } : {}),
          startsOn: newStart,
          endsOn: newEnd,
          ...(dto.sensitive !== undefined ? { sensitive: dto.sensitive } : {}),
          ...(dto.whatNextPrompt !== undefined
            ? { whatNextPrompt: dto.whatNextPrompt }
            : {}),
          status: nextStatus,
        },
      });
      await writeAudit(tx, {
        actorId,
        action: deltaDays !== 0 ? "topic.move" : "topic.update",
        targetType: "Topic",
        targetId: t.id,
        before: this.topicSnap(t),
        after: { ...this.topicSnap(after), moved: moves },
      });
    });
    // C2.1-COST: a move of the topic shifts its questions' dates; the list of unreadable questions is dropped.
    invalidateUnreadableQuestions();
    return this.topicDetail(this.prisma, id);
  }

  // ---------------------------------------------------------------- questions

  private async resolveQuestion(
    tx: Tx,
    dto: UpsertQuestionDto,
    existing: Prisma.QuestionGetPayload<object> | null,
  ) {
    const issues: FieldIssue[] = [];
    if (!dto.kind)
      throw invalid({ path: "kind", message: "Choose the kind of question." });
    if (dto.kind === "OVERRIDE")
      throw invalid({
        path: "kind",
        message:
          "Use Override the day to put something up in place of a question.",
      });
    const topicId =
      dto.topicId ??
      (existing && dto.topicId === undefined ? existing.topicId : null);
    const topic = topicId
      ? await tx.topic.findUnique({ where: { id: topicId } })
      : null;
    if (topicId && !topic)
      issues.push({ path: "topicId", message: "That week does not exist." });
    if (dto.categoryId) {
      const c = await tx.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true },
      });
      if (!c)
        issues.push({
          path: "categoryId",
          message: "That category does not exist.",
        });
    }
    const isSpare = dto.isSpare ?? existing?.isSpare ?? false;
    const status = (dto.status ??
      existing?.status ??
      "DRAFT") as QuestionStatus;
    let slotIndex: number | null = null;
    let scheduledFor: Date | null = null;
    let startsAt: Date | null = dto.startsAt ? new Date(dto.startsAt) : null;
    let endsAt: Date | null = dto.endsAt ? new Date(dto.endsAt) : null;

    if (isSpare) {
      if (!topic)
        issues.push({
          path: "topicId",
          message: "A spare question belongs to a week.",
        });
      if (dto.slotIndex !== undefined)
        issues.push({
          path: "slotIndex",
          message: "A spare question has no day.",
        });
      if (dto.scheduledFor !== undefined)
        issues.push({
          path: "scheduledFor",
          message: "A spare question has no day.",
        });
    } else if (dto.kind === "DAILY" && topic) {
      if (dto.scheduledFor !== undefined && !isDateString(dto.scheduledFor))
        issues.push({
          path: "scheduledFor",
          message: "Use a real date, like 2026-11-12.",
        });
      else {
        let slot = dto.slotIndex;
        if (dto.scheduledFor !== undefined) {
          const diff = Math.round(
            (dateOnly(dto.scheduledFor).getTime() - topic.startsOn.getTime()) /
              DAY_MS,
          );
          if (diff < 0 || diff > 6)
            issues.push({
              path: "scheduledFor",
              message: "That day is outside the week.",
            });
          else if (slot !== undefined && slot !== diff + 1)
            issues.push({
              path: "slotIndex",
              message: "The day and the slot do not match.",
            });
          else slot = diff + 1;
        }
        if (
          slot === undefined &&
          existing &&
          existing.topicId === topic.id &&
          !existing.isSpare
        )
          slot = existing.slotIndex ?? undefined;
        if (slot !== undefined) {
          slotIndex = slot;
          scheduledFor = addDays(topic.startsOn, slot - 1);
          const taken = await tx.question.findFirst({
            where: {
              topicId: topic.id,
              isSpare: false,
              kind: { not: "OVERRIDE" },
              slotIndex: slot,
              id: existing ? { not: existing.id } : undefined,
            },
            select: { id: true },
          });
          if (taken)
            issues.push({
              path: "slotIndex",
              message: "That day already has a question.",
            });
          const day = dayString(scheduledFor);
          const moved =
            !existing ||
            existing.scheduledFor?.getTime() !== scheduledFor.getTime();
          if (!startsAt && (moved || !existing?.startsAt))
            startsAt = lagosDayStart(day);
          if (!endsAt && (moved || !existing?.endsAt))
            endsAt = lagosDayEnd(dayString(topic.endsOn));
        } else if (status !== "DRAFT") {
          issues.push({
            path: "status",
            message: "Give the question a day before it is scheduled.",
          });
        }
      }
    } else {
      // flash and follow-up questions, and daily questions with no week: no slot, an optional day
      if (dto.slotIndex !== undefined)
        issues.push({
          path: "slotIndex",
          message: "Only a daily question in a week has a slot.",
        });
      if (dto.scheduledFor !== undefined) {
        if (!isDateString(dto.scheduledFor))
          issues.push({
            path: "scheduledFor",
            message: "Use a real date, like 2026-11-12.",
          });
        else scheduledFor = dateOnly(dto.scheduledFor);
      } else if (existing) scheduledFor = existing.scheduledFor;
    }
    if (!startsAt && existing && !isSpare && !dto.startsAt)
      startsAt = existing.startsAt;
    if (!endsAt && existing && !isSpare && !dto.endsAt)
      endsAt = existing.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt)
      issues.push({
        path: "endsAt",
        message: "The end must be after the start.",
      });
    if (issues.length) throw invalid(...issues);
    return {
      topicId: topic?.id ?? null,
      topic,
      isSpare,
      status,
      slotIndex,
      scheduledFor,
      startsAt: isSpare ? null : startsAt,
      endsAt: isSpare ? null : endsAt,
    };
  }

  private async recount(tx: Tx, topicIds: (string | null)[]) {
    for (const id of new Set(topicIds.filter((x): x is string => !!x))) {
      const n = await tx.question.count({
        where: { topicId: id, kind: { not: "OVERRIDE" } },
      });
      await tx.topic.update({ where: { id }, data: { questionCount: n } });
    }
  }

  private qSnap(q: Prisma.QuestionGetPayload<object>): Json {
    return {
      topicId: q.topicId,
      categoryId: q.categoryId,
      kind: q.kind,
      status: q.status,
      text: q.text,
      hint: q.hint,
      scheduledFor: q.scheduledFor ? dayString(q.scheduledFor) : null,
      slotIndex: q.slotIndex,
      isSpare: q.isSpare,
      pinned: q.pinned,
      featured: q.featured,
      sensitive: q.sensitive,
      startsAt: q.startsAt?.toISOString() ?? null,
      endsAt: q.endsAt?.toISOString() ?? null,
    };
  }

  async createQuestion(actorId: string, dto: UpsertQuestionDto): Promise<Json> {
    if (dto.status === "LIVE" || dto.status === "CLOSED")
      throw invalid({
        path: "status",
        message: "A new question is a draft or scheduled.",
      });
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const r = await this.resolveQuestion(tx, dto, null);
      const pinned = dto.pinned ?? false;
      if (pinned && r.topicId)
        await tx.question.updateMany({
          where: { topicId: r.topicId, pinned: true },
          data: { pinned: false },
        });
      const q = await tx.question.create({
        data: {
          topicId: r.topicId,
          categoryId: dto.categoryId ?? null,
          kind: dto.kind as QuestionKind,
          status: r.status,
          text: dto.text,
          hint: dto.hint ?? null,
          scheduledFor: r.scheduledFor,
          slotIndex: r.slotIndex,
          isSpare: r.isSpare,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          pinned,
          featured: dto.featured ?? false,
          sensitive: dto.sensitive ?? r.topic?.sensitive ?? false,
          createdById: actorId,
        },
      });
      await this.recount(tx, [r.topicId]);
      await writeAudit(tx, {
        actorId,
        action: "question.create",
        targetType: "Question",
        targetId: q.id,
        after: this.qSnap(q),
      });
      return q;
    });
    invalidateUnreadableQuestions(); // C2.1-COST: a question's dates or status may have changed
    return this.views.adminQuestion(row);
  }

  async updateQuestion(
    actorId: string,
    id: string,
    dto: UpsertQuestionDto,
  ): Promise<Json> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const cur = await tx.question.findUnique({ where: { id } });
      if (!cur) throw notFound("that question");
      if (cur.kind === "OVERRIDE")
        throw invalid({
          path: "kind",
          message: "An override is changed on the Override the day screen.",
        });
      // Left out, the kind stays what it is (a FLASH question edited in the calendar stays FLASH).
      dto.kind ??= cur.kind;
      if (
        cur.status === "CLOSED" &&
        dto.status !== undefined &&
        dto.status !== "CLOSED"
      )
        throw invalid({
          path: "status",
          message: "A closed question cannot be opened again.",
        });
      if (
        dto.status === "DRAFT" &&
        (cur.status === "LIVE" || cur.status === "CLOSED")
      )
        throw invalid({
          path: "status",
          message: "A question that has started cannot go back to a draft.",
        });
      const r = await this.resolveQuestion(tx, dto, cur);
      let endsAt = r.endsAt;
      if (r.status === "CLOSED" && cur.status !== "CLOSED") {
        const now = new Date();
        if (!endsAt || endsAt > now) endsAt = now;
      }
      const pinned = dto.pinned ?? cur.pinned;
      if (pinned && !cur.pinned && r.topicId)
        await tx.question.updateMany({
          where: { topicId: r.topicId, pinned: true, id: { not: id } },
          data: { pinned: false },
        });
      const q = await tx.question.update({
        where: { id },
        data: {
          topicId: r.topicId,
          ...(dto.categoryId !== undefined
            ? { categoryId: dto.categoryId }
            : {}),
          kind: dto.kind as QuestionKind,
          status: r.status,
          text: dto.text,
          ...(dto.hint !== undefined ? { hint: dto.hint } : {}),
          scheduledFor: r.scheduledFor,
          slotIndex: r.slotIndex,
          isSpare: r.isSpare,
          startsAt: r.startsAt,
          endsAt: r.isSpare ? null : endsAt,
          pinned,
          ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
          ...(dto.sensitive !== undefined ? { sensitive: dto.sensitive } : {}),
        },
      });
      await this.recount(tx, [cur.topicId, r.topicId]);
      await writeAudit(tx, {
        actorId,
        action: "question.update",
        targetType: "Question",
        targetId: id,
        before: this.qSnap(cur),
        after: this.qSnap(q),
      });
      return q;
    });
    invalidateUnreadableQuestions(); // C2.1-COST: a question's dates or status may have changed
    return this.views.adminQuestion(row);
  }

  /**
   * lead ruling WF, 6 Nov (RW6, C-M4): put a scheduled daily question on another day of its own week. A free day is a
   * plain move; a taken day swaps the two questions in the same transaction, under the calendar lock, so any number of
   * parallel swaps leaves each day with exactly one question. Outside the week is refused.
   */
  async moveQuestion(actorId: string, id: string, day: string): Promise<Json> {
    if (!isDateString(day))
      throw invalid({
        path: "day",
        message: "Use a real date, like 2026-11-12.",
      });
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const cur = await tx.question.findUnique({ where: { id } });
      if (!cur) throw notFound("that question");
      if (
        cur.kind !== "DAILY" ||
        cur.isSpare ||
        !cur.topicId ||
        cur.slotIndex === null
      )
        throw invalid({
          path: "day",
          message: "Only a question that has a day in a week can move.",
        });
      const topic = await tx.topic.findUniqueOrThrow({
        where: { id: cur.topicId },
      });
      const diff = Math.round(
        (dateOnly(day).getTime() - topic.startsOn.getTime()) / DAY_MS,
      );
      if (diff < 0 || diff > 6)
        throw invalid({
          path: "day",
          message: "That day is outside the week.",
        });
      const slot = diff + 1;
      if (slot === cur.slotIndex)
        return { moved: cur, swapped: null, changed: false };
      const now = new Date();
      const started = (q: { status: string; startsAt: Date | null }) =>
        q.status === "LIVE" ||
        q.status === "CLOSED" ||
        (q.startsAt !== null && q.startsAt <= now);
      if (started(cur))
        throw conflict("A question that has started cannot move.");
      const other = await tx.question.findFirst({
        where: {
          topicId: topic.id,
          isSpare: false,
          kind: { not: "OVERRIDE" },
          slotIndex: slot,
          id: { not: id },
        },
      });
      if (other && started(other))
        throw conflict("That day’s question has started, so it cannot move.");
      if (!other && lagosDayStart(day) <= now)
        throw conflict("That day has already started.");
      const place = (q: Prisma.QuestionGetPayload<object>, s: number) => {
        const d = dayString(addDays(topic.startsOn, s - 1));
        return {
          slotIndex: s,
          scheduledFor: addDays(topic.startsOn, s - 1),
          startsAt: lagosDayStart(d),
          status: q.status,
        };
      };
      const moved = await tx.question.update({
        where: { id },
        data: place(cur, slot),
      });
      let swapped: Prisma.QuestionGetPayload<object> | null = null;
      if (other)
        swapped = await tx.question.update({
          where: { id: other.id },
          data: place(other, cur.slotIndex),
        });
      await writeAudit(tx, {
        actorId,
        action: other ? "question.swap" : "question.move",
        targetType: "Question",
        targetId: id,
        before: this.qSnap(cur),
        after: {
          ...this.qSnap(moved),
          ...(other ? { swappedWith: other.id } : {}),
        },
      });
      return { moved, swapped, changed: true };
    });
    invalidateUnreadableQuestions(); // C2.1-COST: a move changes dates
    return {
      question: this.views.adminQuestion(out.moved),
      swappedWith: out.swapped ? this.views.adminQuestion(out.swapped) : null,
    };
  }

  // ---------------------------------------------------------------- polls

  private async resolvePoll(
    tx: Tx,
    dto: UpsertPollDto,
    exceptId: string | null,
  ) {
    const issues: FieldIssue[] = [];
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      issues.push({
        path: "endsAt",
        message: "The poll must close after it opens.",
      });
    if (endsAt <= new Date())
      issues.push({
        path: "endsAt",
        message: "The poll must close in the future.",
      });
    const labels = dto.options.map((o) => o.trim());
    if (labels.some((l) => l.length === 0))
      issues.push({ path: "options", message: "Every option needs words." });
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length)
      issues.push({
        path: "options",
        message: "Two options say the same thing.",
      });
    const kind = dto.kind as PollKind;
    let topicId: string | null = null;
    let questionId: string | null = null;
    if (dto.topicId) {
      const t = await tx.topic.findUnique({
        where: { id: dto.topicId },
        select: { id: true },
      });
      if (!t)
        issues.push({ path: "topicId", message: "That week does not exist." });
      else topicId = t.id;
    }
    if (dto.questionId) {
      const qu = await tx.question.findUnique({
        where: { id: dto.questionId },
        select: { id: true, topicId: true },
      });
      if (!qu)
        issues.push({
          path: "questionId",
          message: "That question does not exist.",
        });
      else {
        questionId = qu.id;
        if (!topicId && kind !== "FLASH") topicId = qu.topicId;
      }
    }
    if (kind === "WEEKLY") {
      if (!topicId)
        issues.push({
          path: "topicId",
          message: "A weekly poll belongs to a week.",
        });
      else {
        const dup = await tx.poll.findFirst({
          where: {
            topicId,
            kind: "WEEKLY",
            id: exceptId ? { not: exceptId } : undefined,
          },
          select: { id: true },
        });
        if (dup)
          issues.push({
            path: "kind",
            message: "This week already has a poll.",
          });
      }
    }
    if (kind === "QUESTION") {
      if (!questionId)
        issues.push({
          path: "questionId",
          message: "A question poll belongs to a question.",
        });
      else {
        const dup = await tx.poll.findFirst({
          where: {
            questionId,
            kind: "QUESTION",
            id: exceptId ? { not: exceptId } : undefined,
          },
          select: { id: true },
        });
        if (dup)
          issues.push({
            path: "kind",
            message: "This question already has a poll.",
          });
      }
    }
    if (issues.length) throw invalid(...issues);
    return { startsAt, endsAt, labels, kind, topicId, questionId };
  }

  async createPoll(actorId: string, dto: UpsertPollDto): Promise<Json> {
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const r = await this.resolvePoll(tx, dto, null);
      // lead ruling WF fix round 1 (F3): one flash poll open at a time. The calendar lock above makes two parallel
      // opens run one after the other, so the second sees the first.
      if (r.kind === "FLASH") {
        const open = await tx.poll.findFirst({
          where: {
            kind: "FLASH",
            status: { in: ["SCHEDULED", "OPEN"] },
            endsAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (open) throw conflict("A flash poll is already open.");
      }
      const p = await tx.poll.create({
        data: {
          topicId: r.topicId,
          questionId: r.questionId,
          kind: r.kind,
          title: dto.title,
          choiceMode: dto.choiceMode as "SINGLE" | "MULTIPLE",
          publicInterest: dto.publicInterest ?? false,
          status: r.startsAt > new Date() ? "SCHEDULED" : "OPEN",
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          showLiveResults: dto.showLiveResults ?? true,
          createdById: actorId,
          options: {
            create: r.labels.map((label, i) => ({ label, sortOrder: i + 1 })),
          },
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "poll.create",
        targetType: "Poll",
        targetId: p.id,
        after: {
          kind: p.kind,
          title: p.title,
          options: r.labels,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          topicId: p.topicId,
          questionId: p.questionId,
        },
      });
      return p.id;
    });
    // After the commit and off the request: tell everyone who allows flash alerts (F3). A failure is logged, never
    // thrown into the admin's request; the dedupe key makes a rerun harmless.
    if (dto.kind === "FLASH")
      void this.announceFlash(id).catch((e) =>
        this.logger.error(`flash poll alert failed: ${String(e)}`),
      );
    return this.pollOut(id);
  }

  private readonly logger = new Logger(TopicsAdminService.name);

  /**
   * One FLASH_POLL notification per person per poll, for people who switched flash alerts on and whose account is
   * active (not suspended, banned, deleting or deleted). Inserted in chunks of 500; groupKey `flash:<pollId>` is unique
   * per person, so running it twice adds nothing. Returns how many rows this run wrote.
   */
  async announceFlash(pollId: string): Promise<number> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { id: true, title: true },
    });
    if (!poll) return 0;
    let after: string | undefined;
    let sent = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          deletionRequestedAt: null,
          settings: { is: { notifyFlashPolls: true } },
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (users.length === 0) return sent;
      const res = await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: "FLASH_POLL" as const,
          title: "A flash poll is open",
          body: poll.title,
          targetType: "poll",
          targetId: poll.id,
          groupKey: `flash:${poll.id}`,
        })),
        skipDuplicates: true,
      });
      sent += res.count;
      after = users[users.length - 1].id;
      if (users.length < 500) return sent;
    }
  }

  private lastFlashSweep = 0;

  /**
   * WF-5: a process death mid-announce leaves the rest of the people unnotified. Every few minutes, run announceFlash
   * again for each flash poll still open; groupKey `flash:<pollId>` with skipDuplicates makes it add only what is
   * missing. Returns how many rows it wrote (0 when throttled or nothing was missing).
   */
  async reannounceOpenFlash(
    now = new Date(),
    everyMs = 5 * 60_000,
  ): Promise<number> {
    if (now.getTime() - this.lastFlashSweep < everyMs) return 0;
    this.lastFlashSweep = now.getTime();
    const open = await this.prisma.poll.findMany({
      where: {
        kind: "FLASH",
        status: { in: ["SCHEDULED", "OPEN"] },
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true },
    });
    let sent = 0;
    for (const p of open) sent += await this.announceFlash(p.id);
    return sent;
  }

  private async pollOut(id: string): Promise<Json> {
    const p = await this.prisma.poll.findUniqueOrThrow({
      where: { id },
      include: POLL_INCLUDE,
    });
    return this.views.poll(p);
  }

  async updatePoll(
    actorId: string,
    id: string,
    dto: UpsertPollDto,
  ): Promise<Json> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      // the row lock keeps a vote from landing while the options are replaced
      await tx.$queryRaw`SELECT id FROM "Poll" WHERE id = ${id} FOR UPDATE`;
      const cur = await tx.poll.findUnique({
        where: { id },
        include: POLL_INCLUDE,
      });
      if (!cur) throw notFound("that poll");
      const ended = cur.status === "CLOSED" || cur.endsAt <= new Date();
      if (ended)
        throw new ConflictException({
          code: "POLL_CLOSED",
          message: "This poll has closed and cannot change.",
        });
      if (
        cur.status !== "SCHEDULED" ||
        cur.startsAt <= new Date() ||
        cur.totalVotes > 0
      )
        throw conflict("This poll is already open and cannot change.");
      const r = await this.resolvePoll(tx, dto, id);
      await tx.pollOption.deleteMany({ where: { pollId: id } });
      const p = await tx.poll.update({
        where: { id },
        data: {
          topicId: r.topicId,
          questionId: r.questionId,
          kind: r.kind,
          title: dto.title,
          choiceMode: dto.choiceMode as "SINGLE" | "MULTIPLE",
          ...(dto.publicInterest !== undefined
            ? { publicInterest: dto.publicInterest }
            : {}),
          ...(dto.showLiveResults !== undefined
            ? { showLiveResults: dto.showLiveResults }
            : {}),
          status: r.startsAt > new Date() ? "SCHEDULED" : "OPEN",
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          options: {
            create: r.labels.map((label, i) => ({ label, sortOrder: i + 1 })),
          },
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "poll.update",
        targetType: "Poll",
        targetId: id,
        before: {
          kind: cur.kind,
          title: cur.title,
          options: cur.options.map((o) => o.label),
          startsAt: cur.startsAt,
          endsAt: cur.endsAt,
        },
        after: {
          kind: p.kind,
          title: p.title,
          options: r.labels,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
        },
      });
    });
    return this.pollOut(id);
  }

  // ---------------------------------------------------------------- What Next? editorial summary

  async saveSummary(
    actorId: string,
    topicId: string,
    dto: SummaryEditDto,
  ): Promise<Json> {
    const issues: FieldIssue[] = [];
    for (const k of [
      "mainView",
      "opposingView",
      "pollLine",
      "nextStepsLine",
    ] as const)
      if (NO_BAD_WORDS.test(dto[k]))
        issues.push({
          path: k,
          message: "Say “lean towards” or “split”, never that everyone agrees.",
        });
    if (issues.length) throw invalid(...issues);
    const row = await this.prisma.$transaction(async (tx) => {
      const t = await tx.topic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!t) throw notFound("that week");
      // One after the other: a transaction's connection runs one query at a time (C-L8).
      const voices = await tx.question.aggregate({
        where: { topicId },
        _sum: { answerCount: true },
      });
      const poll = await tx.poll.findFirst({
        where: { topicId, kind: "WEEKLY" },
        select: { totalVotes: true },
      });
      const cur = await tx.editorialSummary.findUnique({ where: { topicId } });
      // lead ruling WF, 6 Nov (RW1): "Based on N voices" counts top-level answers, voice or text.
      const basedOnVoices = voices._sum.answerCount ?? 0;
      const basedOnVotes = poll?.totalVotes ?? 0;
      const data = {
        mainView: dto.mainView,
        mainViewVoices: dto.mainViewVoices,
        opposingView: dto.opposingView,
        opposingViewVoices: dto.opposingViewVoices,
        pollLine: dto.pollLine,
        nextStepsLine: dto.nextStepsLine,
        basedOnVoices,
        basedOnVotes,
        reviewedById: dto.approve ? actorId : null,
        reviewedAt: dto.approve ? new Date() : null,
      };
      const next = cur
        ? await tx.editorialSummary.update({ where: { topicId }, data })
        : await tx.editorialSummary.create({
            data: { topicId, aiDrafted: false, ...data },
          });
      await writeAudit(tx, {
        actorId,
        action: dto.approve ? "summary.approve" : "summary.save",
        targetType: "EditorialSummary",
        targetId: topicId,
        before: cur
          ? {
              mainView: cur.mainView,
              opposingView: cur.opposingView,
              pollLine: cur.pollLine,
              nextStepsLine: cur.nextStepsLine,
              reviewed: !!cur.reviewedById,
            }
          : null,
        after: {
          mainView: next.mainView,
          opposingView: next.opposingView,
          pollLine: next.pollLine,
          nextStepsLine: next.nextStepsLine,
          reviewed: !!next.reviewedById,
        },
      });
      return next;
    });
    return {
      topicId: row.topicId,
      mainView: row.mainView,
      mainViewVoices: row.mainViewVoices,
      opposingView: row.opposingView,
      opposingViewVoices: row.opposingViewVoices,
      pollLine: row.pollLine,
      nextStepsLine: row.nextStepsLine,
      basedOnVoices: row.basedOnVoices,
      basedOnVotes: row.basedOnVotes,
      updatedAt: row.updatedAt.toISOString(),
      reviewedByEditor: !!row.reviewedById,
    };
  }
}
