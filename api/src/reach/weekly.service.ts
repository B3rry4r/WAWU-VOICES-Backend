import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { ReachService } from "./reach.service";
import { decodeCursor, encodeCursor } from "./reach-support";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "23 to 29 Nov 2026", or "30 Nov to 6 Dec 2026". Topic dates are plain dates (Lagos calendar). */
export function weekRange(startsOn: Date, endsOn: Date): string {
  const s = { d: startsOn.getUTCDate(), m: startsOn.getUTCMonth() };
  const e = { d: endsOn.getUTCDate(), m: endsOn.getUTCMonth() };
  const year = endsOn.getUTCFullYear();
  return s.m === e.m
    ? `${s.d} to ${e.d} ${MONTHS[e.m]} ${year}`
    : `${s.d} ${MONTHS[s.m]} to ${e.d} ${MONTHS[e.m]} ${year}`;
}

type ReportWithTopic = Prisma.WeeklyReportGetPayload<{
  include: { topic: true; quotes: true };
}>;

export interface WeeklyReportCard {
  id: string;
  weekNumber: number;
  title: string;
  range: string;
  mood: string | null;
  basedOnVoices: number;
  basedOnVotes: number;
  publishedAt: string;
}

export function reportCard(r: ReportWithTopic): WeeklyReportCard {
  return {
    id: r.id,
    weekNumber: r.topic.weekNumber,
    title: r.headline ?? r.topic.title,
    range: weekRange(r.topic.startsOn, r.topic.endsOn),
    mood: r.mood,
    basedOnVoices: r.basedOnVoices ?? 0,
    basedOnVotes: r.basedOnVotes ?? 0,
    publishedAt: (r.publishedAt ?? r.updatedAt).toISOString(),
  };
}

/** The weekly report screen, its archive and its share card are at launch (V-19). The PDF is week 2 (V-10). */
@Injectable()
export class WeeklyService {
  private readonly logger = new Logger(WeeklyService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reach: ReachService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.REACH_JOBS === "off")
      return;
    this.timer = setInterval(() => {
      this.publishDue().catch((e) =>
        this.logger.error(`publishDue failed: ${String(e)}`),
      );
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async archive(q: { cursor?: string; limit: number }) {
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.weeklyReport.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: { not: null },
        ...(cur
          ? {
              OR: [
                { publishedAt: { lt: cur.at } },
                { publishedAt: cur.at, id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      include: { topic: true, quotes: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const latest = cur ? null : (page[0] ?? null);
    const next = await this.prisma.weeklyReport.findFirst({
      where: { status: "APPROVED", publishAt: { not: null } },
      orderBy: { publishAt: "asc" },
      select: { publishAt: true },
    });
    return {
      latest: latest ? reportCard(latest) : null,
      items: page.map(reportCard),
      nextCursor:
        rows.length > q.limit && last?.publishedAt
          ? encodeCursor({ t: last.publishedAt.toISOString(), id: last.id })
          : null,
      nextPublishAt: next?.publishAt?.toISOString() ?? null,
    };
  }

  async latest() {
    const r = await this.prisma.weeklyReport.findFirst({
      where: { status: "PUBLISHED", publishedAt: { not: null } },
      include: { topic: true, quotes: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    });
    if (!r) throw new NotFoundException();
    return this.full(r);
  }

  async byId(id: string) {
    const r = await this.prisma.weeklyReport.findFirst({
      where: { id, status: "PUBLISHED" },
      include: { topic: true, quotes: true },
    });
    if (!r) throw new NotFoundException();
    return this.full(r);
  }

  /** Public view. Only quotes with the speaker's consent are ever stored (consentAt is required), and no handle is sent. */
  full(r: ReportWithTopic) {
    const card = reportCard(r);
    return {
      emotions: asArray(r.emotions),
      id: r.id,
      topicId: r.topicId,
      weekNumber: card.weekNumber,
      title: card.title,
      range: card.range,
      mood: r.mood,
      summary: r.summary ?? "",
      themes: r.themes ?? [],
      sentiment: r.sentiment ?? {},
      pollSummary: r.pollSummary ?? {},
      quotes: r.quotes
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((q) => ({
          excerpt: q.excerpt,
          placeLabel: q.placeLabel,
          clipUrl: null,
        })),
      basedOnVoices: card.basedOnVoices,
      basedOnVotes: card.basedOnVotes,
      label: "AI-assisted and human-reviewed" as const,
      publishedAt: card.publishedAt,
    };
  }

  /**
   * Publishes every APPROVED report whose publish time has come, then tells people (in app). One notification per
   * person per report: the dedupe key makes a second run, or two servers running it, harmless.
   */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.prisma.weeklyReport.findMany({
      where: { status: "APPROVED", publishAt: { lte: now } },
      include: { topic: true },
    });
    let published = 0;
    for (const r of due) {
      const flipped = await this.prisma.weeklyReport.updateMany({
        where: { id: r.id, status: "APPROVED" },
        data: { status: "PUBLISHED", publishedAt: now },
      });
      if (flipped.count === 0) continue;
      published++;
      await this.announce(
        r.id,
        r.topic.weekNumber,
        r.headline ?? r.topic.title,
      );
    }
    return published;
  }

  private async announce(
    reportId: string,
    weekNumber: number,
    title: string,
  ): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { status: "ACTIVE", deletionRequestedAt: null },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      });
      if (users.length === 0) return;
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: "WEEKLY_REPORT" as const,
          title: `Week ${weekNumber} report is out`,
          body: title,
          targetType: "weekly_report",
          targetId: reportId,
          groupKey: `weekly:${reportId}`,
        })),
        skipDuplicates: true,
      });
      after = users[users.length - 1].id;
      if (users.length < 500) return;
    }
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
