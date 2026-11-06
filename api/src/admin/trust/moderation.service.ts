import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import type {
  ModerationActionKind,
  ModerationQueue,
  ReportTargetType,
} from "../../generated/prisma/enums";
import type { CurrentMeInfo } from "../../me/me-context";
import { QUESTION_INCLUDE, Views } from "../../me/views";
import type { ObjectStore } from "../../media/object-store";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import {
  APPEALABLE_NOTICE,
  conflict,
  invalid,
  lockRow,
  notFound,
  suspensionTitle,
} from "./common";
import type { ModerationDecisionDto, ModerationListQuery } from "./dto";

export const ADMIN_MEDIA_STORE = Symbol("ADMIN_MEDIA_STORE");

const REASON_WORDS: Record<string, string> = {
  HATE_OR_HARASSMENT: "harassment",
  THREAT_OR_VIOLENCE: "threat",
  SCAM_OR_SPAM: "scam or spam",
  PERSONAL_DETAILS: "private information",
  MISLEADING_NEWS_TAG: "misleading news tag",
  ABOUT_ME: "this is about me",
  OTHER: "other",
};

const QUEUES: ModerationQueue[] = [
  "REPORTED",
  "SCREENED",
  "SENSITIVE",
  "PRIORITY",
  "APPEAL",
];

const STRIKE_ACTIONS: ModerationActionKind[] = [
  "WARN",
  "REMOVE_AND_WARN",
  "SUSPEND",
  "BAN",
];

interface Target {
  type: ReportTargetType;
  id: string;
  authorId: string | null;
  /** ContentStatus, ResultPostStatus or AccountStatus, as text. */
  status: string;
  kind: "VOICE" | "TEXT" | null;
  durationMs: number | null;
  listens: number;
  body: string | null;
  questionId: string | null;
  createdAt: Date;
  clip: {
    playKey: string | null;
    rawKey: string;
    status: string;
    transcript: string | null;
  } | null;
  screening: unknown;
  anonymous: boolean;
}

function mmss(ms: number | null): string {
  const s = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function screeningLines(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["notes", "flags", "lines"])
      if (Array.isArray(o[k]))
        return (o[k] as unknown[]).filter(
          (x): x is string => typeof x === "string",
        );
  }
  return [];
}

/** What a row is, for the admin list's label: a voice or text answer, or a voice or text reply. Other targets have none. */
function postKindOf(
  type: string,
  kind: string | null,
): "VOICE" | "TEXT" | "REPLY_VOICE" | "REPLY_TEXT" | null {
  if (kind !== "VOICE" && kind !== "TEXT") return null;
  if (type === "ANSWER") return kind;
  if (type === "REPLY") return kind === "VOICE" ? "REPLY_VOICE" : "REPLY_TEXT";
  return null;
}

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
    @Optional()
    @Inject(ADMIN_MEDIA_STORE)
    private readonly store: ObjectStore | null,
  ) {}

  // ---------------------------------------------------------------- reading targets

  private async targets(
    pairs: { type: ReportTargetType; id: string }[],
  ): Promise<Map<string, Target>> {
    const out = new Map<string, Target>();
    const ids = (t: ReportTargetType) =>
      pairs.filter((p) => p.type === t).map((p) => p.id);
    const clipSelect = {
      playKey: true,
      rawKey: true,
      status: true,
      durationMs: true,
      transcript: { select: { text: true } },
    } as const;
    const [answers, replies, proposals, results, users] = await Promise.all([
      ids("ANSWER").length
        ? this.prisma.answer.findMany({
            where: { id: { in: ids("ANSWER") } },
            include: { clip: { select: clipSelect } },
          })
        : [],
      ids("REPLY").length
        ? this.prisma.reply.findMany({
            where: { id: { in: ids("REPLY") } },
            include: {
              clip: { select: clipSelect },
              answer: { select: { questionId: true } },
            },
          })
        : [],
      ids("PROPOSAL").length
        ? this.prisma.proposal.findMany({
            where: { id: { in: ids("PROPOSAL") } },
            include: { clip: { select: clipSelect } },
          })
        : [],
      ids("RESULT_POST").length
        ? this.prisma.resultPost.findMany({
            where: { id: { in: ids("RESULT_POST") } },
          })
        : [],
      ids("USER").length
        ? this.prisma.user.findMany({ where: { id: { in: ids("USER") } } })
        : [],
    ]);
    const clipOf = (
      c: {
        playKey: string | null;
        rawKey: string;
        status: string;
        durationMs: number | null;
        transcript: { text: string | null } | null;
      } | null,
    ) =>
      c
        ? {
            playKey: c.playKey,
            rawKey: c.rawKey,
            status: c.status,
            transcript: c.transcript?.text ?? null,
          }
        : null;
    for (const a of answers)
      out.set(`ANSWER:${a.id}`, {
        type: "ANSWER",
        id: a.id,
        authorId: a.authorId,
        status: a.status,
        kind: a.clip ? "VOICE" : "TEXT",
        durationMs: a.clip?.durationMs ?? null,
        listens: a.listenCount,
        body: a.body,
        questionId: a.questionId,
        createdAt: a.createdAt,
        clip: clipOf(a.clip),
        screening: a.screening,
        anonymous: a.anonymous,
      });
    for (const r of replies)
      out.set(`REPLY:${r.id}`, {
        type: "REPLY",
        id: r.id,
        authorId: r.authorId,
        status: r.status,
        kind: r.clip ? "VOICE" : "TEXT",
        durationMs: r.clip?.durationMs ?? null,
        listens: 0,
        body: r.body,
        questionId: r.answer.questionId,
        createdAt: r.createdAt,
        clip: clipOf(r.clip),
        screening: r.screening,
        anonymous: false,
      });
    for (const p of proposals)
      out.set(`PROPOSAL:${p.id}`, {
        type: "PROPOSAL",
        id: p.id,
        authorId: p.authorId,
        status: p.status,
        kind: p.clip ? "VOICE" : "TEXT",
        durationMs: p.clip?.durationMs ?? null,
        listens: 0,
        body: p.body,
        questionId: p.questionId,
        createdAt: p.createdAt,
        clip: clipOf(p.clip),
        screening: p.screening,
        anonymous: false,
      });
    for (const r of results)
      out.set(`RESULT_POST:${r.id}`, {
        type: "RESULT_POST",
        id: r.id,
        authorId: r.authorId,
        status: r.status,
        kind: "TEXT",
        durationMs: null,
        listens: 0,
        body: `${r.pollingUnit}, ${r.ward}, ${r.lga}, ${r.state}: accredited ${r.accredited}, votes cast ${r.votesCast}, rejected ${r.rejected}`,
        questionId: null,
        createdAt: r.createdAt,
        clip: null,
        screening: null,
        anonymous: false,
      });
    for (const u of users)
      out.set(`USER:${u.id}`, {
        type: "USER",
        id: u.id,
        authorId: u.id,
        status: u.status,
        kind: null,
        durationMs: null,
        listens: 0,
        body: u.bio,
        questionId: null,
        createdAt: u.createdAt,
        clip: null,
        screening: null,
        anonymous: false,
      });
    return out;
  }

  private summary(
    item: {
      queue: ModerationQueue;
      reportCount: number;
      reasons: string[];
    },
    t: Target | undefined,
  ): string {
    const parts: string[] = [];
    if (item.queue === "APPEAL") parts.push("Appeal");
    else if (item.queue === "SCREENED") parts.push("Screening found something");
    else if (item.queue === "SENSITIVE") parts.push("Sensitive topic");
    else if (item.reportCount > 0)
      parts.push(
        `Reported ${item.reportCount} ${item.reportCount === 1 ? "time" : "times"}`,
      );
    if (item.queue === "PRIORITY") parts.push("Priority");
    if (t?.kind === "VOICE") parts.push(`voice ${mmss(t.durationMs)}`);
    else if (t?.kind === "TEXT") parts.push("text");
    if (t && t.listens > 0) parts.push(`${t.listens} listens`);
    return parts.join(" · ");
  }

  /** The text of the question each target answers, so a queue row can quote it without a detail call. */
  private async questionTexts(
    ts: (Target | undefined)[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(ts.flatMap((t) => (t?.questionId ? [t.questionId] : []))),
    ];
    if (!ids.length) return new Map();
    const rows = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      select: { id: true, text: true },
    });
    return new Map(rows.map((q) => [q.id, q.text]));
  }

  private itemView(
    i: Prisma.ModerationItemGetPayload<object>,
    t: Target | undefined,
    questionText: string | null = null,
  ) {
    return {
      id: i.id,
      queue: i.queue,
      targetType: i.targetType,
      targetId: i.targetId,
      reasons: i.reasons.map((r) => REASON_WORDS[r] ?? r.toLowerCase()),
      reportCount: i.reportCount,
      priority: i.priority,
      summary: this.summary(i, t),
      createdAt: i.createdAt.toISOString(),
      status: i.status,
      questionText,
      listenCount: t?.listens ?? 0,
      postKind: postKindOf(i.targetType, t?.kind ?? null),
    };
  }

  // ---------------------------------------------------------------- list

  async list(q: ModerationListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const status = (q.status ?? "OPEN") as "OPEN" | "RESOLVED";
    const rows = await this.prisma.moderationItem.findMany({
      where: {
        status,
        ...(q.queue ? { queue: q.queue as ModerationQueue } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { gt: new Date(cur.k) } },
                { createdAt: new Date(cur.k), id: { gt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const targets = await this.targets(
      slice.map((r) => ({ type: r.targetType, id: r.targetId })),
    );
    const qText = await this.questionTexts([...targets.values()]);
    const [grouped, oldest] = await Promise.all([
      this.prisma.moderationItem.groupBy({
        by: ["queue"],
        where: { status: "OPEN" },
        _count: { _all: true },
      }),
      this.prisma.moderationItem.findFirst({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    const counts: Record<string, number | string | null> = {};
    let open = 0;
    for (const queue of QUEUES) {
      const n = grouped.find((g) => g.queue === queue)?._count._all ?? 0;
      counts[queue] = n;
      open += n;
    }
    counts.open = open;
    counts.oldestOpenAt = oldest ? oldest.createdAt.toISOString() : null;
    const last = slice[slice.length - 1];
    return {
      items: slice.map((r) => {
        const t = targets.get(`${r.targetType}:${r.targetId}`);
        return this.itemView(
          r,
          t,
          t?.questionId ? (qText.get(t.questionId) ?? null) : null,
        );
      }),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
      counts,
    };
  }

  // ---------------------------------------------------------------- one item

  async get(itemId: string) {
    const item = await this.prisma.moderationItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw notFound("We could not find that item.");
    return this.detail(item);
  }

  private async detail(item: Prisma.ModerationItemGetPayload<object>) {
    const targets = await this.targets([
      { type: item.targetType, id: item.targetId },
    ]);
    const t = targets.get(`${item.targetType}:${item.targetId}`);
    const authorRow = t?.authorId
      ? await this.prisma.user.findUnique({
          where: { id: t.authorId },
          select: { id: true, handle: true, createdAt: true },
        })
      : null;
    let author: {
      id: string;
      handle: string;
      joinedAt: string;
      postCount: number;
      strikeCount: number;
    } | null = null;
    if (authorRow) {
      const [answers, replies, strikes] = await Promise.all([
        this.prisma.answer.count({
          where: { authorId: authorRow.id, deletedAt: null },
        }),
        this.prisma.reply.count({
          where: { authorId: authorRow.id, deletedAt: null },
        }),
        this.prisma.strike.count({ where: { userId: authorRow.id } }),
      ]);
      author = {
        id: authorRow.id,
        handle: authorRow.handle,
        joinedAt: authorRow.createdAt.toISOString(),
        postCount: answers + replies,
        strikeCount: strikes,
      };
    }
    // Context: the question the post answers.
    let context: Record<string, unknown> | null = null;
    if (t?.questionId) {
      const q = await this.prisma.question.findUnique({
        where: { id: t.questionId },
        include: QUESTION_INCLUDE,
      });
      if (q) {
        const [view] = await this.views.savedQuestions([q], {});
        context = { ...view, iSaved: false };
      }
    }
    // The listen link is for the team's moderation player only; it prefers the normalised file.
    let playUrl: string | null = null;
    const clip = t?.clip;
    if (
      this.store &&
      clip &&
      clip.status !== "REMOVED" &&
      clip.status !== "FAILED"
    ) {
      const key = clip.playKey ?? clip.rawKey;
      if (key) playUrl = (await this.store.signedGet(key)).url;
    }
    // The trail: reports (by reason), the decisions, appeals.
    const ours = authorRow
      ? await this.authorsItems(this.prisma, authorRow.id)
      : [];
    const [reports, actions, appeals] = await Promise.all([
      this.prisma.report.groupBy({
        by: ["reason"],
        where: { targetType: item.targetType, targetId: item.targetId },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      this.prisma.moderationAction.findMany({
        where: {
          // lead ruling WF, 6 Nov (C-M9): the account item shows the suspension taken from any of the person's posts,
          // and a post's item shows a suspension or ban taken on the account.
          OR: [
            { item: { targetType: item.targetType, targetId: item.targetId } },
            ...(authorRow
              ? [
                  item.targetType === "USER"
                    ? {
                        action: {
                          in: ["SUSPEND", "BAN"] as ModerationActionKind[],
                        },
                        item: { OR: ours },
                      }
                    : {
                        item: {
                          targetType: "USER" as const,
                          targetId: authorRow.id,
                        },
                      },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.appeal.findMany({
        where: { targetType: item.targetType, targetId: item.targetId },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const modIds = [...new Set(actions.map((a) => a.moderatorId))];
    const mods = modIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: modIds } },
          select: { id: true, handle: true },
        })
      : [];
    const handle = new Map(mods.map((m) => [m.id, `@${m.handle}`]));
    const audit: { at: string; text: string; by: string | null }[] = [];
    for (const r of reports)
      audit.push({
        at: (r._min.createdAt ?? item.createdAt).toISOString(),
        text: `reported by ${r._count._all} ${r._count._all === 1 ? "person" : "people"} (${REASON_WORDS[r.reason] ?? r.reason.toLowerCase()})`,
        by: null,
      });
    for (const a of actions)
      audit.push({
        at: a.createdAt.toISOString(),
        text: `${a.action.toLowerCase().replace(/_/g, " ")}: ${a.reason}`,
        by: handle.get(a.moderatorId) ?? null,
      });
    for (const a of appeals)
      audit.push({
        at: a.createdAt.toISOString(),
        text:
          a.status === "DECIDED"
            ? "the poster appealed (decided)"
            : "the poster appealed",
        by: null,
      });
    audit.sort((x, y) => x.at.localeCompare(y.at));
    const reportReasons = new Set(Object.keys(REASON_WORDS));
    return {
      listenCount: t?.listens ?? 0,
      item: this.itemView(
        item,
        t,
        context && typeof context.text === "string" ? context.text : null,
      ),
      author,
      content: t
        ? {
            type: t.type,
            id: t.id,
            kind: t.kind,
            body: t.body,
            status: t.status,
            anonymous: t.anonymous,
            createdAt: t.createdAt.toISOString(),
          }
        : null,
      transcript: t?.clip?.transcript ?? null,
      playUrl,
      // lead ruling WF, 6 Nov (RW2, C-H2): the moderator reads the poster's own words before deciding.
      appeals: appeals.map((a) => ({
        id: a.id,
        note: a.note,
        status: a.status as "OPEN" | "DECIDED",
        createdAt: a.createdAt.toISOString(),
      })),
      screening: [
        ...screeningLines(t?.screening),
        ...item.reasons.filter((r) => !reportReasons.has(r) && r !== "APPEAL"),
      ],
      context,
      audit,
    };
  }

  // ---------------------------------------------------------------- action

  /** Days a SUSPEND lasts: config `moderation.suspend_days`, 7 when unset. */
  private async suspendDays(): Promise<number> {
    const row = await this.prisma.configEntry.findUnique({
      where: { key: "moderation.suspend_days" },
    });
    return typeof row?.valueJson === "number" && row.valueJson > 0
      ? row.valueJson
      : 7;
  }

  async act(actor: CurrentMeInfo, itemId: string, dto: ModerationDecisionDto) {
    const action = dto.action as ModerationActionKind;
    const days = await this.suspendDays();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "ModerationItem", "id", itemId);
      const item = await tx.moderationItem.findUnique({
        where: { id: itemId },
      });
      if (!item) throw notFound("We could not find that item.");
      if (item.status === "RESOLVED" && action !== "RESTORE")
        throw conflict("Someone has already decided this item.");
      const tgt = await this.targetIn(tx, item.targetType, item.targetId);
      if (!tgt) throw notFound("That post is no longer there.");
      const authorId = tgt.authorId;
      if (tgt.status === "DELETED_BY_AUTHOR" && action !== "KEEP")
        throw conflict("The poster has already deleted this.");
      if (
        item.targetType === "USER" &&
        (action === "REMOVE" || action === "REMOVE_AND_WARN")
      )
        throw invalid("action", "There is nothing to remove on an account.");
      if (authorId) {
        if (authorId === actor.id && action !== "KEEP")
          throw new ForbiddenException({
            code: "FORBIDDEN",
            message: "You cannot moderate your own account.",
          });
        if (
          (action === "SUSPEND" || action === "BAN") &&
          !actor.roles.includes("ADMIN")
        ) {
          const staff = await tx.userRoleGrant.count({
            where: { userId: authorId },
          });
          if (staff > 0)
            throw new ForbiddenException({
              code: "FORBIDDEN",
              message: "Only an admin can suspend a member of the team.",
            });
        }
      }

      // Privacy fix P4: the person who took the action cannot decide its appeal. Another moderator or an admin must.
      const appealOpen = await tx.appeal.count({
        where: {
          targetType: item.targetType,
          targetId: item.targetId,
          status: "OPEN",
        },
      });
      if (appealOpen > 0) {
        // lead ruling WF, 6 Nov (C-H3): ANY action by this person that led to the appeal bars them, on any linked item:
        // the same post, the author's account item, and a suspension or ban taken from any of the author's posts.
        const mine = await this.actedOnLinked(
          tx,
          actor.id,
          item.targetType,
          item.targetId,
          authorId,
        );
        if (mine)
          throw new ForbiddenException({
            code: "FORBIDDEN",
            message: "Another moderator must decide this appeal.",
          });
      }

      const removeContent =
        action === "REMOVE" || action === "REMOVE_AND_WARN" || action === "BAN";
      const restoreContent =
        action === "RESTORE" || (action === "KEEP" && tgt.status === "HELD");
      let toStatus: string | null = null;
      if (item.targetType !== "USER") {
        if (removeContent && tgt.status !== "REMOVED") toStatus = "REMOVED";
        else if (
          restoreContent &&
          (tgt.status === "HELD" || tgt.status === "REMOVED")
        )
          toStatus =
            item.targetType === "RESULT_POST" ? "NOT_VERIFIED" : "PUBLISHED";
        if (toStatus) await this.setContentStatus(tx, tgt, toStatus);
      }

      const act = await tx.moderationAction.create({
        data: {
          itemId,
          moderatorId: actor.id,
          action,
          reason: dto.reason,
        },
      });
      if (authorId && STRIKE_ACTIONS.includes(action))
        await tx.strike.create({
          data: { userId: authorId, actionId: act.id, reason: dto.reason },
        });

      let accountAfter: string | null = null;
      let suspendedUntil: Date | null = null;
      if (authorId && (action === "SUSPEND" || action === "BAN")) {
        accountAfter = action === "BAN" ? "BANNED" : "SUSPENDED";
        suspendedUntil =
          action === "BAN" ? null : new Date(now.getTime() + days * 86_400_000);
        await tx.user.update({
          where: { id: authorId },
          data: {
            status: action === "BAN" ? "BANNED" : "SUSPENDED",
            suspendedUntil,
          },
        });
      }
      if (
        authorId &&
        action === "RESTORE" &&
        item.targetType === "USER" &&
        (tgt.status === "SUSPENDED" || tgt.status === "BANNED")
      ) {
        accountAfter = "ACTIVE";
        await tx.user.update({
          where: { id: authorId },
          data: { status: "ACTIVE", suspendedUntil: null },
        });
      }

      // The decision settles every open item and report on the same target.
      await tx.moderationItem.updateMany({
        where: {
          targetType: item.targetType,
          targetId: item.targetId,
          status: "OPEN",
        },
        data: { status: "RESOLVED", resolvedAt: now },
      });
      if (item.status === "RESOLVED" && action === "RESTORE")
        await tx.moderationItem.update({
          where: { id: itemId },
          data: { resolvedAt: now },
        });
      const kept = action === "KEEP" || action === "RESTORE";
      // lead ruling WF, 6 Nov (C-M9): an appeal is accepted only when, after this decision, the post is up or the
      // account is active. A "keep" that leaves a removed post down, or a suspended account suspended, upholds it.
      const afterLive =
        item.targetType === "USER"
          ? (accountAfter ?? tgt.status) === "ACTIVE"
          : !["REMOVED", "HELD"].includes(toStatus ?? tgt.status);
      const accepted = kept && afterLive;
      await tx.report.updateMany({
        where: {
          targetType: item.targetType,
          targetId: item.targetId,
          status: "OPEN",
        },
        data: { status: kept ? "DISMISSED" : "ACTIONED" },
      });
      const appeals = await tx.appeal.findMany({
        where: {
          targetType: item.targetType,
          targetId: item.targetId,
          status: "OPEN",
        },
        select: { id: true, userId: true },
      });
      if (appeals.length)
        await tx.appeal.updateMany({
          where: { id: { in: appeals.map((a) => a.id) } },
          data: { status: "DECIDED", decidedById: actor.id, decidedAt: now },
        });

      // lead ruling WF, 6 Nov (C-M9): an accepted appeal removes the strike it was about. For an appeal on the account
      // that is every suspension or ban strike; for a post it is the strikes taken on that post. If that was the last
      // suspension or ban strike and the account is still held, the account is released.
      let strikesRemoved = 0;
      if (authorId && accepted && appeals.length) {
        const removed = await tx.strike.findMany({
          where:
            item.targetType === "USER"
              ? {
                  userId: authorId,
                  action: { action: { in: ["SUSPEND", "BAN"] } },
                }
              : {
                  userId: authorId,
                  action: {
                    item: {
                      targetType: item.targetType,
                      targetId: item.targetId,
                    },
                  },
                },
          select: { id: true, action: { select: { action: true } } },
        });
        if (removed.length) {
          await tx.strike.deleteMany({
            where: { id: { in: removed.map((s) => s.id) } },
          });
          strikesRemoved = removed.length;
          const held = removed.some((s) =>
            ["SUSPEND", "BAN"].includes(s.action.action),
          );
          const stillHeld = await tx.strike.count({
            where: {
              userId: authorId,
              action: { action: { in: ["SUSPEND", "BAN"] } },
            },
          });
          if (held && stillHeld === 0 && !accountAfter) {
            const u = await tx.user.findUnique({
              where: { id: authorId },
              select: { status: true },
            });
            if (u && (u.status === "SUSPENDED" || u.status === "BANNED")) {
              accountAfter = "ACTIVE";
              await tx.user.update({
                where: { id: authorId },
                data: { status: "ACTIVE", suspendedUntil: null },
              });
            }
          }
        }
      }

      // The poster is told, with the reason, and can appeal.
      const notify = async (
        userId: string,
        title: string,
        appealable = false,
      ) => {
        await tx.notification.create({
          data: {
            userId,
            type: "MODERATION_NOTICE",
            title,
            body: dto.reason,
            targetType: item.targetType.toLowerCase(),
            targetId: item.targetId,
            // The "Appeal" action on the notice (RW2) is keyed on the decision that caused it.
            ...(appealable
              ? { groupKey: `${APPEALABLE_NOTICE}${action}:${act.id}` }
              : {}),
          },
        });
      };
      for (const a of appeals)
        await notify(
          a.userId,
          accepted
            ? strikesRemoved
              ? "Your appeal was accepted and the strike was removed"
              : "Your appeal was accepted"
            : "Your appeal was declined",
        );
      if (
        authorId &&
        action !== "KEEP" &&
        !appeals.some((a) => a.userId === authorId)
      ) {
        const title: Record<string, string> = {
          REMOVE: "A post of yours was taken down",
          REMOVE_AND_WARN: "A post of yours was taken down, with a warning",
          WARN: "A warning about a post of yours",
          SUSPEND: suspensionTitle(suspendedUntil),
          BAN: "Your account is closed",
          RESTORE: "A post of yours is back up",
        };
        await notify(
          authorId,
          title[action],
          ["REMOVE", "REMOVE_AND_WARN", "WARN", "SUSPEND", "BAN"].includes(
            action,
          ),
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "moderation.action",
          targetType: item.targetType.toLowerCase(),
          targetId: item.targetId,
          reason: dto.reason,
          before: { itemStatus: item.status, contentStatus: tgt.status },
          after: {
            action,
            itemId,
            contentStatus: toStatus ?? tgt.status,
            account: accountAfter,
            ...(suspendedUntil
              ? { suspendedUntil: suspendedUntil.toISOString() }
              : {}),
            ...(strikesRemoved ? { strikesRemoved } : {}),
          },
        },
      });
    });
    return this.get(itemId);
  }

  /**
   * Did this moderator take a decision (anything but KEEP) that is linked to an appeal on this target? Linked means: an
   * action on the same target; an action on the author's account item; a suspension or ban taken from any of the
   * author's posts; and, for an appeal on the account, any decision on any of the author's posts.
   */
  private async actedOnLinked(
    tx: Prisma.TransactionClient,
    moderatorId: string,
    targetType: ReportTargetType,
    targetId: string,
    authorId: string | null,
  ): Promise<boolean> {
    const base = {
      moderatorId,
      action: { not: "KEEP" as const },
    };
    const same = await tx.moderationAction.count({
      where: { ...base, item: { targetType, targetId } },
    });
    if (same > 0) return true;
    if (!authorId) return false;
    const ours = await this.authorsItems(tx, authorId);
    const accountLevel: ModerationActionKind[] = ["SUSPEND", "BAN"];
    const where: Prisma.ModerationActionWhereInput =
      targetType === "USER"
        ? { ...base, item: { OR: ours } }
        : {
            ...base,
            OR: [
              { item: { targetType: "USER", targetId: authorId } },
              { action: { in: accountLevel }, item: { OR: ours } },
            ],
          };
    return (await tx.moderationAction.count({ where })) > 0;
  }

  /** Item filters for everything that is the author's: their account and each of their posts. */
  private async authorsItems(
    tx: Prisma.TransactionClient | PrismaService,
    authorId: string,
  ): Promise<Prisma.ModerationItemWhereInput[]> {
    // One after the other: `tx` may be a transaction's connection (C-L8).
    const answers = await tx.answer.findMany({
      where: { authorId },
      select: { id: true },
    });
    const replies = await tx.reply.findMany({
      where: { authorId },
      select: { id: true },
    });
    const proposals = await tx.proposal.findMany({
      where: { authorId },
      select: { id: true },
    });
    const results = await tx.resultPost.findMany({
      where: { authorId },
      select: { id: true },
    });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    return [
      { targetType: "USER", targetId: authorId },
      { targetType: "ANSWER", targetId: { in: ids(answers) } },
      { targetType: "REPLY", targetId: { in: ids(replies) } },
      { targetType: "PROPOSAL", targetId: { in: ids(proposals) } },
      { targetType: "RESULT_POST", targetId: { in: ids(results) } },
    ];
  }

  private async targetIn(
    tx: Prisma.TransactionClient,
    type: ReportTargetType,
    id: string,
  ): Promise<{
    type: ReportTargetType;
    id: string;
    authorId: string | null;
    status: string;
    questionId: string | null;
    answerId: string | null;
    clipId: string | null;
    stance: string | null;
  } | null> {
    switch (type) {
      case "ANSWER": {
        const a = await tx.answer.findUnique({ where: { id } });
        return a
          ? {
              type,
              id,
              authorId: a.authorId,
              status: a.status,
              questionId: a.questionId,
              answerId: null,
              clipId: a.clipId,
              stance: null,
            }
          : null;
      }
      case "REPLY": {
        const r = await tx.reply.findUnique({ where: { id } });
        return r
          ? {
              type,
              id,
              authorId: r.authorId,
              status: r.status,
              questionId: null,
              answerId: r.answerId,
              clipId: r.clipId,
              stance: r.stance,
            }
          : null;
      }
      case "PROPOSAL": {
        const p = await tx.proposal.findUnique({ where: { id } });
        return p
          ? {
              type,
              id,
              authorId: p.authorId,
              status: p.status,
              questionId: p.questionId,
              answerId: null,
              clipId: p.clipId,
              stance: null,
            }
          : null;
      }
      case "RESULT_POST": {
        const r = await tx.resultPost.findUnique({ where: { id } });
        return r
          ? {
              type,
              id,
              authorId: r.authorId,
              status: r.status,
              questionId: null,
              answerId: null,
              clipId: null,
              stance: null,
            }
          : null;
      }
      case "USER": {
        const u = await tx.user.findUnique({ where: { id } });
        return u && u.status !== "DELETED"
          ? {
              type,
              id,
              authorId: u.id,
              status: u.status,
              questionId: null,
              answerId: null,
              clipId: null,
              stance: null,
            }
          : null;
      }
    }
  }

  /** Changes a post's status and keeps the stored counters in step with what people can see. */
  private async setContentStatus(
    tx: Prisma.TransactionClient,
    t: NonNullable<Awaited<ReturnType<ModerationService["targetIn"]>>>,
    to: string,
  ): Promise<void> {
    const wasLive = t.status === "PUBLISHED";
    const willLive = to === "PUBLISHED";
    const step = wasLive === willLive ? 0 : willLive ? 1 : -1;
    switch (t.type) {
      case "ANSWER": {
        const row = await tx.answer.update({
          where: { id: t.id },
          data: { status: to as "PUBLISHED" | "REMOVED" },
        });
        // The author's profile voice count: published, non-anonymous voice answers (talk keeps it on publish and delete).
        if (step && row.kind === "VOICE" && !row.anonymous)
          await tx.user.update({
            where: { id: row.authorId },
            data: { voiceCount: { increment: step } },
          });
        if (step && t.questionId)
          await tx.question.update({
            where: { id: t.questionId },
            data: {
              answerCount: { increment: step },
              ...(t.clipId ? { voiceCount: { increment: step } } : {}),
            },
          });
        break;
      }
      case "REPLY": {
        await tx.reply.update({
          where: { id: t.id },
          data: { status: to as "PUBLISHED" | "REMOVED" },
        });
        if (step && t.answerId) {
          const field = {
            AGREE: "agreeCount",
            DISAGREE: "disagreeCount",
            EXPERIENCE: "experienceCount",
          }[t.stance ?? "AGREE"] as
            "agreeCount" | "disagreeCount" | "experienceCount";
          await tx.answer.update({
            where: { id: t.answerId },
            data: {
              replyCount: { increment: step },
              [field]: { increment: step },
            },
          });
          if (t.authorId)
            await tx.user.update({
              where: { id: t.authorId },
              data: { replyCount: { increment: step } },
            });
        }
        break;
      }
      case "PROPOSAL":
        await tx.proposal.update({
          where: { id: t.id },
          data: { status: to as "PUBLISHED" | "REMOVED" },
        });
        break;
      case "RESULT_POST":
        await tx.resultPost.update({
          where: { id: t.id },
          data: { status: to as "NOT_VERIFIED" | "REMOVED" },
        });
        break;
      default:
        break;
    }
  }
}
