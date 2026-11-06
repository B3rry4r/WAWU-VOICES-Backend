import { createHash, randomInt } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  ShareCard,
  ShortLink,
  ShareObjectType,
  ShareTarget,
} from "../generated/prisma/client";
import {
  CARD_RENDERER,
  type CardKind,
  type CardRenderer,
  type CardSpec,
} from "./card-renderer";
import { CARD_STORE, type CardStore } from "./card-store";
import { likePrefix } from "./like-prefix";
import { loadSubject, type Subject } from "./share-subject";

const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** A question, poll or voice card is re-drawn when it is older than this and its numbers moved. */
const LANG_DEFAULT = "en";

export function webBase(): string {
  return (
    process.env.PUBLIC_WEB_BASE ?? "https://voices.wawuafrica.com"
  ).replace(/\/$/, "");
}
export function apiBase(): string {
  return (process.env.PUBLIC_API_BASE ?? `${webBase()}/api/v1`).replace(
    /\/$/,
    "",
  );
}

function newCode(): string {
  let c = "";
  for (let i = 0; i < 7; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return c;
}

function updatedText(at: Date): string {
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

const KIND: Partial<Record<ShareObjectType, CardKind>> = {
  QUESTION: "question",
  ANSWER: "voice",
  POLL_RESULT: "poll",
  WEEKLY_REPORT: "weekly",
};

/** The card's words, taken from what the page shows. A flagged post keeps only the topic line (V-22: one 1200x630 card). */
export function cardSpecFor(objectType: ShareObjectType, s: Subject): CardSpec {
  const kind = s.fallback ? "plain" : (KIND[objectType] ?? "plain");
  return {
    kind,
    label: `Nigeria · ${s.cardLabel}`,
    headline: s.cardHeadline ?? s.topicLine,
    args: kind === "question" ? s.arguments.slice(0, 3) : [],
    rows: kind === "poll" || kind === "weekly" ? s.cardRows : [],
    pollOpen: s.pollOpen,
    quote: kind === "voice" ? (s.quote?.slice(0, 280) ?? null) : null,
    summary: kind === "plain" ? null : s.cardSummary,
    basedOnVoices: kind === "plain" ? null : s.cardVoices,
    updated: updatedText(s.summaryUpdatedAt),
    newsTag: s.fallback ? null : s.newsTagKey,
    fallback: s.fallback,
    url: webBase().replace(/^https?:\/\//, ""),
  };
}

function specHash(spec: CardSpec): string {
  const { updated: _u, ...rest } = spec;
  void _u;
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex");
}

/** Draws, stores and caches share cards. One draw per link at a time; the same words never draw twice. */
@Injectable()
export class ShareCardService {
  private readonly logger = new Logger(ShareCardService.name);
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CARD_RENDERER) private readonly renderer: CardRenderer,
    @Inject(CARD_STORE) private readonly store: CardStore,
  ) {}

  /** Start drawing in the background (target under 5 seconds). Safe to call many times. */
  queue(code: string): void {
    void this.run(code, true);
  }

  /** Resolves when nothing is being drawn. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.inflight.size)
      await Promise.allSettled([...this.inflight.values()]);
  }

  generate(code: string): Promise<void> {
    return this.run(code, false);
  }

  /** One draw per code at a time. A queued draw is registered at once, so idle() waits for it too. */
  private run(code: string, later: boolean): Promise<void> {
    const running = this.inflight.get(code);
    if (running) return running;
    const start = later
      ? new Promise<void>((ok) => setImmediate(ok))
      : Promise.resolve();
    const p = start
      .then(() => this.draw(code))
      .catch((e) => this.logger.error(`card ${code}: ${String(e)}`))
      .finally(() => this.inflight.delete(code));
    this.inflight.set(code, p);
    return p;
  }

  /** The person whose words or handle the card shows: the answer's author, or the profile's person. */
  async ownerOf(
    type: ShareObjectType,
    objectId: string,
  ): Promise<string | null> {
    if (type === "PROFILE") return objectId;
    if (type === "ANSWER") {
      const a = await this.prisma.answer.findUnique({
        where: { id: objectId },
        select: { authorId: true },
      });
      return a?.authorId ?? null;
    }
    return null;
  }

  private async draw(code: string): Promise<void> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card || card.status !== "PENDING") return;
    try {
      // Drawn from the thing as it is now, so a card is never older than its request.
      const subject = await loadSubject(
        this.prisma,
        link.objectType,
        link.objectId,
      );
      if (!subject) throw new Error("the shared thing is gone");
      const spec = cardSpecFor(link.objectType, subject);
      const png = await this.renderer.render(spec);
      const key = `share/${code}/card-${specHash(spec).slice(0, 12)}.png`;
      await this.store.put(key, png, "image/png");
      // The one 1200x630 card lives in storyFileId (the schema is fenced; squareFileId stays null).
      // Privacy P2-2: lock the subject owner's User row FOR SHARE first (the purge takes it FOR UPDATE). If the owner was
      // purged, or the purge removed this card meanwhile, the file is marked for deletion and not linked.
      const ownerId = await this.ownerOf(link.objectType, link.objectId);
      await this.prisma.$transaction(async (tx) => {
        let gone = false;
        if (ownerId) {
          const o = await tx.$queryRaw<{ status: string }[]>`
            SELECT status::text FROM "User" WHERE id = ${ownerId} FOR SHARE`;
          gone = o.length === 0 || o[0].status === "DELETED";
        }
        const still = await tx.shareCard.findUnique({
          where: { id: card.id },
          select: { id: true, storyFileId: true },
        });
        if (!still) gone = true;
        // Privacy P3: a row the job already purged (its object deleted) is reset, so a late re-put is deleted again.
        // A live owner with a linked card gets a normal live file (no mark); otherwise the file is marked for deletion.
        const mark = gone ? new Date() : null;
        const file = await tx.storedFile.upsert({
          where: { key },
          update: {
            bytes: png.length,
            confirmedAt: new Date(),
            purgedAt: null,
            purgeRequestedAt: mark,
          },
          create: {
            kind: "SHARE_CARD",
            key,
            mime: "image/png",
            bytes: png.length,
            confirmedAt: new Date(),
            purgeRequestedAt: mark,
          },
          select: { id: true },
        });
        // Privacy P3: a card that already named another file lets it go (the job keeps it while anything else names it).
        if (!gone && still?.storyFileId && still.storyFileId !== file.id)
          await tx.storedFile.updateMany({
            where: {
              id: still.storyFileId,
              purgedAt: null,
              purgeRequestedAt: null,
            },
            data: { purgeRequestedAt: new Date() },
          });
        if (gone) return;
        await tx.shareCard.update({
          where: { id: card.id },
          data: {
            status: spec.fallback ? "FALLBACK" : "READY",
            storyFileId: file.id,
            squareFileId: null,
            failureReason: null,
            readyAt: new Date(),
          },
        });
      });
    } catch (e) {
      await this.prisma.shareCard.updateMany({
        where: { id: card.id },
        data: { status: "FAILED", failureReason: String(e).slice(0, 300) },
      });
      throw e;
    }
  }

  /**
   * The 1080 x 1920 Instagram Stories card, drawn on request from the thing as it is now and never stored (nothing to
   * purge). Null for an unknown link, a card the person's deletion removed, or a failed card.
   */
  async storyImage(code: string): Promise<Buffer | null> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card || card.status === "FAILED") return null;
    const subject = await loadSubject(
      this.prisma,
      link.objectType,
      link.objectId,
    );
    if (!subject) return null;
    return this.renderer.render(cardSpecFor(link.objectType, subject), "story");
  }

  /**
   * The PNG for a card: {png}, {pending} while it is drawn, null for an unknown or failed card. A storage read error is
   * a 503 (UNAVAILABLE), not a 500.
   */
  async image(
    code: string,
  ): Promise<{ png: Buffer } | { pending: true } | null> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card) return null;
    if (card.status === "FAILED") return null;
    if (card.status === "PENDING" || !card.storyFileId) {
      this.queue(code);
      return { pending: true };
    }
    const file = await this.prisma.storedFile.findUnique({
      where: { id: card.storyFileId },
    });
    let png: Buffer | null = null;
    try {
      png = file ? await this.store.get(file.key) : null;
    } catch (e) {
      this.logger.error(`card ${code}: storage read failed: ${String(e)}`);
      throw new ServiceUnavailableException({
        code: "UNAVAILABLE",
        message: "VOICES is not available right now. Try again soon.",
      });
    }
    if (!png) {
      // The object is gone from storage: draw again.
      // updateMany: a purge may have deleted the card meanwhile, which is a plain 404 (null), never a P2025 500.
      const reset = await this.prisma.shareCard.updateMany({
        where: { id: card.id },
        data: { status: "PENDING", storyFileId: null, squareFileId: null },
      });
      if (reset.count === 0) return null;
      this.queue(code);
      return { pending: true };
    }
    return { png };
  }
}

export interface Sharer {
  userId: string;
  referralCode: string;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: ShareCardService,
  ) {}

  cardUrl(code: string): string {
    return `${apiBase()}/share/${code}/card`;
  }

  linkView(link: ShortLink, card: ShareCard, subject: Subject) {
    const url = `${webBase()}/s/${link.code}`;
    const ready = card.status === "READY" || card.status === "FALLBACK";
    return {
      code: link.code,
      url,
      cardStatus: card.status,
      // Story and square are not drawn (V-22): null at launch. imageUrl is the one card.
      storyImageUrl: null,
      squareImageUrl: null,
      imageUrl: ready && card.storyFileId ? this.cardUrl(link.code) : null,
      previewText: `${subject.topicLine}\nAdd your voice: ${url}`,
    };
  }

  async createLink(
    sharer: Sharer | null,
    input: { objectType: ShareObjectType; objectId: string; language?: string },
  ) {
    const subject = await loadSubject(
      this.prisma,
      input.objectType,
      input.objectId,
    );
    if (!subject) throw new NotFoundException();
    const spec = cardSpecFor(input.objectType, subject);

    let link = await this.prisma.shortLink.findFirst({
      where: {
        objectType: input.objectType,
        objectId: input.objectId,
        sharerId: sharer?.userId ?? null,
      },
      orderBy: { createdAt: "asc" },
    });
    for (let tries = 0; !link; tries++) {
      try {
        link = await this.prisma.shortLink.create({
          data: {
            code: newCode(),
            objectType: input.objectType,
            objectId: input.objectId,
            sharerId: sharer?.userId ?? null,
            referralCode: sharer?.referralCode ?? null,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002" || tries > 8) throw e;
      }
    }

    const language = LANG_DEFAULT;
    const hash = specHash(spec).slice(0, 12);
    // Privacy P2-2/P3: the owner is read before the transaction (no pool call inside it). Lock order is the User row
    // first (FOR SHARE, as the draw takes it), then the card row.
    const ownerId = await this.cards.ownerOf(link.objectType, link.objectId);
    const linkId = link.id;
    const code = link.code;
    let card = await this.prisma.$transaction(async (tx) => {
      if (ownerId)
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${ownerId} FOR SHARE`;
      // The card row is locked while it is read and reset, so two overlapping redraws cannot both act on a stale read.
      await tx.$queryRaw`SELECT id FROM "ShareCard" WHERE "linkId" = ${linkId} AND language = ${language} FOR UPDATE`;
      const cur = await tx.shareCard.findUnique({
        where: { linkId_language: { linkId, language } },
      });
      const file =
        cur?.storyFileId &&
        (cur.status === "READY" || cur.status === "FALLBACK")
          ? await tx.storedFile.findUnique({
              where: { id: cur.storyFileId },
              select: { key: true },
            })
          : null;
      const same = !!file && file.key.endsWith(`card-${hash}.png`);
      if (cur && (cur.status === "PENDING" || same)) return cur;
      const data = {
        status: "PENDING" as const,
        topicLine: spec.headline,
        argumentChips: [] as string[],
        leanLine: spec.summary,
        basedOnVoices: spec.basedOnVoices,
        summaryUpdatedAt: subject.summaryUpdatedAt,
        newsTag: null,
        failureReason: null,
        storyFileId: null,
        squareFileId: null,
        readyAt: null,
      };
      // Privacy P3: the redraw drops the link to the old image. Every live image under this link's code that the
      // reset card will not name is marked for deletion (not only the one this read saw: an overlapping redraw may
      // have linked another since). Rows a draw holds are skipped: that draw is about to link them.
      await tx.$executeRaw`
        UPDATE "StoredFile" SET "purgeRequestedAt" = now()
        WHERE id IN (
          SELECT id FROM "StoredFile"
          WHERE kind = 'SHARE_CARD' AND "purgedAt" IS NULL AND "purgeRequestedAt" IS NULL
            AND key LIKE ${likePrefix(`share/${code}/`)} ESCAPE '\\'
          FOR UPDATE SKIP LOCKED)`;
      return tx.shareCard.upsert({
        where: { linkId_language: { linkId, language } },
        update: data,
        create: { linkId, language, ...data },
      });
    });
    if (card.status === "FAILED") {
      card = await this.prisma.shareCard.update({
        where: { id: card.id },
        data: { status: "PENDING" },
      });
    }
    if (card.status === "PENDING") this.cards.queue(link.code);
    return this.linkView(link, card, subject);
  }

  private async byCode(code: string) {
    if (!/^[a-z0-9]{7}$/.test(code)) throw new NotFoundException();
    const link = await this.prisma.shortLink.findUnique({ where: { code } });
    if (!link) throw new NotFoundException();
    return link;
  }

  async page(code: string) {
    const link = await this.byCode(code);
    const s = await loadSubject(this.prisma, link.objectType, link.objectId);
    if (!s) throw new NotFoundException();
    const url = `${webBase()}/s/${link.code}`;
    return {
      code: link.code,
      objectType: link.objectType,
      topicLine: s.topicLine,
      countryAndTheme: s.countryAndTheme,
      arguments: s.fallback ? [] : s.arguments,
      leanLine: s.leanLine,
      poll: s.poll,
      proposalCount: s.proposalCount,
      topProposal: s.topProposal,
      news: s.news,
      basedOnVoices: s.basedOnVoices,
      summaryUpdatedAt: s.summaryUpdatedAt.toISOString(),
      summaryLabel: s.summaryLabel,
      featuredVoice: s.featuredVoice,
      transcript: s.transcript,
      question: s.question,
      report: s.report,
      cardFallback: s.fallback,
      ctaLabel: "Add your voice",
      openGraph: {
        title: s.topicLine,
        description: s.leanLine ?? "Add your voice",
        imageUrl: this.cardUrl(link.code),
        url,
      },
    };
  }

  async recordEvent(
    code: string,
    who: { userId: string | null; guestId: string | null },
    ev: { kind: string; target?: ShareTarget },
  ): Promise<void> {
    const link = await this.byCode(code);
    await this.prisma.shareEvent.create({
      data: {
        linkId: link.id,
        kind: ev.kind,
        target: ev.target ?? null,
        userId: who.userId,
        guestId: who.userId ? null : who.guestId,
      },
    });
    if (ev.kind === "intent" && link.objectType === "ANSWER")
      await this.prisma.answer.updateMany({
        where: { id: link.objectId },
        data: { shareCount: { increment: 1 } },
      });
  }
}
