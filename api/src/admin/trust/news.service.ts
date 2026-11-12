import { MailEvents } from "../../mail/mail-events";
import {
  Inject,
  Injectable,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { NewsTag, Prisma } from "../../generated/prisma/client";
import type { CurrentMeInfo } from "../../me/me-context";
import { ANSWER_INCLUDE, Views } from "../../me/views";
import type { ObjectStore } from "../../media/object-store";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import { conflict, invalid, lockRow, notFound } from "./common";
import type { NewsDecisionDto, NewsListQuery } from "./dto";
import { ADMIN_MEDIA_STORE } from "./moderation.service";

const LABEL: Record<NewsTag, string> = {
  VERIFIED_NEWS: "Verified News",
  UNVERIFIED_NEWS: "Unverified News",
  GOSSIP: "Gossip",
};

function sourceError() {
  return new UnprocessableEntityException({
    code: "SOURCE_REQUIRED",
    message: "Verified News needs a named source.",
    details: {
      fields: [{ path: "sourceName", message: "Name the source you checked." }],
    },
  });
}

function checkUrl(url: string | undefined): void {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    throw invalid("sourceUrl", "Use a full link that starts with https://.");
  }
}

@Injectable()
export class AdminNewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
    @Optional()
    @Inject(ADMIN_MEDIA_STORE)
    private readonly store: ObjectStore | null,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  private async counts() {
    const [flagged, askingVerified, allChanges] = await Promise.all([
      this.prisma.answer.count({
        where: { isNews: true, newsReviewStatus: "FLAGGED", deletedAt: null },
      }),
      this.prisma.answer.count({
        where: {
          isNews: true,
          newsReviewStatus: "VERIFIED_REQUESTED",
          deletedAt: null,
        },
      }),
      this.prisma.answer.count({
        where: { isNews: true, newsReviewStatus: "RESOLVED", deletedAt: null },
      }),
    ]);
    return { flagged, askingVerified, allChanges };
  }

  async list(q: NewsListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const tab = q.tab ?? "flagged";
    const where: Prisma.AnswerWhereInput = {
      isNews: true,
      deletedAt: null,
      newsReviewStatus:
        tab === "asking-verified"
          ? "VERIFIED_REQUESTED"
          : tab === "all-changes"
            ? "RESOLVED"
            : "FLAGGED",
      ...(cur
        ? {
            OR: [
              { createdAt: { gt: new Date(cur.k) } },
              { createdAt: new Date(cur.k), id: { gt: cur.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.answer.findMany({
      where,
      include: ANSWER_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const counts = await this.counts();
    const last = slice[slice.length - 1];
    return {
      items: await this.itemViews(slice),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
      waiting: counts.flagged + counts.askingVerified,
      counts,
    };
  }

  private async itemViews(
    rows: Prisma.AnswerGetPayload<{ include: typeof ANSWER_INCLUDE }>[],
  ) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const answers = await this.views.answers(rows, {});
    const [flags, reqs, changes] = await Promise.all([
      this.prisma.report.findMany({
        where: {
          targetType: "ANSWER",
          targetId: { in: ids },
          reason: "MISLEADING_NEWS_TAG",
        },
        select: { targetId: true, note: true },
      }),
      this.prisma.newsVerificationRequest.findMany({
        where: { answerId: { in: ids } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.tagChange.findMany({
        where: { answerId: { in: ids } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(changes.map((c) => c.byUserId))] } },
      select: { id: true, handle: true },
    });
    const handle = new Map(users.map((u) => [u.id, `@${u.handle}`]));
    const fileIds = reqs
      .map((r) => r.evidenceFileId)
      .filter((x): x is string => !!x);
    const files = fileIds.length
      ? await this.prisma.storedFile.findMany({
          where: { id: { in: fileIds } },
        })
      : [];
    const evidence = new Map<string, string>();
    if (this.store)
      for (const f of files)
        evidence.set(f.id, (await this.store.signedGet(f.key)).url);
    return rows.map((a, i) => {
      const mine = flags.filter((f) => f.targetId === a.id);
      const tally = new Map<string, number>();
      for (const f of mine) {
        const k = f.note?.trim() || "No reason given";
        tally.set(k, (tally.get(k) ?? 0) + 1);
      }
      const open = reqs.find((r) => r.answerId === a.id && r.status === "OPEN");
      const anyReq = open ?? reqs.find((r) => r.answerId === a.id);
      const excerpt = (a.body ?? "").trim() || (a.clip?.transcript?.text ?? "");
      return {
        answer: answers[i],
        flagCount: a.newsFlagCount,
        flagReasons: [...tally.entries()].map(([k, n]) => `${k} (${n})`),
        verifiedRequested:
          !!open || a.newsReviewStatus === "VERIFIED_REQUESTED",
        sourceName:
          open?.sourceName ?? a.newsSourceName ?? anyReq?.sourceName ?? null,
        sourceUrl:
          open?.sourceUrl ?? a.newsSourceUrl ?? anyReq?.sourceUrl ?? null,
        evidenceUrl:
          (open?.evidenceFileId && evidence.get(open.evidenceFileId)) || null,
        changeLog: changes
          .filter((c) => c.answerId === a.id)
          .map((c) => ({
            at: c.createdAt.toISOString(),
            text:
              c.byUserId === a.authorId && !c.fromTag
                ? `the poster chose ${LABEL[c.toTag]} when posting`
                : c.fromTag && c.fromTag !== c.toTag
                  ? `tag changed from ${LABEL[c.fromTag]} to ${LABEL[c.toTag]}: ${c.reason}`
                  : `tag kept as ${LABEL[c.toTag]}: ${c.reason}`,
            by:
              c.byUserId === a.authorId && a.anonymous
                ? null
                : (handle.get(c.byUserId) ?? null),
          })),
        summary:
          excerpt.length > 140
            ? `${excerpt.slice(0, 137)}...`
            : excerpt || "Voice post",
      };
    });
  }

  private async one(answerId: string) {
    const row = await this.prisma.answer.findFirst({
      where: { id: answerId, isNews: true, deletedAt: null },
      include: ANSWER_INCLUDE,
    });
    if (!row) throw notFound("We could not find that post.");
    return (await this.itemViews([row]))[0];
  }

  async decide(actor: CurrentMeInfo, answerId: string, dto: NewsDecisionDto) {
    checkUrl(dto.sourceUrl);
    const now = new Date();
    let tagMail: { authorId: string; from: string; to: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      tagMail = null;
      await lockRow(tx, "Answer", "id", answerId);
      const a = await tx.answer.findUnique({ where: { id: answerId } });
      if (
        !a ||
        !a.isNews ||
        !a.newsTag ||
        a.deletedAt ||
        a.status === "DELETED_BY_AUTHOR"
      )
        throw notFound("We could not find that post.");
      const from = a.newsTag;
      let to: NewsTag = from;
      let sourceName = a.newsSourceName;
      let sourceUrl = a.newsSourceUrl;
      const review = "RESOLVED" as const;
      let logTag = true;
      let notifyPoster = false;
      const open = await tx.newsVerificationRequest.findFirst({
        where: { answerId, status: "OPEN" },
        orderBy: { createdAt: "desc" },
      });

      switch (dto.decision) {
        case "KEEP":
          break;
        case "CHANGE_TAG": {
          if (!dto.newTag) throw invalid("newTag", "Choose the new tag.");
          if (dto.newTag === from)
            throw invalid("newTag", "The post already has that tag.");
          to = dto.newTag as NewsTag;
          if (to === "VERIFIED_NEWS") {
            sourceName = dto.sourceName ?? open?.sourceName ?? null;
            sourceUrl = dto.sourceUrl ?? open?.sourceUrl ?? null;
            if (!sourceName) throw sourceError();
          } else {
            sourceName = null;
            sourceUrl = null;
          }
          notifyPoster = true;
          break;
        }
        case "APPROVE_VERIFIED": {
          if (!open)
            throw conflict("Nobody has asked for Verified News on this post.");
          to = "VERIFIED_NEWS";
          sourceName = dto.sourceName ?? open.sourceName;
          sourceUrl = dto.sourceUrl ?? open.sourceUrl;
          if (!sourceName) throw sourceError();
          await tx.newsVerificationRequest.update({
            where: { id: open.id },
            data: { status: "APPROVED", decidedById: actor.id, decidedAt: now },
          });
          notifyPoster = true;
          break;
        }
        case "DECLINE_VERIFIED": {
          if (!open)
            throw conflict("Nobody has asked for Verified News on this post.");
          await tx.newsVerificationRequest.update({
            where: { id: open.id },
            data: { status: "DECLINED", decidedById: actor.id, decidedAt: now },
          });
          notifyPoster = true;
          break;
        }
        case "SEND_TO_MODERATION": {
          logTag = false;
          await tx.moderationItem.upsert({
            where: {
              targetType_targetId_queue: {
                targetType: "ANSWER",
                targetId: answerId,
                queue: "REPORTED",
              },
            },
            create: {
              targetType: "ANSWER",
              targetId: answerId,
              queue: "REPORTED",
              reasons: ["MISLEADING_NEWS_TAG"],
            },
            update: { status: "OPEN", resolvedAt: null },
          });
          break;
        }
        default:
          throw invalid("decision", "Choose a decision.");
      }

      // lead ruling WF, 6 Nov (C-M3): the editor's decision settles any Moderation item that only existed because of the
      // news flags, and the flags themselves. An item with other report reasons stays for the moderators.
      if (dto.decision !== "SEND_TO_MODERATION") {
        const linked = await tx.moderationItem.findMany({
          where: {
            targetType: "ANSWER",
            targetId: answerId,
            queue: "REPORTED",
            status: "OPEN",
          },
        });
        const only = linked.filter((i) =>
          i.reasons.every((r) => r === "MISLEADING_NEWS_TAG"),
        );
        if (only.length)
          await tx.moderationItem.updateMany({
            where: { id: { in: only.map((i) => i.id) } },
            data: { status: "RESOLVED", resolvedAt: now },
          });
        await tx.report.updateMany({
          where: {
            targetType: "ANSWER",
            targetId: answerId,
            reason: "MISLEADING_NEWS_TAG",
            status: "OPEN",
          },
          data: { status: to !== from ? "ACTIONED" : "DISMISSED" },
        });
      }
      await tx.answer.update({
        where: { id: answerId },
        data: {
          newsTag: to,
          newsSourceName: sourceName,
          newsSourceUrl: sourceUrl,
          newsReviewStatus: review,
        },
      });
      if (logTag)
        await tx.tagChange.create({
          data: {
            answerId,
            fromTag: from,
            toTag: to,
            byUserId: actor.id,
            reason: dto.reason,
          },
        });
      if (notifyPoster && to !== from)
        tagMail = { authorId: a.authorId, from, to };
      if (notifyPoster)
        await tx.notification.create({
          data: {
            userId: a.authorId,
            type: "TAG_CHANGED",
            title:
              dto.decision === "DECLINE_VERIFIED"
                ? "Verified News was not approved for your post"
                : `Your post is now tagged ${LABEL[to]}`,
            body: dto.reason,
            targetType: "answer",
            targetId: answerId,
          },
        });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "news.decision",
          targetType: "answer",
          targetId: answerId,
          reason: dto.reason,
          before: {
            tag: from,
            reviewStatus: a.newsReviewStatus,
            sourceName: a.newsSourceName,
          },
          after: {
            decision: dto.decision,
            tag: to,
            reviewStatus: review,
            sourceName,
          },
        },
      });
    });
    // V-44 (M-b): E11, after the commit.
    const sent = tagMail as {
      authorId: string;
      from: string;
      to: string;
    } | null;
    if (sent)
      void this.mails?.tagChanged(
        sent.authorId,
        answerId,
        sent.from,
        sent.to,
        `${answerId}:${Date.now()}`,
      );
    return this.one(answerId);
  }
}
