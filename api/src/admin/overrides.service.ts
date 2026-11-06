import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { cut, decodeCursor, olderThan, pageLimit } from "../me/paging";
import type { CreateOverrideDto } from "./dto";
import {
  CALENDAR_LOCK,
  addDays,
  conflict,
  dayString,
  invalid,
  lagosDayString,
  notFound,
  writeAudit,
  type FieldIssue,
  type Json,
} from "./support";
import { AdminViews } from "./views";

type Tx = Prisma.TransactionClient;
type QuestionRow = Prisma.QuestionGetPayload<object>;
type OverrideRow = Prisma.OverrideGetPayload<object>;

const DAY_MS = 86_400_000;
const MIN_MS = 10 * 60_000;
const MAX_MS = 7 * DAY_MS;

interface QState {
  slotIndex: number | null;
  scheduledFor: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isSpare: boolean;
  pinned: boolean;
  status: string;
}
interface Move {
  id: string;
  before: QState;
  after: QState;
}

const stateOf = (q: QuestionRow): QState => ({
  slotIndex: q.slotIndex,
  scheduledFor: q.scheduledFor ? dayString(q.scheduledFor) : null,
  startsAt: q.startsAt?.toISOString() ?? null,
  endsAt: q.endsAt?.toISOString() ?? null,
  isSpare: q.isSpare,
  pinned: q.pinned,
  status: q.status,
});

/** "9:00am" on the Lagos clock. */
function lagosClock(d: Date): string {
  const l = new Date(d.getTime() + 3_600_000);
  const h = l.getUTCHours();
  const m = l.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/**
 * Override the day (addendum 4): content that stands in for the day's question for a window. The replaced question
 * moves to the next free slot and the rest of that week shifts one day (the one that would fall off the week becomes a
 * spare), or it is dropped to the spares. No other week is touched. Every override is logged with who, what, when and
 * what it replaced; cancelling it early puts the week back.
 */
@Injectable()
export class OverridesAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverridesAdminService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: AdminViews,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.ADMIN_JOBS === "off")
      return;
    this.timer = setInterval(() => {
      this.tick().catch((e) =>
        this.logger.error(`override tick failed: ${String(e)}`),
      );
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- views

  private effective(o: OverrideRow, now = new Date()): OverrideRow["status"] {
    if (o.status === "CANCELLED" || o.status === "ENDED") return o.status;
    if (o.endsAt <= now) return "ENDED";
    if (o.startsAt <= now) return "LIVE";
    return "SCHEDULED";
  }

  private resultText(o: OverrideRow, status: string): string | null {
    const hours = Math.round(
      (o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000,
    );
    if (status === "CANCELLED") {
      const at = o.cancelledAt ?? o.endedAt;
      if (!at || at <= o.startsAt) return "Cancelled before it went live";
      return `Ended early at ${lagosClock(at)}`;
    }
    if (status === "ENDED") {
      if (o.endedAt && o.endedAt.getTime() < o.endsAt.getTime() - 60_000)
        return `Ended early at ${lagosClock(o.endedAt)}`;
      return `Ran ${hours} hour${hours === 1 ? "" : "s"}`;
    }
    return null;
  }

  private async view(o: OverrideRow, now = new Date()): Promise<Json> {
    const [q, replaced, by] = await Promise.all([
      this.prisma.question.findUnique({ where: { id: o.questionId } }),
      o.replacedQuestionId
        ? this.prisma.question.findUnique({
            where: { id: o.replacedQuestionId },
          })
        : null,
      this.prisma.user.findUnique({
        where: { id: o.createdById },
        select: { handle: true, displayName: true },
      }),
    ]);
    const status = this.effective(o, now);
    return {
      headline: q?.text ?? null,
      id: o.id,
      status,
      contentKind: o.contentKind,
      body: o.body,
      linkUrl: o.linkUrl,
      imageUrl: null,
      audioUrl: null,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      emergency: o.emergency,
      notifyAlert: o.notifyAlert,
      keepWeeklyTheme: o.keepWeeklyTheme,
      dropReplaced: o.dropReplaced,
      replaced: replaced ? await this.views.questionCard(replaced) : null,
      questionId: o.questionId,
      by: by?.handle ?? o.createdById,
      // lead ruling WF, 6 Nov (C-M7): "Ngozi E." for the log; the handle stays in `by`.
      byName: shortName(by?.displayName, by?.handle),
      createdAt: o.createdAt.toISOString(),
      result: this.resultText(o, status),
    };
  }

  async list(cursor: string | undefined, limitRaw: unknown): Promise<Json> {
    const limit = pageLimit(limitRaw);
    const c = decodeCursor(cursor);
    const rows = await this.prisma.override.findMany({
      where: olderThan(c),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = cut(rows, limit, (r) => r.createdAt);
    const now = new Date();
    return {
      items: await Promise.all(page.items.map((o) => this.view(o, now))),
      nextCursor: page.nextCursor,
    };
  }

  // ---------------------------------------------------------------- planning

  private async validate(tx: Tx, dto: CreateOverrideDto, now: Date) {
    const issues: FieldIssue[] = [];
    let startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const emergency = dto.emergency ?? false;
    if (emergency) startsAt = now;
    else if (startsAt.getTime() < now.getTime() - 5 * 60_000)
      issues.push({
        path: "startsAt",
        message: "The start cannot be in the past.",
      });
    const span = endsAt.getTime() - startsAt.getTime();
    if (span < MIN_MS)
      issues.push({
        path: "endsAt",
        message:
          "An override runs at least 10 minutes and must end after it starts.",
      });
    else if (span > MAX_MS)
      issues.push({
        path: "endsAt",
        message: "An override runs 7 days at most.",
      });

    const headline = dto.headline?.trim() || undefined;
    const body = dto.body?.trim() || undefined;
    if (!headline && !body)
      issues.push({
        path: "headline",
        message: "Write a headline or a message.",
      });
    const kind = dto.contentKind;
    if (kind !== "VOICE" && dto.voiceClipId !== undefined)
      issues.push({
        path: "voiceClipId",
        message: "A voice note goes with the Voice type.",
      });
    if (kind !== "IMAGE" && dto.imageFileId !== undefined)
      issues.push({
        path: "imageFileId",
        message: "An image goes with the Image type.",
      });
    if (kind === "VOICE") {
      if (!dto.voiceClipId)
        issues.push({ path: "voiceClipId", message: "Add the voice note." });
      else {
        const clip = await tx.voiceClip.findUnique({
          where: { id: dto.voiceClipId },
        });
        if (
          !clip ||
          clip.purpose !== "OVERRIDE_NOTE" ||
          clip.status !== "READY" ||
          clip.removedAt
        )
          issues.push({
            path: "voiceClipId",
            message: "That voice note is not ready or is not an editor note.",
          });
      }
    }
    if (kind === "IMAGE") {
      if (!dto.imageFileId)
        issues.push({ path: "imageFileId", message: "Add the image." });
      else {
        const f = await tx.storedFile.findUnique({
          where: { id: dto.imageFileId },
        });
        if (!f || f.kind !== "OVERRIDE_IMAGE" || !f.confirmedAt)
          issues.push({
            path: "imageFileId",
            message: "That image was not uploaded.",
          });
      }
    }
    if (kind === "LINK" && !dto.linkUrl)
      issues.push({ path: "linkUrl", message: "Add the link." });
    if (dto.linkUrl) {
      let ok = false;
      try {
        const u = new URL(dto.linkUrl);
        ok = u.protocol === "https:" && u.hostname.includes(".");
      } catch {
        ok = false;
      }
      if (!ok)
        issues.push({ path: "linkUrl", message: "Use a full https link." });
    }
    if (issues.length) throw invalid(...issues);
    return { startsAt, endsAt, emergency, headline, body };
  }

  /** The question the override replaces, and how the week moves. Pure reads; nothing is written here. */
  private async plan(
    tx: Tx,
    startsAt: Date,
    dropReplaced: boolean,
    emergency = false,
  ) {
    const day = lagosDayString(startsAt);
    const replaced = await tx.question.findFirst({
      where: {
        kind: "DAILY",
        isSpare: false,
        scheduledFor: new Date(`${day}T00:00:00.000Z`),
        status: { in: ["SCHEDULED", "LIVE"] },
      },
      orderBy: [{ pinned: "desc" }, { slotIndex: "asc" }],
    });
    // lead ruling WF, 6 Nov (C-M7), fix round 1 (F2): the question to NAME in the log when the day has none of its own:
    // only for an emergency override, or a question that is LIVE at the start. It is for the log only: it never drives
    // the moves below, so a planned override on an empty day changes no other question.
    const named =
      replaced ??
      (!emergency && startsAt.getTime() > Date.now()
        ? null // a planned override for later names nothing it does not replace
        : await tx.question.findFirst({
            where: {
              kind: "DAILY",
              isSpare: false,
              status: emergency ? { in: ["SCHEDULED", "LIVE"] } : "LIVE",
              startsAt: { lte: startsAt },
              endsAt: { gt: startsAt },
            },
            orderBy: [{ scheduledFor: "desc" }, { slotIndex: "desc" }],
          }));
    const moves: {
      q: QuestionRow;
      data: Prisma.QuestionUpdateInput;
      after: QState;
    }[] = [];
    if (replaced && replaced.topicId && replaced.slotIndex !== null) {
      const spare = (q: QuestionRow): Prisma.QuestionUpdateInput => ({
        slotIndex: null,
        scheduledFor: null,
        startsAt: null,
        endsAt: null,
        isSpare: true,
        pinned: false,
        status: q.status === "LIVE" ? "SCHEDULED" : q.status,
      });
      const afterOf = (
        q: QuestionRow,
        d: Prisma.QuestionUpdateInput,
      ): QState => ({
        slotIndex:
          (d.slotIndex as number | null | undefined) ??
          (d.slotIndex === null ? null : q.slotIndex),
        scheduledFor:
          d.scheduledFor === null
            ? null
            : d.scheduledFor
              ? dayString(d.scheduledFor as Date)
              : q.scheduledFor
                ? dayString(q.scheduledFor)
                : null,
        startsAt:
          d.startsAt === null
            ? null
            : d.startsAt
              ? (d.startsAt as Date).toISOString()
              : (q.startsAt?.toISOString() ?? null),
        endsAt:
          d.endsAt === null
            ? null
            : d.endsAt
              ? (d.endsAt as Date).toISOString()
              : (q.endsAt?.toISOString() ?? null),
        isSpare: (d.isSpare as boolean | undefined) ?? q.isSpare,
        pinned: (d.pinned as boolean | undefined) ?? q.pinned,
        status: (d.status as string | undefined) ?? q.status,
      });
      if (dropReplaced) {
        const d = spare(replaced);
        moves.push({ q: replaced, data: d, after: afterOf(replaced, d) });
      } else {
        const week = await tx.question.findMany({
          where: {
            topicId: replaced.topicId,
            kind: "DAILY",
            isSpare: false,
            slotIndex: { gte: replaced.slotIndex },
            status: { in: ["DRAFT", "SCHEDULED", "LIVE"] },
          },
          orderBy: { slotIndex: "asc" },
        });
        for (const q of week) {
          const slot = (q.slotIndex as number) + 1;
          const d: Prisma.QuestionUpdateInput =
            slot > 7 || !q.scheduledFor
              ? spare(q)
              : {
                  slotIndex: slot,
                  scheduledFor: addDays(q.scheduledFor, 1),
                  startsAt: q.startsAt
                    ? new Date(q.startsAt.getTime() + DAY_MS)
                    : null,
                  status: q.status === "LIVE" ? "SCHEDULED" : q.status,
                };
          moves.push({ q, data: d, after: afterOf(q, d) });
        }
      }
    }
    return { day, replaced, named, moves };
  }

  async preview(dto: CreateOverrideDto): Promise<Json> {
    const now = new Date();
    const v = await this.validate(this.prisma, dto, now);
    const { day, replaced, named, moves } = await this.plan(
      this.prisma,
      v.startsAt,
      dto.dropReplaced ?? false,
      v.emergency,
    );
    const topicId =
      replaced?.topicId ?? (await this.topicOfDay(this.prisma, day));
    const rows = topicId
      ? await this.prisma.question.findMany({
          where: { topicId, kind: { not: "OVERRIDE" } },
          orderBy: [
            { slotIndex: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
          ],
        })
      : [];
    const byId = new Map(moves.map((m) => [m.q.id, m]));
    const after = rows.map((q) => {
      const m = byId.get(q.id);
      if (!m) return q;
      const a = m.after;
      return {
        ...q,
        slotIndex: a.slotIndex,
        isSpare: a.isSpare,
        status: a.status as QuestionRow["status"],
        scheduledFor: a.scheduledFor
          ? new Date(`${a.scheduledFor}T00:00:00.000Z`)
          : null,
      };
    });
    const sorted = after
      .filter((q) =>
        q.isSpare
          ? byId.has(q.id)
          : q.scheduledFor && dayString(q.scheduledFor) >= day,
      )
      .sort((a, b) => (a.slotIndex ?? 99) - (b.slotIndex ?? 99));
    return {
      replaced: named
        ? await this.views.questionCard(this.moved(named, byId.get(named.id)))
        : null,
      schedule: sorted.map((q) => this.views.adminQuestion(q)),
    };
  }

  private moved(q: QuestionRow, m: { after: QState } | undefined): QuestionRow {
    if (!m) return q;
    return {
      ...q,
      slotIndex: m.after.slotIndex,
      isSpare: m.after.isSpare,
      status: m.after.status as QuestionRow["status"],
      scheduledFor: m.after.scheduledFor
        ? new Date(`${m.after.scheduledFor}T00:00:00.000Z`)
        : null,
    };
  }

  private async topicOfDay(
    db: Tx | PrismaService,
    day: string,
  ): Promise<string | null> {
    const d = new Date(`${day}T00:00:00.000Z`);
    const t = await db.topic.findFirst({
      where: { startsOn: { lte: d }, endsOn: { gte: d } },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  // ---------------------------------------------------------------- create and cancel

  async create(actorId: string, dto: CreateOverrideDto): Promise<Json> {
    const now = new Date();
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const v = await this.validate(tx, dto, now);
      const clash = await tx.override.findFirst({
        where: {
          status: { in: ["SCHEDULED", "LIVE"] },
          startsAt: { lt: v.endsAt },
          endsAt: { gt: v.startsAt },
          cancelledAt: null,
        },
        select: { id: true },
      });
      if (clash)
        throw conflict("Another override already covers part of that time.");
      const keepTheme = dto.keepWeeklyTheme ?? true;
      const drop = dto.dropReplaced ?? false;
      const { day, replaced, named, moves } = await this.plan(
        tx,
        v.startsAt,
        drop,
        v.emergency,
      );
      const topicId = keepTheme
        ? (replaced?.topicId ?? (await this.topicOfDay(tx, day)))
        : null;
      const live = v.startsAt <= now && v.endsAt > now;
      const text = v.headline ?? (v.body as string).slice(0, 120);
      const q = await tx.question.create({
        data: {
          topicId,
          kind: "OVERRIDE",
          status: live ? "LIVE" : "SCHEDULED",
          text,
          scheduledFor: new Date(`${day}T00:00:00.000Z`),
          startsAt: v.startsAt,
          endsAt: v.endsAt,
          createdById: actorId,
        },
      });
      // The image is already confirmed (checked above); this takes its row lock and clears any purge mark (privacy fix PF2).
      if (dto.imageFileId) {
        const claimed = await tx.storedFile.updateMany({
          where: {
            id: dto.imageFileId,
            kind: "OVERRIDE_IMAGE",
            purgedAt: null,
            confirmedAt: { not: null },
          },
          data: { purgeRequestedAt: null },
        });
        // 0 rows: the file was purged between the check and here. Refuse, as the other attach points do.
        if (claimed.count !== 1)
          throw invalid({
            path: "imageFileId",
            message: "That image was not found.",
          });
      }
      const o = await tx.override.create({
        data: {
          questionId: q.id,
          replacedQuestionId: named?.id ?? null,
          contentKind: dto.contentKind as OverrideRow["contentKind"],
          body: v.body ?? null,
          voiceClipId: dto.voiceClipId ?? null,
          imageFileId: dto.imageFileId ?? null,
          linkUrl: dto.linkUrl ?? null,
          startsAt: v.startsAt,
          endsAt: v.endsAt,
          status: live ? "LIVE" : "SCHEDULED",
          emergency: v.emergency,
          notifyAlert: dto.notifyAlert ?? false,
          keepWeeklyTheme: keepTheme,
          dropReplaced: drop,
          createdById: actorId,
        },
      });
      for (const m of moves)
        await tx.question.update({ where: { id: m.q.id }, data: m.data });
      if (topicId) {
        const n = await tx.question.count({
          where: { topicId, kind: { not: "OVERRIDE" } },
        });
        await tx.topic.update({
          where: { id: topicId },
          data: { questionCount: n },
        });
      }
      const logged: Move[] = moves.map((m) => ({
        id: m.q.id,
        before: stateOf(m.q),
        after: m.after,
      }));
      await writeAudit(tx, {
        actorId,
        action: "override.create",
        targetType: "Override",
        targetId: o.id,
        reason: dto.reason ?? null,
        before: named
          ? {
              replacedQuestionId: named.id,
              text: named.text,
              day,
              slotIndex: named.slotIndex,
            }
          : { replacedQuestionId: null },
        after: {
          questionId: q.id,
          headline: text,
          contentKind: o.contentKind,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
          emergency: o.emergency,
          notifyAlert: o.notifyAlert,
          keepWeeklyTheme: keepTheme,
          dropReplaced: drop,
          moves: logged,
        },
      });
      return { o, live };
    });
    if (out.live && out.o.notifyAlert)
      await this.announce(out.o.id).catch((e) =>
        this.logger.error(`override alert failed: ${String(e)}`),
      );
    const fresh = await this.prisma.override.findUniqueOrThrow({
      where: { id: out.o.id },
    });
    return this.view(fresh);
  }

  async cancel(actorId: string, id: string, reason: string): Promise<Json> {
    const now = new Date();
    const restored: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const o = await tx.override.findUnique({ where: { id } });
      if (!o) throw notFound("that override");
      const status = this.effective(o, now);
      if (status === "ENDED" || status === "CANCELLED")
        throw conflict("That override has already finished.");
      await tx.override.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          endedAt: status === "LIVE" ? now : null,
        },
      });
      await tx.question.update({
        where: { id: o.questionId },
        data: { status: "CLOSED", endsAt: now < o.endsAt ? now : o.endsAt },
      });
      // put the week back: undo each move whose question still sits where the override left it
      const made = await tx.auditLog.findFirst({
        where: {
          action: "override.create",
          targetType: "Override",
          targetId: id,
        },
        orderBy: { createdAt: "desc" },
      });
      const after = (made?.after ?? null) as { moves?: Move[] } | null;
      for (const m of after?.moves ?? []) {
        const q = await tx.question.findUnique({ where: { id: m.id } });
        if (!q) continue;
        const cur = stateOf(q);
        if (
          cur.slotIndex !== m.after.slotIndex ||
          cur.scheduledFor !== m.after.scheduledFor ||
          cur.isSpare !== m.after.isSpare
        )
          continue; // an editor moved it since: leave it alone
        await tx.question.update({
          where: { id: q.id },
          data: {
            slotIndex: m.before.slotIndex,
            scheduledFor: m.before.scheduledFor
              ? new Date(`${m.before.scheduledFor}T00:00:00.000Z`)
              : null,
            startsAt: m.before.startsAt ? new Date(m.before.startsAt) : null,
            endsAt: m.before.endsAt ? new Date(m.before.endsAt) : null,
            isSpare: m.before.isSpare,
            pinned: m.before.pinned,
            status: m.before.status as QuestionRow["status"],
          },
        });
        restored.push(q.id);
      }
      await writeAudit(tx, {
        actorId,
        action: "override.cancel",
        targetType: "Override",
        targetId: id,
        reason,
        before: { status, startsAt: o.startsAt, endsAt: o.endsAt },
        after: {
          status: "CANCELLED",
          cancelledAt: now,
          restoredQuestionIds: restored,
        },
      });
    });
    const fresh = await this.prisma.override.findUniqueOrThrow({
      where: { id },
    });
    return this.view(fresh);
  }

  // ---------------------------------------------------------------- the clock

  /** Starts and ends overrides on time and sends the in-app alert once. Safe to run twice (status guards). */
  async tick(now = new Date()): Promise<{ started: number; ended: number }> {
    let started = 0;
    let ended = 0;
    const toStart = await this.prisma.override.findMany({
      where: {
        status: "SCHEDULED",
        startsAt: { lte: now },
        endsAt: { gt: now },
        cancelledAt: null,
      },
    });
    for (const o of toStart) {
      const flipped = await this.prisma.override.updateMany({
        where: { id: o.id, status: "SCHEDULED" },
        data: { status: "LIVE" },
      });
      if (flipped.count === 0) continue;
      started++;
      await this.prisma.question.updateMany({
        where: { id: o.questionId, status: "SCHEDULED" },
        data: { status: "LIVE" },
      });
      if (o.notifyAlert) await this.announce(o.id);
    }
    const toEnd = await this.prisma.override.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        endsAt: { lte: now },
        cancelledAt: null,
      },
    });
    for (const o of toEnd) {
      const flipped = await this.prisma.override.updateMany({
        where: { id: o.id, status: { in: ["SCHEDULED", "LIVE"] } },
        data: { status: "ENDED", endedAt: o.endsAt },
      });
      if (flipped.count === 0) continue;
      ended++;
      await this.prisma.question.updateMany({
        where: { id: o.questionId, status: { in: ["SCHEDULED", "LIVE"] } },
        data: { status: "CLOSED" },
      });
    }
    return { started, ended };
  }

  /** One in-app alert per person per override (the dedupe key makes a second run harmless). */
  async announce(overrideId: string): Promise<number> {
    const o = await this.prisma.override.findUnique({
      where: { id: overrideId },
    });
    if (!o) return 0;
    const q = await this.prisma.question.findUnique({
      where: { id: o.questionId },
      select: { text: true },
    });
    let after: string | undefined;
    let sent = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          deletionRequestedAt: null,
          OR: [{ settings: null }, { settings: { notifyDailyQuestion: true } }],
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
          type: "OVERRIDE_ALERT" as const,
          title: q?.text ?? "A message from VOICES",
          body: o.body ?? null,
          targetType: "question",
          targetId: o.questionId,
          groupKey: `override:${o.id}`,
        })),
        skipDuplicates: true,
      });
      sent += res.count;
      after = users[users.length - 1].id;
      if (users.length < 500) return sent;
    }
  }

  /** The override in force right now, if any (used by Today). */
  async liveNow(now = new Date()): Promise<OverrideRow | null> {
    return this.prisma.override.findFirst({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        cancelledAt: null,
      },
      orderBy: { startsAt: "desc" },
    });
  }
}

/** "Ngozi Eze" -> "Ngozi E."; one word stays as it is; no display name falls back to the handle. */
export function shortName(
  displayName: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return handle ?? null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${[...parts[parts.length - 1]][0].toUpperCase()}.`;
}
