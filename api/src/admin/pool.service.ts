import { HttpException, Injectable } from "@nestjs/common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { cut, decodeCursor, olderThan, pageLimit } from "../me/paging";
import { UpsertQuestionDto } from "./dto";
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
  notFound,
  writeAudit,
  type Json,
} from "./support";
import { TopicsAdminService } from "./topics.service";
import { AdminViews } from "./views";

type Row = Prisma.QuestionGetPayload<object>;

/** The most pasted lines one call takes (V-42, bundle K). */
export const BULK_MAX = 50;

/**
 * The question pool (V-42): questions with no week and no day that an editor adds in bulk, edits, removes, puts on a
 * day or starts as a flash poll. Nothing in the pool is public: a question has no start time until it is on a day.
 */
@Injectable()
export class PoolAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: AdminViews,
    private readonly topics: TopicsAdminService,
  ) {}

  /**
   * What the pool is: a daily or flash question with no week, no day and not closed, that has not been started as a
   * flash poll (a started flash question is in use, not waiting).
   */
  static readonly POOL_WHERE: Prisma.QuestionWhereInput = {
    topicId: null,
    scheduledFor: null,
    status: { not: "CLOSED" },
    kind: { in: ["DAILY", "FLASH"] },
    isSpare: false,
    polls: { none: { kind: "FLASH" } },
  };

  async list(q: {
    cursor?: string;
    limit?: unknown;
    pool?: string;
  }): Promise<Json> {
    if (q.pool !== "1" && q.pool !== "true")
      throw invalid({
        path: "pool",
        message: "Add pool=1 to list the question pool.",
      });
    const limit = pageLimit(q.limit);
    const after = decodeCursor(q.cursor);
    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({
        where: { ...PoolAdminService.POOL_WHERE, ...olderThan(after) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
      this.prisma.question.count({ where: PoolAdminService.POOL_WHERE }),
    ]);
    const page = cut(rows, limit, (r) => r.createdAt);
    return {
      items: page.items.map((r) => this.views.adminQuestion(r)),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /** Words for one refused line, in plain terms an editor can act on. */
  private async lineProblem(
    text: string,
    kind: string,
    categoryId?: string,
  ): Promise<string | null> {
    const dto = plainToInstance(UpsertQuestionDto, { kind, text, categoryId });
    const errs = await validate(dto, { whitelist: true });
    if (errs.length === 0) return null;
    const t = typeof dto.text === "string" ? dto.text : "";
    if (t.length < 3) return "Too short. Use at least 3 characters.";
    if (t.length > 400) return "Too long. Use 400 characters or fewer.";
    return "Remove the special characters from this line.";
  }

  /**
   * Many questions at once, each under the same rules as one POST /admin/questions (the same service call, so the same
   * checks, audit row and calendar lock). A refused line is named by its line number and the good ones are kept.
   */
  async bulk(
    actorId: string,
    kind: string,
    categoryId: string | undefined,
    lines: string[],
  ): Promise<Json> {
    const filled = lines.filter((l) => l.trim().length > 0).length;
    if (filled === 0)
      throw invalid({ path: "lines", message: "Add at least one question." });
    if (filled > BULK_MAX)
      throw invalid({
        path: "lines",
        message: `Add up to ${BULK_MAX} questions at a time. You sent ${filled}.`,
      });
    if (categoryId) {
      const c = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!c)
        throw invalid({
          path: "categoryId",
          message: "That category does not exist.",
        });
    }
    const items: Json[] = [];
    let created = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].trim();
      if (!text) continue; // a blank line is skipped, but still counts for the numbering
      const line = i + 1;
      const problem = await this.lineProblem(text, kind, categoryId);
      if (problem) {
        items.push({ line, text, question: null, error: problem });
        continue;
      }
      try {
        const question = await this.topics.createQuestion(actorId, {
          kind,
          text,
          categoryId,
        });
        created++;
        items.push({ line, text, question, error: null });
      } catch (e) {
        if (!(e instanceof HttpException) || e.getStatus() >= 500) throw e;
        items.push({
          line,
          text,
          question: null,
          error: "This line could not be saved.",
        });
      }
    }
    return { created, refused: items.length - created, items };
  }

  /**
   * Put a pool question on a day (V-42). It joins the week whose dates hold that day. A free day takes it at once. A
   * taken day is refused (409 DAY_TAKEN, naming the question there) until the editor confirms with replace: true; then
   * the two swap, as a move does, and the old question goes to the pool. One calendar lock, one transaction.
   */
  async schedule(
    actorId: string,
    id: string,
    day: string,
    replace: boolean,
  ): Promise<Json> {
    if (!isDateString(day))
      throw invalid({
        path: "day",
        message: "Use a real date, like 2026-11-12.",
      });
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const cur = await tx.question.findUnique({ where: { id } });
      if (!cur) throw notFound("that question");
      const inPool =
        cur.topicId === null &&
        cur.scheduledFor === null &&
        cur.status !== "CLOSED" &&
        !cur.isSpare;
      if (!inPool)
        throw invalid({
          path: "day",
          message: "Only a question in the pool can be put on a day.",
        });
      if (cur.kind !== "DAILY")
        throw invalid({
          path: "day",
          message:
            "Only a daily question goes on a day. Change this one to Daily, or start it as a flash poll.",
        });
      const topic = await tx.topic.findFirst({
        where: {
          startsOn: { lte: dateOnly(day) },
          endsOn: { gte: dateOnly(day) },
        },
        orderBy: { weekNumber: "asc" },
      });
      if (!topic)
        throw invalid({
          path: "day",
          message:
            "There is no week on that day. Add the week in the calendar first.",
        });
      const slot =
        Math.round(
          (dateOnly(day).getTime() - topic.startsOn.getTime()) / 86_400_000,
        ) + 1;
      const now = new Date();
      const started = (q: { status: string; startsAt: Date | null }) =>
        q.status === "LIVE" ||
        q.status === "CLOSED" ||
        (q.startsAt !== null && q.startsAt <= now);
      const other = await tx.question.findFirst({
        where: {
          topicId: topic.id,
          isSpare: false,
          kind: { not: "OVERRIDE" },
          slotIndex: slot,
          id: { not: id },
        },
      });
      if (other) {
        if (started(other))
          throw conflict("That day's question has started, so it cannot move.");
        if (!replace)
          throw new HttpException(
            {
              code: "DAY_TAKEN",
              message:
                "That day already has a question. Confirm to swap it into the pool.",
              details: { question: this.views.adminQuestion(other) },
            },
            409,
          );
      } else if (lagosDayStart(day) <= now) {
        throw conflict("That day has already started.");
      }
      const date = addDays(topic.startsOn, slot - 1);
      if (cur.pinned)
        await tx.question.updateMany({
          where: { topicId: topic.id, pinned: true, id: { not: id } },
          data: { pinned: false },
        });
      const placed = await tx.question.update({
        where: { id },
        data: {
          topicId: topic.id,
          slotIndex: slot,
          scheduledFor: date,
          isSpare: false,
          status: cur.status === "DRAFT" ? "SCHEDULED" : cur.status,
          startsAt: lagosDayStart(dayString(date)),
          endsAt: lagosDayEnd(dayString(topic.endsOn)),
        },
      });
      let displaced: Row | null = null;
      if (other) {
        displaced = await tx.question.update({
          where: { id: other.id },
          data: {
            topicId: null,
            slotIndex: null,
            scheduledFor: null,
            startsAt: null,
            endsAt: null,
            pinned: false,
            status: other.status === "SCHEDULED" ? "DRAFT" : other.status,
          },
        });
      }
      const count = await tx.question.count({
        where: { topicId: topic.id, kind: { not: "OVERRIDE" } },
      });
      await tx.topic.update({
        where: { id: topic.id },
        data: { questionCount: count },
      });
      await writeAudit(tx, {
        actorId,
        action: other ? "question.swap" : "question.schedule",
        targetType: "Question",
        targetId: id,
        before: { topicId: null, day: null, status: cur.status },
        after: {
          topicId: topic.id,
          day: dayString(date),
          status: placed.status,
          ...(other ? { replaced: other.id } : {}),
        },
      });
      if (displaced)
        await writeAudit(tx, {
          actorId,
          action: "question.unschedule",
          targetType: "Question",
          targetId: displaced.id,
          before: { topicId: topic.id, day: dayString(date) },
          after: { topicId: null, day: null, status: displaced.status },
        });
      return { placed, displaced };
    });
    return {
      question: this.views.adminQuestion(out.placed),
      swappedWith: out.displaced
        ? this.views.adminQuestion(out.displaced)
        : null,
    };
  }
}
