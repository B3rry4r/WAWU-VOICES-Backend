import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
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
