import { randomInt } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AccountStatus } from "../generated/prisma/enums";
import type { Mood } from "../generated/prisma/enums";
import { webBase } from "../reach/share.service";
import { hiddenUserIdsOf } from "./blocks";
import { cut, decodeCursor, olderThan } from "./paging";

/** LCH-06: the code is 7 characters of a-z 0-9 (about 78 billion), made with the system's random source. */
const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export const CODE_RE = /^[a-z0-9]{7}$/;
/** A link is kept for 30 days: a person can only be claimed as a friend in the first 30 days of their account. */
export const INVITE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const NAMED_ANSWER = {
  status: "PUBLISHED" as const,
  anonymous: false,
  deletedAt: null,
};

function newCode(): string {
  let s = "";
  for (let i = 0; i < 7; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export function inviteUrl(code: string): string {
  return `${webBase()}/go/${code}`;
}

export interface FriendView {
  handle: string;
  displayName: string | null;
  answeredAt: string;
  /** The friend's mood word, only when the friend's "Share my word" is on. Otherwise null and wordShared is false. */
  word: Mood | null;
  wordShared: boolean;
}

function isUnique(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

@Injectable()
export class InviteService {
  constructor(private readonly prisma: PrismaService) {}

  /** The person's one code. Made the first time it is asked for and never changed after that. */
  async codeOf(userId: string): Promise<string> {
    const have = await this.prisma.invite.findUnique({ where: { userId } });
    if (have) return have.code;
    for (let i = 0; i < 6; i++) {
      try {
        const made = await this.prisma.invite.create({
          data: { userId, code: newCode() },
        });
        return made.code;
      } catch (e) {
        if (!isUnique(e)) throw e;
        // Either a parallel call made this person's code, or the code collided with someone else's: look, then retry.
        const again = await this.prisma.invite.findUnique({
          where: { userId },
        });
        if (again) return again.code;
      }
    }
    throw new Error("could not make an invite code");
  }

  /** The people who count: signed up through the link, answered, still here, and not blocked either way. */
  private async countable(inviterId: string) {
    const hidden = await hiddenUserIdsOf(this.prisma, inviterId);
    return {
      inviterId,
      friend: {
        status: AccountStatus.ACTIVE,
        // lead ruling LC, 9 Nov: an anonymous answer never reveals the person to anyone, the inviter included. A friend
        // counts and shows only through a published, named (not anonymous) answer.
        answers: { some: NAMED_ANSWER },
        ...(hidden.length ? { id: { notIn: hidden } } : {}),
      },
    };
  }

  /**
   * GET /invites/:code (no sign-in). Turns a code into the owner's handle for the "@name asked how you feel." line on /go,
   * and nothing else: no id, no display name, no avatar, no count. A code with the wrong shape, an unknown code, or an owner
   * who is not an active account all give the same answer (handle null), so the page just shows no line.
   */
  async inviterHandle(rawCode: string): Promise<{ handle: string | null }> {
    const code = rawCode.trim().toLowerCase();
    if (!CODE_RE.test(code)) return { handle: null };
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      select: { user: { select: { handle: true, status: true } } },
    });
    if (!invite || invite.user.status !== AccountStatus.ACTIVE)
      return { handle: null };
    return { handle: invite.user.handle };
  }

  async summary(userId: string) {
    const code = await this.codeOf(userId);
    const friendsAnswered = await this.prisma.inviteFriend.count({
      where: await this.countable(userId),
    });
    return { code, url: inviteUrl(code), friendsAnswered };
  }

  /**
   * The inviter's list. A friend's word is read here, from the friend's own latest published mood answer, and only if
   * the friend's "Share my word" is on at this moment: turning it off hides the word on the very next read, and the
   * friend stays in the count.
   */
  async friends(userId: string, limit: number, cursor?: string) {
    const where = await this.countable(userId);
    const c = decodeCursor(cursor);
    const [total, rows] = await Promise.all([
      this.prisma.inviteFriend.count({ where }),
      this.prisma.inviteFriend.findMany({
        where: { ...where, ...olderThan(c) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include: {
          friend: {
            select: {
              id: true,
              handle: true,
              displayName: true,
              settings: { select: { shareMyWord: true } },
            },
          },
        },
      }),
    ]);
    const page = cut(rows, limit, (r) => r.createdAt);
    const sharing = page.items
      .filter((r) => r.friend.settings?.shareMyWord ?? true)
      .map((r) => r.friendId);
    const words = new Map<string, Mood>();
    if (sharing.length) {
      const answers = await this.prisma.answer.findMany({
        where: {
          authorId: { in: sharing },
          mood: { not: null },
          ...NAMED_ANSWER,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { authorId: true, mood: true },
      });
      for (const a of answers)
        if (a.mood && !words.has(a.authorId)) words.set(a.authorId, a.mood);
    }
    const items: FriendView[] = page.items.map((r) => {
      const shared = r.friend.settings?.shareMyWord ?? true;
      const word = shared ? (words.get(r.friendId) ?? null) : null;
      return {
        handle: r.friend.handle,
        displayName: r.friend.displayName,
        answeredAt: r.answeredAt.toISOString(),
        word,
        wordShared: shared,
      };
    });
    return { count: total, items, nextCursor: page.nextCursor };
  }

  /** Every friend of this person, for their own data download. */
  async allFriends(userId: string) {
    const out: FriendView[] = [];
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await this.friends(userId, 50, cursor);
      count = page.count;
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { count, items: out };
  }

  /**
   * POST /me/invite/claim. Counts the signed-in person as the friend of whoever owns `code`, if all of this holds:
   * the code exists and its owner is here; it is not their own; they have no inviter yet (first link wins); their
   * account is less than 30 days old; they have a published answer; neither has blocked the other. Anything else is
   * ignored without a word, so the route cannot be used to find out which codes exist.
   */
  async claim(
    me: { id: string },
    rawCode: string,
    now = new Date(),
  ): Promise<void> {
    const code = rawCode.trim().toLowerCase();
    if (!CODE_RE.test(code)) return;
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!invite || invite.userId === me.id) return;
    if (invite.user.status !== AccountStatus.ACTIVE) return;
    const mine = await this.prisma.user.findUnique({
      where: { id: me.id },
      select: {
        createdAt: true,
        status: true,
        invitedBy: { select: { id: true } },
      },
    });
    if (!mine || mine.status !== AccountStatus.ACTIVE || mine.invitedBy) return;
    if (now.getTime() - mine.createdAt.getTime() > INVITE_DAYS * DAY) return;
    if ((await hiddenUserIdsOf(this.prisma, me.id)).includes(invite.userId))
      return;
    const first = await this.prisma.answer.findFirst({
      // lead ruling LC, 9 Nov: only a named answer can bring a friend in.
      where: { authorId: me.id, ...NAMED_ANSWER },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    });
    if (!first) return;
    try {
      await this.prisma.inviteFriend.create({
        data: {
          inviterId: invite.userId,
          friendId: me.id,
          answeredAt: first.createdAt,
        },
      });
    } catch (e) {
      if (!isUnique(e)) throw e; // a parallel claim got there first: that one wins
    }
  }
}
