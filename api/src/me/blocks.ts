import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AccountStatus } from "../generated/prisma/enums";

/** Account states that other people can see. Banned, deleting and deleted accounts vanish from every list. */
export const PUBLIC_STATUSES: AccountStatus[] = [
  AccountStatus.ACTIVE,
  AccountStatus.SUSPENDED,
];

/**
 * Prisma filter for a User relation (an `author`, a `user`): keeps only people who are neither blocked by the viewer nor
 * have blocked the viewer, and who are publicly visible. Use it in every list and thread:
 *   prisma.answer.findMany({ where: { author: visibleUser(viewerId) } })
 * With no viewer (a guest) only the visibility rule applies.
 */
export function visibleUser(viewerId?: string | null): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { status: { in: PUBLIC_STATUSES } };
  if (!viewerId) return base;
  return {
    ...base,
    blocksReceived: { none: { blockerId: viewerId } },
    blocksMade: { none: { blockedId: viewerId } },
  };
}

/**
 * lead ruling WF, 6 Nov (RW8, V-24): the people hidden from this viewer in both directions (people they blocked and
 * people who blocked them). Plain function so any read path can use it with the one PrismaService it already has.
 */
export async function hiddenUserIdsOf(
  prisma: PrismaService,
  viewerId: string | null | undefined,
): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const r of rows)
    ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  return [...ids];
}

/**
 * V-HOTFIX-1: the one place that says how blocks touch a post.
 * A post made without a name (`anonymous`) is shown or hidden the same for every viewer, whatever blocks exist in
 * either direction: blocks never filter it, never change a count that includes it, and never suppress or reveal a
 * notice about it. Otherwise block / unblock would be a test that names the writer. Every read path that drops people
 * a viewer blocked (or who blocked them) goes through the helpers below, never its own `notIn` list.
 * A reply has no `anonymous` flag yet; when it gets one, only `blockHidesAuthorOf` and `authorNotBlocked` below change.
 */
export function blockHidesAuthorOf(
  hidden: readonly string[] | ReadonlySet<string>,
  post: { authorId: string | null; anonymous?: boolean | null },
): boolean {
  if (post.anonymous || !post.authorId) return false;
  return Array.isArray(hidden)
    ? (hidden as readonly string[]).includes(post.authorId)
    : (hidden as ReadonlySet<string>).has(post.authorId);
}

/** Prisma filter for an Answer: leaves out answers by hidden people, except answers made without a name. */
export function answerNotBlocked(
  hidden: readonly string[],
): Prisma.AnswerWhereInput {
  return hidden.length
    ? { NOT: { anonymous: false, authorId: { in: [...hidden] } } }
    : {};
}

/** Prisma filter for an Answer's author relation, as `visibleUser`, but a nameless answer ignores the block lists. */
export function answerAuthorVisible(
  viewerId?: string | null,
): Prisma.AnswerWhereInput {
  if (!viewerId) return { author: visibleUser(viewerId) };
  return {
    OR: [
      { anonymous: true, author: { status: { in: PUBLIC_STATUSES } } },
      { author: visibleUser(viewerId) },
    ],
  };
}

/** Prisma filter for a Reply: leaves out replies by hidden people. (No `anonymous` flag on a reply yet.) */
export function replyNotBlocked(
  hidden: readonly string[],
): Prisma.ReplyWhereInput {
  return hidden.length ? { authorId: { notIn: [...hidden] } } : {};
}

/** The same rule as raw SQL for an `Answer` row aliased `alias`. */
export function answerNotBlockedSql(
  hidden: readonly string[],
  alias = "a",
): Prisma.Sql {
  return hidden.length
    ? Prisma.sql`AND (${Prisma.raw(`${alias}."anonymous"`)} OR ${Prisma.raw(`${alias}."authorId"`)} NOT IN (${Prisma.join([...hidden])}))`
    : Prisma.empty;
}

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ids hidden from this viewer in both directions: people they blocked and people who blocked them. */
  async hiddenUserIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
    }
    return [...ids];
  }

  /** True when either person blocked the other. */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const n = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return n > 0;
  }

  /** 403 BLOCKED_BY_USER when `actor` may not interact with `target` (replying, reacting, supporting). */
  async assertCanInteract(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) return;
    if (await this.isBlockedEitherWay(actorId, targetId))
      throw new ForbiddenException({
        code: "BLOCKED_BY_USER",
        message: "You cannot do that with this person.",
      });
  }

  async block(blockerId: string, targetId: string): Promise<void> {
    if (blockerId === targetId)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "You cannot block yourself.",
        details: {
          fields: [{ path: "userId", message: "You cannot block yourself." }],
        },
      });
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true },
    });
    if (!target || target.status === AccountStatus.DELETED)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that person.",
      });
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId: targetId } },
      create: { blockerId, blockedId: targetId },
      update: {},
    });
  }

  async unblock(blockerId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId: targetId },
    });
  }
}
