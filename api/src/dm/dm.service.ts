import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from "@nestjs/common";
import { hiddenUserIdsOf } from "../me/blocks";
import { PrismaService } from "../common/prisma/prisma.service";
import { ClipsService, type ClipRow } from "../media/clips.service";
import { cut, decodeCursor, pageLimit } from "../me/paging";
import type { Profile } from "../talk/shared/profile.service";
import { ConfigReader } from "../talk/shared/config-reader";
import { UnitsAccess } from "../talk/shared/units-access";
import { countChars, voiceTooLong } from "../units/text-price";
import type { ChargeAction, ChargeOpts } from "../units/units.port";
import type { Prisma } from "../generated/prisma/client";
import { canSendDm, verificationRequired } from "./dm-access";

/** The longest text message, in characters (docs/launch/PRICING.md: at most 5,000 a message). */
export const DM_MAX_CHARS = 5000;

export interface SendDmInput {
  toUserId: string;
  kind: "TEXT" | "VOICE";
  body?: string;
  clipId?: string;
}

const invalid = (path: string, message: string) =>
  new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields: [{ path, message }] },
  });

const gone = () =>
  new NotFoundException({
    code: "NOT_FOUND",
    message: "We could not find that.",
  });

const NEUTRAL = "You can't message this person.";
const blockedError = () =>
  new ForbiddenException({ code: "blocked", message: NEUTRAL });
const unavailableError = () =>
  new ForbiddenException({ code: "recipient_unavailable", message: NEUTRAL });

type MsgRow = Prisma.DmMessageGetPayload<{
  include: { clip: { select: { id: true; durationMs: true; peaks: true } } };
}>;
const MSG_INCLUDE = {
  clip: { select: { id: true, durationMs: true, peaks: true } },
} as const;

/** A member who cannot send or be sent to right now: banned, suspended (and not yet over), leaving or gone. */
function restrictedNow(
  u: { status: string; suspendedUntil: Date | null },
  now: Date,
): boolean {
  if (u.status === "ACTIVE") return false;
  if (u.status === "SUSPENDED")
    return !u.suspendedUntil || u.suspendedUntil > now;
  return true; // BANNED, DELETION_PENDING, DELETED
}

@Injectable()
export class DmService {
  private readonly logger = new Logger(DmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clips: ClipsService,
    private readonly units: UnitsAccess,
    private readonly config: ConfigReader,
  ) {}

  // ------------------------------------------------------------ views

  private view(m: MsgRow, meId: string) {
    const live = m.status === "PUBLISHED";
    const mine = m.senderId === meId;
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      mine,
      kind: m.kind,
      body: live ? m.body : null,
      clip:
        live && m.clip
          ? {
              id: m.clip.id,
              durationMs: m.clip.durationMs ?? m.durationMs,
              peaks: (m.clip.peaks as number[] | null) ?? null,
            }
          : null,
      status: m.status,
      ...(mine ? { costMilli: m.costMilli } : {}),
      readAt: mine && m.readAt ? m.readAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private person(u: {
    id: string;
    handle: string;
    displayName: string | null;
    status: string;
  }) {
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      deleted: u.status === "DELETED",
    };
  }

  private preview(m: MsgRow): string {
    if (m.status !== "PUBLISHED") return "Message removed";
    if (m.kind === "VOICE") {
      const s = Math.round((m.durationMs ?? m.clip?.durationMs ?? 0) / 1000);
      return `Voice message ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    const t = (m.body ?? "").replace(/\s+/g, " ").trim();
    const chars = [...t];
    return chars.length > 80 ? `${chars.slice(0, 80).join("")}...` : t;
  }

  // ------------------------------------------------------------ sending

  private async balanceOf(userId: string): Promise<number> {
    return (
      (await this.prisma.wallet.findUnique({ where: { userId } }))
        ?.balanceMilli ?? 0
    );
  }

  private async existing(senderId: string, key: string) {
    return this.prisma.dmMessage.findUnique({
      where: { senderId_idempotencyKey: { senderId, idempotencyKey: key } },
      include: MSG_INCLUDE,
    });
  }

  /** Everything is checked before anything is charged. A refused or failed send costs nothing. */
  async send(me: Profile, dto: SendDmInput, key: string) {
    const now = new Date();
    // A repeat of a send that was stored returns that send, whatever has changed since (the sender already paid).
    const prior = await this.existing(me.id, key);
    if (prior)
      return {
        message: this.view(prior, me.id),
        charge: {
          costMilli: prior.costMilli,
          balanceMilli: await this.balanceOf(me.id),
        },
      };

    if (dto.toUserId === me.id)
      throw invalid("toUserId", "You cannot message yourself.");
    if (!(await canSendDm(this.prisma, me.id, now)))
      throw verificationRequired();

    const to = await this.prisma.user.findUnique({
      where: { id: dto.toUserId },
      select: {
        id: true,
        status: true,
        suspendedUntil: true,
        settings: { select: { dmOpen: true } },
      },
    });
    if (!to || to.status === "DELETED") throw gone();
    if (await this.blockedEitherWay(me.id, to.id)) throw blockedError();
    if (restrictedNow(to, now)) throw unavailableError();
    if (to.settings && to.settings.dmOpen === false)
      throw new ForbiddenException({
        code: "dm_closed",
        message: "This person is not taking messages.",
      });

    // The content: text by characters, voice by its length.
    let body: string | null = null;
    let clip: ClipRow | null = null;
    let opts: ChargeOpts;
    let action: ChargeAction;
    if (dto.kind === "TEXT") {
      if (dto.clipId)
        throw invalid("clipId", "A text message has no recording.");
      const text = (dto.body ?? "").trim();
      if (!text) throw invalid("body", "Write something first.");
      const chars = countChars(text);
      if (chars > DM_MAX_CHARS)
        throw invalid("body", `Keep it to ${DM_MAX_CHARS} characters.`);
      body = text;
      action = "POST_TEXT";
      opts = { chars, noFree: true };
    } else {
      if (dto.body) throw invalid("body", "A voice message has no text.");
      if (!dto.clipId) throw invalid("clipId", "Choose your recording.");
      clip = await this.clips.forPublish(me, dto.clipId, "DM");
      const maxSeconds = await this.config.num("voice.extra60.max_seconds");
      const ms = clip.durationMs ?? 0;
      if (voiceTooLong(ms, maxSeconds))
        throw new UnprocessableEntityException({
          code: "VOICE_TOO_LONG",
          message: "That recording is too long.",
          details: { maxSeconds },
        });
      if (
        await this.prisma.dmMessage.findUnique({ where: { clipId: clip.id } })
      )
        throw new ConflictException({
          code: "CONFLICT",
          message: "That recording was already sent.",
        });
      action = "POST_VOICE";
      opts = { durationMs: ms, noFree: true };
    }

    // Charge first (one row-locked ledger transaction, which also counts the day's 20 messages), then store. If the
    // store fails the charge is reversed, so only a stored message is ever paid for.
    const charge = await this.units.charge(me.id, action, key, opts);
    try {
      const row = await this.store(
        me,
        to.id,
        dto.kind,
        body,
        clip,
        key,
        charge.costMilli,
      );
      return {
        message: this.view(row, me.id),
        charge: {
          costMilli: charge.costMilli,
          balanceMilli: await this.balanceOf(me.id),
        },
      };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        // A parallel send with the same key stored first: that one is the answer, and it holds the charge.
        const again = await this.existing(me.id, key);
        if (again)
          return {
            message: this.view(again, me.id),
            charge: {
              costMilli: again.costMilli,
              balanceMilli: await this.balanceOf(me.id),
            },
          };
      }
      await this.units
        .reverse(charge.chargeId, "direct message failed")
        .catch((r) =>
          this.logger.error(`reverse ${charge.chargeId}: ${String(r)}`),
        );
      if ((e as { code?: string }).code === "P2003") throw gone();
      throw e;
    }
  }

  /** The write. A block made between the check and here is caught here (and the charge is then reversed). */
  private async store(
    me: Profile,
    toId: string,
    kind: "TEXT" | "VOICE",
    body: string | null,
    clip: ClipRow | null,
    key: string,
    costMilli: number,
  ): Promise<MsgRow> {
    const [a, b] = me.id < toId ? [me.id, toId] : [toId, me.id];
    const id = await this.prisma.$transaction(async (tx) => {
      const blocks = await tx.block.count({
        where: {
          OR: [
            { blockerId: me.id, blockedId: toId },
            { blockerId: toId, blockedId: me.id },
          ],
        },
      });
      if (blocks > 0) throw blockedError();
      const at = new Date();
      const conv = await tx.dmConversation.upsert({
        where: { userAId_userBId: { userAId: a, userBId: b } },
        create: { userAId: a, userBId: b, lastMessageAt: at },
        update: { lastMessageAt: at },
      });
      const m = await tx.dmMessage.create({
        data: {
          conversationId: conv.id,
          senderId: me.id,
          recipientId: toId,
          kind,
          body,
          clipId: clip?.id ?? null,
          durationMs: clip?.durationMs ?? null,
          idempotencyKey: key,
          costMilli,
          createdAt: at,
        },
      });
      return m.id;
    });
    return this.prisma.dmMessage.findUniqueOrThrow({
      where: { id },
      include: MSG_INCLUDE,
    });
  }

  private async blockedEitherWay(a: string, b: string): Promise<boolean> {
    return (
      (await this.prisma.block.count({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      })) > 0
    );
  }

  // ------------------------------------------------------------ reading

  /** The conversation if I am one of its two people and neither of us blocked the other; else 404. */
  private async mineOrGone(me: Profile, id: string) {
    const c = await this.prisma.dmConversation.findUnique({ where: { id } });
    if (!c || (c.userAId !== me.id && c.userBId !== me.id)) throw gone();
    const otherId = c.userAId === me.id ? c.userBId : c.userAId;
    if (await this.blockedEitherWay(me.id, otherId)) throw gone();
    return { c, otherId };
  }

  async conversations(me: Profile, q: { cursor?: string; limit?: unknown }) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const hidden = await hiddenUserIdsOf(this.prisma, me.id);
    const rows = await this.prisma.dmConversation.findMany({
      where: {
        AND: [
          {
            OR: [
              { userAId: me.id, userBId: { notIn: hidden } },
              { userBId: me.id, userAId: { notIn: hidden } },
            ],
          },
          cur
            ? {
                OR: [
                  { lastMessageAt: { lt: cur.t } },
                  { lastMessageAt: cur.t, id: { lt: cur.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        userA: {
          select: { id: true, handle: true, displayName: true, status: true },
        },
        userB: {
          select: { id: true, handle: true, displayName: true, status: true },
        },
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: MSG_INCLUDE,
        },
      },
    });
    const page = cut(rows, limit, (r) => r.lastMessageAt);
    const unread = page.items.length
      ? await this.prisma.dmMessage.groupBy({
          by: ["conversationId"],
          where: {
            conversationId: { in: page.items.map((r) => r.id) },
            recipientId: me.id,
            readAt: null,
            status: "PUBLISHED",
          },
          _count: { _all: true },
        })
      : [];
    const unreadOf = new Map(
      unread.map((u) => [u.conversationId, u._count._all]),
    );
    return {
      items: page.items.map((r) => {
        const last = r.messages[0];
        const other = r.userAId === me.id ? r.userB : r.userA;
        return {
          id: r.id,
          person: this.person(other),
          lastMessage: last
            ? {
                id: last.id,
                kind: last.kind,
                preview: this.preview(last),
                mine: last.senderId === me.id,
                createdAt: last.createdAt.toISOString(),
              }
            : null,
          unread: unreadOf.get(r.id) ?? 0,
          updatedAt: r.lastMessageAt.toISOString(),
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  async messages(
    me: Profile,
    conversationId: string,
    q: { cursor?: string; limit?: unknown },
  ) {
    const { otherId } = await this.mineOrGone(me, conversationId);
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.dmMessage.findMany({
      where: {
        conversationId,
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: cur.t } },
                { createdAt: cur.t, id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: MSG_INCLUDE,
    });
    const page = cut(rows, limit, (r) => r.createdAt);
    const other = await this.prisma.user.findUniqueOrThrow({
      where: { id: otherId },
      select: { id: true, handle: true, displayName: true, status: true },
    });
    return {
      person: this.person(other),
      items: page.items.map((m) => this.view(m, me.id)),
      nextCursor: page.nextCursor,
    };
  }

  /** Opening a conversation: everything sent to me in it is read. */
  async markRead(me: Profile, conversationId: string): Promise<void> {
    await this.mineOrGone(me, conversationId);
    await this.prisma.dmMessage.updateMany({
      where: { conversationId, recipientId: me.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** The number on the messages icon: unread messages sent to me, leaving out people hidden by a block. */
  async unreadTotal(me: Profile): Promise<{ unread: number }> {
    const hidden = await hiddenUserIdsOf(this.prisma, me.id);
    const unread = await this.prisma.dmMessage.count({
      where: {
        recipientId: me.id,
        readAt: null,
        status: "PUBLISHED",
        senderId: { notIn: hidden },
      },
    });
    return { unread };
  }

  /** For the Message button on a profile and the compose screen: who they are, the conversation if there is one, and whether they take messages. */
  async withPerson(me: Profile, userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        handle: true,
        displayName: true,
        status: true,
        suspendedUntil: true,
        settings: { select: { dmOpen: true } },
      },
    });
    if (!u || u.status === "DELETED" || u.status === "BANNED" || u.id === me.id)
      throw gone();
    const blocked = await this.blockedEitherWay(me.id, u.id);
    const [a, b] = me.id < u.id ? [me.id, u.id] : [u.id, me.id];
    const conv = blocked
      ? null
      : await this.prisma.dmConversation.findUnique({
          where: { userAId_userBId: { userAId: a, userBId: b } },
          select: { id: true },
        });
    const open = u.settings?.dmOpen !== false;
    return {
      person: this.person(u),
      conversationId: conv?.id ?? null,
      acceptsMessages: !blocked && open && !restrictedNow(u, new Date()),
    };
  }
}
