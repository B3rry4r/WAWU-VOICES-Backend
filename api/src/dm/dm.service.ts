import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { markOf, personMarks, type MarkMap } from "../common/people";
import { ClipsService, type ClipRow } from "../media/clips.service";
import { cut, decodeCursor, pageLimit } from "../me/paging";
import type { Profile } from "../talk/shared/profile.service";
import { ConfigReader } from "../talk/shared/config-reader";
import { UnitsAccess } from "../talk/shared/units-access";
import { countChars, voiceTooLong } from "../units/text-price";
import type { ChargeAction, ChargeOpts } from "../units/units.port";
import type { Prisma } from "../generated/prisma/client";
import { lagosDay } from "../units/units.ledger";
import { isVerifiedNow } from "../verify/verified";
import { VerificationService } from "../verify/verification.service";
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

/**
 * ONE refusal for every reason a person cannot be written to: they blocked you, you blocked them, they turned messages
 * off, or they are suspended, banned or leaving. Same status, code and words, so nobody can tell which it is.
 * (A person who does not exist, or is deleted, is a plain 404.)
 */
const unavailableError = () =>
  new ForbiddenException({
    code: "dm_unavailable",
    message: "This person is not taking messages.",
  });
const blockedError = unavailableError;

type MsgRow = Prisma.DmMessageGetPayload<{
  include: {
    clip: {
      select: {
        id: true;
        durationMs: true;
        peaks: true;
        transcript: { select: { status: true; text: true } };
      };
    };
  };
}>;
const MSG_INCLUDE = {
  clip: {
    select: {
      id: true,
      durationMs: true,
      peaks: true,
      transcript: { select: { status: true, text: true } },
    },
  },
} as const;

/** A member who cannot send or be sent to right now: banned, suspended (and not yet over), leaving or gone. */
/** Can this person be written to right now (the one test: messages on, and not suspended, banned, leaving or gone). */
function acceptsNow(
  u: {
    status: string;
    suspendedUntil: Date | null;
    settings?: { dmOpen: boolean } | null;
  },
  now: Date,
): boolean {
  return !restrictedNow(u, now) && u.settings?.dmOpen !== false;
}

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
    private readonly verification: VerificationService,
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
              transcript:
                m.clip.transcript?.status === "READY"
                  ? m.clip.transcript.text
                  : null,
            }
          : null,
      status: m.status,
      ...(mine ? { costMilli: m.costMilli } : {}),
      readAt: mine && m.readAt ? m.readAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private person(
    u: {
      id: string;
      handle: string;
      displayName: string | null;
      avatarFileId: string | null;
      status: string;
      state: string | null;
      verifiedUntil: Date | null;
      verificationStatus: string | null;
    },
    pictures: MarkMap,
  ) {
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      ...markOf(pictures, u.id),
      place: u.status === "DELETED" ? null : u.state,
      verified: u.status !== "DELETED" && isVerifiedNow(u),
      deleted: u.status === "DELETED",
    };
  }

  private preview(m: MsgRow): string {
    if (m.status !== "PUBLISHED") return "Message removed";
    if (m.kind === "VOICE") {
      const s = Math.round((m.durationMs ?? m.clip?.durationMs ?? 0) / 1000);
      return `Voice message · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    if (
      !(await canSendDm(this.prisma, me.id, now, (u) =>
        this.verification.fresh(u),
      ))
    )
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
    if (restrictedNow(to, now) || to.settings?.dmOpen === false)
      throw unavailableError();

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
      action = "DM_TEXT";
      opts = { chars };
    } else {
      if (dto.body) throw invalid("body", "A voice message has no text.");
      if (!dto.clipId) throw invalid("clipId", "Choose your recording.");
      clip = await this.clips.forPublish(me, dto.clipId, "DM");
      const maxSeconds = await this.config.num("dm.voice_max_seconds");
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
      action = "DM_VOICE";
      opts = { durationMs: ms };
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

  /** The write. A block, or messages switched off, between the check and here is caught here (and the charge is then reversed). */
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
      // The receiver may have turned messages off, or been suspended, since the check: the same neutral refusal.
      const rcv = await tx.user.findUnique({
        where: { id: toId },
        select: {
          status: true,
          suspendedUntil: true,
          settings: { select: { dmOpen: true } },
        },
      });
      if (!rcv || !acceptsNow(rcv, new Date())) throw unavailableError();
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

  /** The people I blocked: their chats with me are hidden from my inbox and my unread number (my choice). Only this direction. */
  private async iBlocked(meId: string): Promise<string[]> {
    return (
      await this.prisma.block.findMany({
        where: { blockerId: meId },
        select: { blockedId: true },
      })
    ).map((b) => b.blockedId);
  }

  /** Of these people, the ones who blocked me. For me that looks exactly like "messages off": the chat stays, nothing more can be sent. */
  private async blockedMeAmong(
    meId: string,
    ids: string[],
  ): Promise<Set<string>> {
    if (!ids.length) return new Set();
    return new Set(
      (
        await this.prisma.block.findMany({
          where: { blockedId: meId, blockerId: { in: ids } },
          select: { blockerId: true },
        })
      ).map((b) => b.blockerId),
    );
  }

  // ------------------------------------------------------------ reading

  /** The conversation if I am one of its two people and I did not block the other person; else 404. A person who was blocked still reads it. */
  private async mineOrGone(me: Profile, id: string) {
    const c = await this.prisma.dmConversation.findUnique({ where: { id } });
    if (!c || (c.userAId !== me.id && c.userBId !== me.id)) throw gone();
    const otherId = c.userAId === me.id ? c.userBId : c.userAId;
    if ((await this.iBlocked(me.id)).includes(otherId)) throw gone();
    return { c, otherId };
  }

  async conversations(me: Profile, q: { cursor?: string; limit?: unknown }) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const hidden = await this.iBlocked(me.id);
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
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarFileId: true,
            status: true,
            state: true,
            verifiedUntil: true,
            verificationStatus: true,
            suspendedUntil: true,
            settings: { select: { dmOpen: true } },
          },
        },
        userB: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarFileId: true,
            status: true,
            state: true,
            verifiedUntil: true,
            verificationStatus: true,
            suspendedUntil: true,
            settings: { select: { dmOpen: true } },
          },
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
    const blockedMe = await this.blockedMeAmong(
      me.id,
      page.items.map((r) => (r.userAId === me.id ? r.userBId : r.userAId)),
    );
    const mutedIds = new Set(
      (
        await this.prisma.dmMute.findMany({
          where: {
            userId: me.id,
            conversationId: { in: page.items.map((r) => r.id) },
          },
          select: { conversationId: true },
        })
      ).map((m) => m.conversationId),
    );
    const pictures = await personMarks(
      this.prisma,
      page.items.map((r) => (r.userAId === me.id ? r.userB : r.userA)),
    );
    const unreadOf = new Map(
      unread.map((u) => [u.conversationId, u._count._all]),
    );
    return {
      items: page.items.map((r) => {
        const last = r.messages[0];
        const other = r.userAId === me.id ? r.userB : r.userA;
        return {
          id: r.id,
          person: this.person(other, pictures),
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
          muted: mutedIds.has(r.id),
          acceptsMessages:
            !blockedMe.has(other.id) && acceptsNow(other, new Date()),
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
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarFileId: true,
        status: true,
        state: true,
        verifiedUntil: true,
        verificationStatus: true,
        suspendedUntil: true,
        settings: { select: { dmOpen: true } },
      },
    });
    const muted = !!(await this.prisma.dmMute.findUnique({
      where: { userId_conversationId: { userId: me.id, conversationId } },
    }));
    return {
      person: this.person(other, await personMarks(this.prisma, [other])),
      muted,
      acceptsMessages:
        !(await this.blockedMeAmong(me.id, [otherId])).has(otherId) &&
        acceptsNow(other, new Date()),
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
    const hidden = await this.iBlocked(me.id);
    // A muted chat does not raise the number.
    const muted = (
      await this.prisma.dmMute.findMany({
        where: { userId: me.id },
        select: { conversationId: true },
      })
    ).map((m) => m.conversationId);
    const unread = await this.prisma.dmMessage.count({
      where: {
        conversationId: { notIn: muted },
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
        avatarFileId: true,
        state: true,
        verifiedUntil: true,
        verificationStatus: true,
        status: true,
        suspendedUntil: true,
        settings: { select: { dmOpen: true } },
      },
    });
    // A banned person answers like a suspended one (200, acceptsMessages false); only a deleted account, nobody and myself are 404.
    if (!u || u.status === "DELETED" || u.id === me.id) throw gone();
    const iBlockedThem = (await this.iBlocked(me.id)).includes(u.id);
    const theyBlockedMe = (await this.blockedMeAmong(me.id, [u.id])).has(u.id);
    const [a, b] = me.id < u.id ? [me.id, u.id] : [u.id, me.id];
    // If I blocked them the chat is hidden from me; if they blocked me it stays, as when they turned messages off.
    const conv = iBlockedThem
      ? null
      : await this.prisma.dmConversation.findUnique({
          where: { userAId_userBId: { userAId: a, userBId: b } },
          select: { id: true },
        });
    return {
      person: this.person(u, await personMarks(this.prisma, [u])),
      conversationId: conv?.id ?? null,
      acceptsMessages:
        !iBlockedThem && !theyBlockedMe && acceptsNow(u, new Date()),
    };
  }

  /** Mute or unmute one chat for me. The other person is not told. */
  async setMuted(
    me: Profile,
    conversationId: string,
    on: boolean,
  ): Promise<void> {
    await this.mineOrGone(me, conversationId);
    if (on)
      await this.prisma.dmMute.upsert({
        where: { userId_conversationId: { userId: me.id, conversationId } },
        create: { userId: me.id, conversationId },
        update: {},
      });
    else
      await this.prisma.dmMute.deleteMany({
        where: { userId: me.id, conversationId },
      });
  }

  /** What the screens say before sending: the prices (0 is free), the longest voice, and how many messages are left today. */
  async limits(me: Profile) {
    const [
      textPriceMilli,
      textPriceChars,
      voicePriceMilli,
      voiceMaxSeconds,
      perDay,
      used,
      balanceMilli,
    ] = await Promise.all([
      this.config.num("dm.text_price_milli"),
      this.config.num("text.price_chars"),
      this.config.num("dm.voice_price_milli"),
      this.config.num("dm.voice_max_seconds"),
      this.config.num("dm.messages_per_day"),
      this.prisma.usageCounter.findMany({
        where: {
          userId: me.id,
          day: lagosDay(),
          action: { in: ["DM_TEXT", "DM_VOICE"] },
        },
        select: { used: true },
      }),
      this.balanceOf(me.id),
    ]);
    return {
      textPriceMilli,
      textPriceChars,
      voicePriceMilli,
      voiceMaxSeconds,
      maxChars: DM_MAX_CHARS,
      messagesPerDay: perDay,
      messagesLeftToday: Math.max(
        0,
        perDay - used.reduce((n, r) => n + r.used, 0),
      ),
      balanceMilli,
    };
  }
}
