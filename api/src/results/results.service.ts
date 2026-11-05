import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ConflictException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import { Prisma } from "../generated/prisma/client";
import type {
  ResultPost as PostRow,
  ResultThread as ThreadRow,
  ResultPostStatus,
} from "../generated/prisma/client";
import { makeClient } from "../audio-ref/spaces";
import { ActorService, type Actor } from "./actor.service";
import { AUTHOR_SELECT, authorRefs, type AuthorRef } from "./author";
import { decodeCursor, encodeCursor, pageLimit } from "./cursor";
import type {
  CreateResultPostDto,
  CreateResultThreadDto,
  ResultDecisionDto,
} from "./results.dto";

const TEAM_ROLES = ["EDITOR", "ADMIN"] as const;
const PHOTO_URL_SECONDS = 300;
const TEAM_NAME = "the WAWU team";

export interface ResultThreadOut {
  id: string;
  title: string;
  subtitle: string | null;
  heldOn: string;
  status: ThreadRow["status"];
  postCount: number;
  verifiedCount: number;
  toCheck: number;
}

export interface ResultPostOut {
  id: string;
  threadId: string;
  author: AuthorRef;
  state: string;
  lga: string;
  ward: string;
  pollingUnit: string;
  accredited: number;
  votesCast: number;
  rejected: number;
  status: ResultPostStatus;
  label: "Verified" | "Not verified";
  checkedAt: string | null;
  checkedLine: string | null;
  createdAt: string;
  isMine: boolean;
}

export interface AdminResultPostOut {
  post: ResultPostOut;
  photoUrl: string | null;
  hasPhoto: boolean;
  checkedBy: string | null;
}

const lagosTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Times are Lagos time wherever a person reads them (CONVENTIONS). */
export function checkedLineFor(
  p: Pick<PostRow, "status" | "checkedAt">,
): string {
  if (!p.checkedAt) return "Not checked yet. The WAWU team is on it.";
  const when = lagosTime
    .format(p.checkedAt)
    .replace(/\bam\b/, "am")
    .replace(/\bpm\b/, "pm");
  return p.status === "VERIFIED"
    ? `Checked by ${TEAM_NAME}, ${when}`
    : `Checked by ${TEAM_NAME}, ${when}. The numbers could not be confirmed.`;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorService,
  ) {}

  // ---------------------------------------------------------------- config

  private async cfgNumber(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    const v = row?.valueJson;
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  }

  // ---------------------------------------------------------------- mapping

  private async mapThreads(rows: ThreadRow[]): Promise<ResultThreadOut[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const groups = await this.prisma.resultPost.groupBy({
      by: ["threadId", "status", "checkedAt"],
      where: { threadId: { in: ids }, status: { not: "REMOVED" } },
      _count: { _all: true },
    });
    return rows.map((t) => {
      let postCount = 0;
      let verifiedCount = 0;
      let toCheck = 0;
      for (const g of groups) {
        if (g.threadId !== t.id) continue;
        postCount += g._count._all;
        if (g.status === "VERIFIED") verifiedCount += g._count._all;
        if (g.status === "NOT_VERIFIED" && g.checkedAt === null)
          toCheck += g._count._all;
      }
      return {
        id: t.id,
        title: t.title,
        subtitle: t.subtitle,
        heldOn: dateOnly(t.heldOn),
        status: t.status,
        postCount,
        verifiedCount,
        toCheck,
      };
    });
  }

  private async mapPosts(
    rows: PostRow[],
    viewerId: string | null,
  ): Promise<ResultPostOut[]> {
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } },
      select: AUTHOR_SELECT,
    });
    const refs = await authorRefs(this.prisma, authors);
    return rows.map((p) => ({
      id: p.id,
      threadId: p.threadId,
      author: refs.get(p.authorId) as AuthorRef,
      state: p.state,
      lga: p.lga,
      ward: p.ward,
      pollingUnit: p.pollingUnit,
      accredited: p.accredited,
      votesCast: p.votesCast,
      rejected: p.rejected,
      status: p.status,
      label: p.status === "VERIFIED" ? "Verified" : "Not verified",
      checkedAt: p.checkedAt?.toISOString() ?? null,
      checkedLine: checkedLineFor(p),
      createdAt: p.createdAt.toISOString(),
      isMine: viewerId === p.authorId,
    }));
  }

  // ---------------------------------------------------------------- public reads

  async listThreads(q: { cursor?: string; limit?: number; status?: string }) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const status =
      q.status === "OPEN" || q.status === "CLOSED" ? q.status : undefined;
    const rows = await this.prisma.resultThread.findMany({
      where: {
        status: status ?? { not: "SCHEDULED" },
        ...(cur
          ? {
              OR: [
                { heldOn: { lt: new Date(cur.k) } },
                { heldOn: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ heldOn: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    return this.page(
      rows,
      limit,
      (t) => ({ k: dateOnly(t.heldOn), id: t.id }),
      (r) => this.mapThreads(r),
    );
  }

  async getThread(threadId: string): Promise<ResultThreadOut> {
    const row = await this.prisma.resultThread.findFirst({
      where: { id: threadId, status: { not: "SCHEDULED" } },
    });
    if (!row) throw this.actors.notFound();
    return (await this.mapThreads([row]))[0];
  }

  private async page<R extends { id: string }, O>(
    rows: R[],
    limit: number,
    key: (r: R) => { k: string; id: string },
    map: (r: R[]) => Promise<O[]>,
  ): Promise<{ items: O[]; nextCursor: string | null }> {
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    return {
      items: await map(slice),
      nextCursor: more ? encodeCursor(key(slice[slice.length - 1])) : null,
    };
  }

  async listPosts(
    user: VoicesUser | undefined,
    threadId: string,
    q: {
      cursor?: string;
      limit?: number;
      status?: string;
      state?: string;
      lga?: string;
      after?: string;
    },
  ) {
    await this.getThread(threadId);
    const viewer = await this.actors.viewer(user);
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const blocked = await this.actors.blockedEitherWay(viewer?.id);
    const status: ResultPostStatus =
      q.status === "VERIFIED" ? "VERIFIED" : "NOT_VERIFIED";
    const where: Prisma.ResultPostWhereInput = {
      threadId,
      status:
        q.status === "VERIFIED" || q.status === "NOT_VERIFIED"
          ? status
          : { not: "REMOVED" },
      ...(q.state ? { state: { equals: q.state, mode: "insensitive" } } : {}),
      ...(q.lga ? { lga: { equals: q.lga, mode: "insensitive" } } : {}),
      ...(blocked.length ? { authorId: { notIn: blocked } } : {}),
    };
    const rows = await this.prisma.resultPost.findMany({
      where: {
        ...where,
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: new Date(cur.k) } },
                { createdAt: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const base = await this.page(
      rows,
      limit,
      (p) => ({ k: p.createdAt.toISOString(), id: p.id }),
      (r) => this.mapPosts(r, viewer?.id ?? null),
    );
    let newCount = 0;
    const seen = decodeCursor(q.after);
    if (seen)
      newCount = await this.prisma.resultPost.count({
        where: {
          ...where,
          OR: [
            { createdAt: { gt: new Date(seen.k) } },
            { createdAt: new Date(seen.k), id: { gt: seen.id } },
          ],
        },
      });
    const newest = !cur && rows.length ? rows[0] : null;
    return {
      ...base,
      newCount,
      newestCursor: newest
        ? encodeCursor({ k: newest.createdAt.toISOString(), id: newest.id })
        : null,
    };
  }

  // ---------------------------------------------------------------- posting

  /** Free (V-8): no charge, no free post used. Totals only. Starts Not verified. */
  async createPost(
    actor: Actor,
    threadId: string,
    dto: CreateResultPostDto,
    idempotencyKey: string,
  ): Promise<ResultPostOut> {
    const thread = await this.prisma.resultThread.findFirst({
      where: { id: threadId, status: { not: "SCHEDULED" } },
    });
    if (!thread) throw this.actors.notFound();
    if (thread.status !== "OPEN")
      throw new ConflictException({
        code: "CONFLICT",
        message:
          "This results thread is closed. You can no longer post numbers.",
        details: { reason: "THREAD_CLOSED" },
      });

    const fields: { path: string; message: string }[] = [];
    if (dto.votesCast > dto.accredited)
      fields.push({
        path: "votesCast",
        message: "Votes cast cannot be more than the number accredited.",
      });
    if (dto.rejected > dto.votesCast)
      fields.push({
        path: "rejected",
        message: "Rejected votes cannot be more than the votes cast.",
      });
    if (dto.photoFileId) {
      const file = await this.prisma.storedFile.findFirst({
        where: {
          id: dto.photoFileId,
          kind: "RESULT_PHOTO",
          ownerId: actor.id,
        },
      });
      if (!file)
        fields.push({
          path: "photoFileId",
          message: "That photo was not found. Add it again.",
        });
    }
    if (fields.length)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields },
      });

    const limit = await this.cfgNumber("ratelimit.result_post_per_10min", 30);
    const windowStart = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.prisma.resultPost.findMany({
      where: { authorId: actor.id, createdAt: { gt: windowStart } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
      take: limit,
    });
    if (recent.length >= limit) {
      const wait = Math.max(
        1,
        Math.ceil(
          (recent[0].createdAt.getTime() + 10 * 60 * 1000 - Date.now()) / 1000,
        ),
      );
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "You are posting too fast. Wait a moment and try again.",
          details: { retryAfterSeconds: wait },
        },
        429,
      );
    }

    const same = await this.prisma.resultPost.findFirst({
      where: {
        threadId,
        authorId: actor.id,
        status: { not: "REMOVED" },
        state: { equals: dto.state, mode: "insensitive" },
        lga: { equals: dto.lga, mode: "insensitive" },
        ward: { equals: dto.ward, mode: "insensitive" },
        pollingUnit: { equals: dto.pollingUnit, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (same)
      throw new ConflictException({
        code: "CONFLICT",
        message:
          "You already posted numbers for this polling unit. Delete that post first to post again.",
        details: { reason: "ALREADY_POSTED", postId: same.id },
      });

    const row = await this.prisma.resultPost.create({
      data: {
        threadId,
        authorId: actor.id,
        state: dto.state,
        lga: dto.lga,
        ward: dto.ward,
        pollingUnit: dto.pollingUnit,
        accredited: dto.accredited,
        votesCast: dto.votesCast,
        rejected: dto.rejected,
        photoFileId: dto.photoFileId ?? null,
        idempotencyKey,
      },
    });
    return (await this.mapPosts([row], actor.id))[0];
  }

  /** Mine only. The row stays (the team may need it) but is REMOVED from every read. */
  async deletePost(actor: Actor, postId: string): Promise<void> {
    const row = await this.prisma.resultPost.findUnique({
      where: { id: postId },
    });
    if (!row || row.status === "REMOVED") throw this.actors.notFound();
    if (row.authorId !== actor.id)
      throw this.actors.forbidden("That is not your post.");
    await this.prisma.resultPost.update({
      where: { id: postId },
      data: { status: "REMOVED" },
    });
  }

  // ---------------------------------------------------------------- the team (A7 calls these)

  private async teamPost(row: PostRow): Promise<AdminResultPostOut> {
    const [post] = await this.mapPosts([row], null);
    let photoUrl: string | null = null;
    if (row.photoFileId) {
      const file = await this.prisma.storedFile.findUnique({
        where: { id: row.photoFileId },
      });
      const bucket = process.env.SPACES_BUCKET;
      if (file && bucket)
        photoUrl = await getSignedUrl(
          makeClient(),
          new GetObjectCommand({ Bucket: bucket, Key: file.key }),
          { expiresIn: PHOTO_URL_SECONDS },
        );
    }
    let checkedBy: string | null = null;
    if (row.checkedById) {
      const u = await this.prisma.user.findUnique({
        where: { id: row.checkedById },
        select: { handle: true },
      });
      checkedBy = u ? `@${u.handle}` : null;
    }
    return { post, photoUrl, hasPhoto: !!row.photoFileId, checkedBy };
  }

  /** The queue. Default: posts nobody has checked yet, oldest first. Only EDITOR or ADMIN; the sheet photo URL is signed here and nowhere else. */
  async adminListPosts(
    user: VoicesUser,
    q: { cursor?: string; limit?: number; threadId?: string; status?: string },
  ) {
    await this.actors.requireRole(user, [...TEAM_ROLES], { write: false });
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const where: Prisma.ResultPostWhereInput = {
      ...(q.threadId ? { threadId: q.threadId } : {}),
      ...(q.status === "VERIFIED" || q.status === "NOT_VERIFIED"
        ? { status: q.status }
        : { status: "NOT_VERIFIED", checkedAt: null }),
    };
    const rows = await this.prisma.resultPost.findMany({
      where: {
        ...where,
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
    const base = await this.page(
      rows,
      limit,
      (p) => ({ k: p.createdAt.toISOString(), id: p.id }),
      (r) => Promise.all(r.map((p) => this.teamPost(p))),
    );
    const toCheck = await this.prisma.resultPost.count({
      where: {
        status: "NOT_VERIFIED",
        checkedAt: null,
        ...(q.threadId ? { threadId: q.threadId } : {}),
      },
    });
    return { ...base, toCheck };
  }

  /** One post as the team sees it, photo included. A non-team caller gets 403 ROLE_REQUIRED and no URL. */
  async adminGetPost(
    user: VoicesUser,
    postId: string,
  ): Promise<AdminResultPostOut> {
    await this.actors.requireRole(user, [...TEAM_ROLES], { write: false });
    const row = await this.prisma.resultPost.findUnique({
      where: { id: postId },
    });
    if (!row) throw this.actors.notFound();
    return this.teamPost(row);
  }

  /**
   * Mark a result Verified or Not verified, or send it to moderation. Writes an audit row.
   * Returns the contract's AdminResultPost plus the poster's user id, so the notifications task can tell them (A8).
   */
  async decide(
    user: VoicesUser,
    postId: string,
    dto: ResultDecisionDto,
  ): Promise<{
    result: AdminResultPostOut;
    authorId: string;
    decision: ResultDecisionDto["decision"];
  }> {
    const actor = await this.actors.requireRole(user, [...TEAM_ROLES]);
    const before = await this.prisma.resultPost.findUnique({
      where: { id: postId },
    });
    if (!before || before.status === "REMOVED") throw this.actors.notFound();
    const updated = await this.prisma.$transaction(async (tx) => {
      let row = before;
      if (dto.decision === "SEND_TO_MODERATION") {
        await tx.moderationItem.upsert({
          where: {
            targetType_targetId_queue: {
              targetType: "RESULT_POST",
              targetId: postId,
              queue: "REPORTED",
            },
          },
          create: {
            targetType: "RESULT_POST",
            targetId: postId,
            queue: "REPORTED",
            reasons: ["RESULT_REVIEW"],
          },
          update: { status: "OPEN", resolvedAt: null },
        });
      } else {
        row = await tx.resultPost.update({
          where: { id: postId },
          data: {
            status: dto.decision,
            checkedById: actor.id,
            checkedAt: new Date(),
            checkNote: dto.note ?? null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "result.decide",
          targetType: "result_post",
          targetId: postId,
          reason: dto.note ?? null,
          before: { status: before.status },
          after: { decision: dto.decision, status: row.status },
        },
      });
      return row;
    });
    return {
      result: await this.teamPost(updated),
      authorId: updated.authorId,
      decision: dto.decision,
    };
  }

  async adminListThreads(
    user: VoicesUser,
    q: { cursor?: string; limit?: number; status?: string },
  ) {
    await this.actors.requireRole(user, [...TEAM_ROLES], { write: false });
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const status =
      q.status === "SCHEDULED" || q.status === "OPEN" || q.status === "CLOSED"
        ? q.status
        : undefined;
    const rows = await this.prisma.resultThread.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(cur
          ? {
              OR: [
                { heldOn: { lt: new Date(cur.k) } },
                { heldOn: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ heldOn: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    return this.page(
      rows,
      limit,
      (t) => ({ k: dateOnly(t.heldOn), id: t.id }),
      (r) => this.mapThreads(r),
    );
  }

  async adminCreateThread(
    user: VoicesUser,
    dto: CreateResultThreadDto,
  ): Promise<ResultThreadOut> {
    const actor = await this.actors.requireRole(user, [...TEAM_ROLES]);
    const row = await this.prisma.resultThread.create({
      data: {
        title: dto.title,
        subtitle: dto.subtitle || null,
        heldOn: new Date(`${dto.heldOn}T00:00:00.000Z`),
        status: dto.status ?? "SCHEDULED",
        topicId: dto.topicId ?? null,
        createdById: actor.id,
      },
    });
    return (await this.mapThreads([row]))[0];
  }
}
