import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PrismaService } from "../common/prisma/prisma.service";
import type { CurrentMeInfo } from "./me-context";

const EXPORT_LINK_SECONDS = 24 * 60 * 60;

/** Where export files go: the VOICES Spaces bucket (V-3). Tests replace this class. */
@Injectable()
export class ExportStore {
  isConfigured(): boolean {
    return !!(
      process.env.SPACES_ENDPOINT &&
      process.env.SPACES_BUCKET &&
      process.env.SPACES_KEY &&
      process.env.SPACES_SECRET
    );
  }

  private client(): S3Client {
    return new S3Client({
      endpoint: process.env.SPACES_ENDPOINT,
      region: process.env.SPACES_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.SPACES_KEY ?? "",
        secretAccessKey: process.env.SPACES_SECRET ?? "",
      },
    });
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.client().send(
      new PutObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    );
  }

  signedGet(key: string): Promise<string> {
    return getSignedUrl(
      this.client(),
      new GetObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        ResponseContentDisposition: 'attachment; filename="voices-export.json"',
      }),
      { expiresIn: EXPORT_LINK_SECONDS },
    );
  }
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ExportStore,
  ) {}

  /** POST /me/export. One export a day: a pending or fresh one is returned instead of a new one. */
  async request(me: CurrentMeInfo) {
    const latest = await this.prisma.dataExport.findFirst({
      where: { userId: me.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (
      latest &&
      latest.status !== "EXPIRED" &&
      latest.createdAt.getTime() > dayAgo
    )
      return this.view(latest);
    const row = await this.prisma.dataExport.create({
      data: { userId: me.id },
    });
    void this.build(row.id, me.id).catch((e) =>
      this.logger.error(`export ${row.id} failed: ${String(e)}`),
    );
    return this.view(row);
  }

  async latest(me: CurrentMeInfo) {
    const row = await this.prisma.dataExport.findFirst({
      where: { userId: me.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!row)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "You have not asked for an export yet.",
      });
    return this.view(row);
  }

  private async view(row: {
    id: string;
    status: string;
    fileId: string | null;
    createdAt: Date;
    expiresAt: Date | null;
  }) {
    let status = row.status;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now())
      status = "EXPIRED";
    let downloadUrl: string | null = null;
    if (status === "READY" && row.fileId && this.store.isConfigured()) {
      const f = await this.prisma.storedFile.findUnique({
        where: { id: row.fileId },
      });
      if (f) downloadUrl = await this.store.signedGet(f.key);
    }
    return {
      id: row.id,
      status,
      downloadUrl,
      requestedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
  }

  /**
   * Builds the file: profile, settings, posts with transcripts, replies, saved ids, the person's own listen records and the Voice Units history.
   * Without Spaces keys the export stays PENDING (it is never faked); it is retried by the next request after a day.
   */
  async build(exportId: string, userId: string): Promise<void> {
    if (!this.store.isConfigured()) return;
    const [
      user,
      answers,
      replies,
      proposals,
      saves,
      savedQs,
      entries,
      listens,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { settings: true, categories: true },
      }),
      this.prisma.answer.findMany({
        where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
        include: { clip: { include: { transcript: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.reply.findMany({
        where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
        include: { clip: { include: { transcript: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.proposal.findMany({
        where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
      }),
      this.prisma.save.findMany({ where: { userId } }),
      this.prisma.savedQuestion.findMany({ where: { userId } }),
      this.prisma.ledgerEntry.findMany({
        where: { walletUserId: userId },
        include: { txn: true },
        orderBy: { createdAt: "asc" },
      }),
      // LISTEN-1: the person's own listen records (never anyone else's).
      this.prisma.answerListen.findMany({
        where: { userId },
        orderBy: { firstAt: "asc" },
      }),
    ]);
    if (!user) return;
    const body = {
      exportedAt: new Date().toISOString(),
      profile: {
        handle: user.handle,
        displayName: user.displayName,
        bio: user.bio,
        countryCode: user.countryCode,
        state: user.state,
        city: user.city,
        languages: user.languages,
        joinedAt: user.createdAt,
      },
      settings: user.settings,
      topicsFollowed: user.categories.map((c) => c.categoryId),
      answers: answers.map((a) => ({
        id: a.id,
        questionId: a.questionId,
        kind: a.kind,
        body: a.body,
        transcript: a.clip?.transcript?.text ?? null,
        createdAt: a.createdAt,
      })),
      replies: replies.map((r) => ({
        id: r.id,
        answerId: r.answerId,
        stance: r.stance,
        body: r.body,
        transcript: r.clip?.transcript?.text ?? null,
        createdAt: r.createdAt,
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        questionId: p.questionId,
        body: p.body,
        createdAt: p.createdAt,
      })),
      saved: {
        answers: saves.map((s) => s.answerId),
        questions: savedQs.map((s) => s.questionId),
      },
      listens: listens.map((l) => ({
        answerId: l.answerId,
        secondsPlayed: l.secondsPlayed,
        finished: l.finished,
        firstAt: l.firstAt,
        lastAt: l.lastAt,
      })),
      voiceUnitsHistory: entries.map((e) => ({
        at: e.createdAt,
        kind: e.txn.kind,
        deltaMilli: e.deltaMilli,
        balanceAfterMilli: e.balanceAfterMilli,
        reason: e.txn.reason,
      })),
    };
    const key = `exports/${userId}/${randomUUID()}.json`;
    const buf = Buffer.from(JSON.stringify(body, null, 2), "utf8");
    await this.store.put(key, buf);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Privacy P2-2: lock order is the User row first. FOR SHARE waits for a purge that holds FOR UPDATE on this row,
      // and makes a purge wait for this transaction, so the purge always sees the file we link (or we see DELETED).
      const owner = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM "User" WHERE id = ${userId} FOR SHARE`;
      const gone = owner.length === 0 || owner[0].status === "DELETED";
      const file = await tx.storedFile.create({
        data: {
          ownerId: userId,
          kind: "DATA_EXPORT",
          key,
          mime: "application/json",
          bytes: buf.length,
          confirmedAt: now,
          ...(gone ? { purgeRequestedAt: now } : {}),
        },
      });
      if (gone) {
        await tx.dataExport.update({
          where: { id: exportId },
          data: { status: "EXPIRED", expiresAt: now },
        });
        return;
      }
      await tx.dataExport.update({
        where: { id: exportId },
        data: {
          status: "READY",
          fileId: file.id,
          readyAt: now,
          expiresAt: new Date(now.getTime() + EXPORT_LINK_SECONDS * 1000),
        },
      });
    });
  }
}
