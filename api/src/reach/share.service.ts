import { StoryCache, storyCacheKey } from "./story-cache";
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
import { MoodStatsService } from "../mood/mood-stats.service";

const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** A question, poll or voice card is re-drawn when it is older than this and its numbers moved. */
const LANG_DEFAULT = "en";

export function webBase(): string {
  return (process.env.PUBLIC_WEB_BASE ?? "https://usevoices.com").replace(
    /\/$/,
    "",
  );
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
  const kind =
    s.mood && !s.fallback
      ? "mood"
      : s.fallback
        ? "plain"
        : (KIND[objectType] ?? "plain");
  return {
    mood: kind === "mood" && s.mood ? s.mood : undefined,
    kind,
    label: `Nigeria · ${s.cardLabel}`,
    headline: s.cardHeadline ?? s.topicLine,
    args: kind === "question" ? s.arguments.slice(0, 3) : [],
    rows: kind === "poll" || kind === "weekly" ? s.cardRows : [],
    pollOpen: s.pollOpen,
    quote: kind === "voice" ? (s.quote?.slice(0, 280) ?? null) : null,
    // The mood card carries its own line and no handle ("A voice from @..."): a name only with consent.
    summary: kind === "plain" || kind === "mood" ? null : s.cardSummary,
    basedOnVoices: kind === "plain" || kind === "mood" ? null : s.cardVoices,
    // lead ruling WF, 6 Nov (WF-5): no votes, no split line and no leader on any card.
    votes:
      kind === "weekly"
        ? (s.cardVoices ?? 0)
        : Number((s.poll as { totalVotes?: number } | null)?.totalVotes ?? 0),
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
  private readonly storyCache = new StoryCache();
  private readonly storyDrawing = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CARD_RENDERER) private readonly renderer: CardRenderer,
    @Inject(CARD_STORE) private readonly store: CardStore,
    private readonly moodStats: MoodStatsService,
  ) {}

  /**
   * H4: how long the image route waits for a card that is still being drawn before it answers 202. A link preview
   * (WhatsApp and the like) fetches the picture at once and keeps what it gets, so the first fetch of a new card must
   * be a picture. The draw takes about 2 seconds (target under 5), so this waits for it; only a draw that overruns
   * this gets the 202 and Retry-After.
   */
  pendingWaitMs = 8000;

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

  private async draw(code: string, attempt = 0): Promise<void> {
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
        this.moodStats,
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
      // LCH-03: a mood card is stored only if the name setting it was drawn with is still the answer's current one.
      const drawnWithName = !!spec.mood?.name;
      let stale = false;
      await this.prisma.$transaction(async (tx) => {
        let gone = false;
        if (spec.kind === "mood") {
          // FOR SHARE: a switch change waits for this store to finish, then drops the card it just stored.
          const cur = await tx.$queryRaw<
            { showNameOnCard: boolean; anonymous: boolean }[]
          >`SELECT "showNameOnCard", "anonymous" FROM "Answer" WHERE id = ${link.objectId} FOR SHARE`;
          const nameNow = !!cur[0]?.showNameOnCard && !cur[0]?.anonymous;
          if (!cur[0] || nameNow !== drawnWithName) {
            stale = true; // below: the picture is marked for deletion and not linked
          }
        }
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
        if (stale) gone = true;
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
      // The setting changed while this was drawn: that picture was not kept. Draw again from the answer as it is now.
      if (stale && attempt < 3) return await this.draw(code, attempt + 1);
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
    return this.sizedImage(code, "story");
  }

  /**
   * LCH-03: the 1080 x 1080 square card (WhatsApp and feeds). Only a mood card is drawn square; any other link is a
   * plain 404 here. Drawn on request and cached like the story.
   */
  async squareImage(code: string): Promise<Buffer | null> {
    return this.sizedImage(code, "square");
  }

  private async sizedImage(
    code: string,
    size: "story" | "square",
  ): Promise<Buffer | null> {
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
      this.moodStats,
    );
    if (!subject) return null;
    // The link and the person were checked above, on every request: the cache only skips the drawing.
    const spec = cardSpecFor(link.objectType, subject);
    if (size === "square" && spec.kind !== "mood") return null;
    const key = storyCacheKey({ size, spec });
    const hit = this.storyCache.get(key);
    if (hit) return hit;
    let drawing = this.storyDrawing.get(key);
    if (!drawing) {
      drawing = this.renderer
        .render(spec, size)
        .then((png) => {
          this.storyCache.set(key, png);
          return png;
        })
        .finally(() => this.storyDrawing.delete(key));
      this.storyDrawing.set(key, drawing);
    }
    return drawing;
  }

  /**
   * True for an answer whose card must not be shown: deleted, removed, or by an account that is leaving or gone.
   * H6: every answer, not only a mood one, so the card answers 404 as /story and /square do.
   */
  private async moodCardGone(
    type: ShareObjectType,
    objectId: string,
  ): Promise<boolean> {
    if (type !== "ANSWER") return false;
    const a = await this.prisma.answer.findUnique({
      where: { id: objectId },
      select: {
        status: true,
        deletedAt: true,
        author: { select: { status: true, deletionRequestedAt: true } },
      },
    });
    if (!a) return true;
    return (
      a.status === "REMOVED" ||
      a.status === "DELETED_BY_AUTHOR" ||
      !!a.deletedAt ||
      a.author.status === "DELETED" ||
      a.author.status === "DELETION_PENDING" ||
      a.author.status === "BANNED" ||
      !!a.author.deletionRequestedAt
    );
  }

  /**
   * The PNG for a card: {png}, {pending} while it is drawn, null for an unknown or failed card. A storage read error is
   * a 503 (UNAVAILABLE), not a 500.
   */
  async image(
    code: string,
    waited = false,
  ): Promise<{ png: Buffer; volatile?: boolean } | { pending: true } | null> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card) return null;
    if (card.status === "FAILED") return null;
    // LCH-03: a stored mood card is never served once its person or answer is gone (the file is kept for the purge).
    if (await this.moodCardGone(link.objectType, link.objectId)) return null;
    if (card.status === "PENDING" || !card.storyFileId) {
      if (!waited && this.pendingWaitMs > 0) {
        // H4: draw it now (joins the draw already running for this code) and answer with the picture.
        await this.drawWithin(code, this.pendingWaitMs);
        return this.image(code, true);
      }
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
      if (!waited && this.pendingWaitMs > 0) {
        await this.drawWithin(code, this.pendingWaitMs);
        return this.image(code, true);
      }
      this.queue(code);
      return { pending: true };
    }
    return {
      png,
      volatile: await this.isMoodCard(link.objectType, link.objectId),
    };
  }

  /** Runs (or joins) the draw for a code and resolves when it ends or after `ms`, whichever is first. Never rejects. */
  private async drawWithin(code: string, ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((ok) => {
      timer = setTimeout(ok, ms);
    });
    try {
      await Promise.race([this.run(code, false), limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A mood card can change under its link (the name switch, the percentage), so it is never cached long. */
  private async isMoodCard(
    type: ShareObjectType,
    objectId: string,
  ): Promise<boolean> {
    if (type !== "ANSWER") return false;
    const a = await this.prisma.answer.findUnique({
      where: { id: objectId },
      select: { mood: true },
    });
    return !!a?.mood;
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
    private readonly moodStats: MoodStatsService,
  ) {}

  cardUrl(code: string): string {
    return `${apiBase()}/share/${code}/card`;
  }

  storyUrl(code: string): string {
    return `${apiBase()}/share/${code}/story`;
  }

  squareUrl(code: string): string {
    return `${apiBase()}/share/${code}/square`;
  }

  linkView(link: ShortLink, card: ShareCard, subject: Subject) {
    const url = `${webBase()}/s/${link.code}`;
    const ready = card.status === "READY" || card.status === "FALLBACK";
    return {
      code: link.code,
      url,
      cardStatus: card.status,
      // The square is not drawn (V-22): null at launch. imageUrl is the 1200x630 card; the story is its own route and
      // is null only where that route would 404 (a failed card; an unknown or deleted link never gets a view).
      storyImageUrl: card.status === "FAILED" ? null : this.storyUrl(link.code),
      // LCH-03: the square is drawn for a mood card only (WhatsApp and feeds); null for every other kind.
      squareImageUrl:
        card.status !== "FAILED" && subject.mood
          ? this.squareUrl(link.code)
          : null,
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
      this.moodStats,
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
    const s = await loadSubject(
      this.prisma,
      link.objectType,
      link.objectId,
      this.moodStats,
    );
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
