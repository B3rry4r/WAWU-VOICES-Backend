import { createHash, randomInt } from "node:crypto";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  ShareCard,
  ShortLink,
  ShareObjectType,
  ShareTarget,
} from "../generated/prisma/client";
import {
  CARD_RENDERER,
  type CardRenderer,
  type CardSize,
  type CardSpec,
} from "./card-renderer";
import { CARD_STORE, type CardStore } from "./card-store";
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

function updatedLine(at: Date): string {
  return `updated ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** The card's words, taken from what the page shows. A flagged post keeps only the topic line. */
export function cardSpecFor(objectType: ShareObjectType, s: Subject): CardSpec {
  let chips: string[] = [];
  let lean = s.leanLine;
  if (!s.fallback) {
    if (objectType === "QUESTION" || objectType === "WEEKLY_REPORT")
      chips = s.arguments.map((x) => `${x.voices}|${x.text}`);
    else if (objectType === "POLL_RESULT") {
      const opts =
        (s.poll as { options?: { label: string; percent?: number }[] } | null)
          ?.options ?? [];
      chips = opts.map((o) => `${o.percent ?? 0}|${o.label}`);
    } else if (objectType === "ANSWER") {
      chips = s.quote ? [s.quote.slice(0, 280)] : [];
      lean = s.place ? `A voice from ${s.place}` : "A voice from Nigeria";
    }
  } else lean = null;
  return {
    objectType,
    topicLine: s.topicLine,
    chips,
    leanLine: lean,
    basedOnVoices: s.fallback ? null : s.basedOnVoices,
    updatedLine: updatedLine(s.summaryUpdatedAt),
    newsTag: s.fallback
      ? null
      : ((s.news as { tag?: string } | null)?.tag ?? null),
    fallback: s.fallback,
  };
}

function specHash(spec: CardSpec): string {
  const { updatedLine: _u, ...rest } = spec;
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

  private async draw(code: string): Promise<void> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card || card.status !== "PENDING") return;
    const spec: CardSpec = {
      objectType: link.objectType,
      topicLine: card.topicLine,
      chips: card.argumentChips,
      leanLine: card.leanLine,
      basedOnVoices: card.basedOnVoices,
      updatedLine: updatedLine(card.summaryUpdatedAt ?? card.createdAt),
      newsTag: card.newsTag,
      fallback: card.failureReason === "fallback",
    };
    const hash = specHash(spec);
    try {
      const ids: Partial<Record<CardSize, string>> = {};
      for (const size of ["story", "square"] as const) {
        const png = await this.renderer.render(spec, size);
        const key = `share/${code}/${size}-${hash.slice(0, 12)}.png`;
        await this.store.put(key, png, "image/png");
        const file = await this.prisma.storedFile.upsert({
          where: { key },
          update: { bytes: png.length, confirmedAt: new Date() },
          create: {
            kind: "SHARE_CARD",
            key,
            mime: "image/png",
            bytes: png.length,
            confirmedAt: new Date(),
          },
          select: { id: true },
        });
        ids[size] = file.id;
      }
      await this.prisma.shareCard.update({
        where: { id: card.id },
        data: {
          status: spec.fallback ? "FALLBACK" : "READY",
          storyFileId: ids.story,
          squareFileId: ids.square,
          failureReason: spec.fallback ? "fallback" : null,
          readyAt: new Date(),
        },
      });
    } catch (e) {
      await this.prisma.shareCard.update({
        where: { id: card.id },
        data: { status: "FAILED", failureReason: String(e).slice(0, 300) },
      });
      throw e;
    }
  }

  /** The PNG for a card, or null when it is not ready (the route answers 202 or 404). */
  async image(
    code: string,
    size: CardSize,
  ): Promise<{ png: Buffer } | { pending: true } | null> {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { cards: true },
    });
    const card = link?.cards.find((c) => c.language === LANG_DEFAULT);
    if (!link || !card) return null;
    if (card.status === "FAILED") return null;
    const fileId = size === "story" ? card.storyFileId : card.squareFileId;
    if (card.status === "PENDING" || !fileId) {
      this.queue(code);
      return { pending: true };
    }
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });
    const png = file ? await this.store.get(file.key) : null;
    if (!png) {
      // The object is gone from storage: draw again.
      await this.prisma.shareCard.update({
        where: { id: card.id },
        data: { status: "PENDING", storyFileId: null, squareFileId: null },
      });
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

  cardUrl(code: string, size: CardSize): string {
    return `${apiBase()}/share/${code}/card?size=${size}`;
  }

  linkView(link: ShortLink, card: ShareCard, subject: Subject) {
    const url = `${webBase()}/s/${link.code}`;
    const ready = card.status === "READY" || card.status === "FALLBACK";
    return {
      code: link.code,
      url,
      cardStatus: card.status,
      storyImageUrl:
        ready && card.storyFileId ? this.cardUrl(link.code, "story") : null,
      squareImageUrl:
        ready && card.squareFileId ? this.cardUrl(link.code, "square") : null,
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
    let card = await this.prisma.shareCard.findUnique({
      where: { linkId_language: { linkId: link.id, language } },
    });
    const same =
      card &&
      (card.status === "READY" ||
        card.status === "FALLBACK" ||
        card.status === "PENDING") &&
      specHash(spec) ===
        specHash({
          objectType: input.objectType,
          topicLine: card.topicLine,
          chips: card.argumentChips,
          leanLine: card.leanLine,
          basedOnVoices: card.basedOnVoices,
          updatedLine: "",
          newsTag: card.newsTag,
          fallback: card.failureReason === "fallback",
        });
    if (!card || !same) {
      const data = {
        status: "PENDING" as const,
        topicLine: spec.topicLine,
        argumentChips: spec.chips,
        leanLine: spec.leanLine,
        basedOnVoices: spec.basedOnVoices,
        summaryUpdatedAt: subject.summaryUpdatedAt,
        newsTag: (spec.newsTag as ShareCard["newsTag"]) ?? null,
        failureReason: spec.fallback ? "fallback" : null,
        storyFileId: null,
        squareFileId: null,
        readyAt: null,
      };
      card = await this.prisma.shareCard.upsert({
        where: { linkId_language: { linkId: link.id, language } },
        update: data,
        create: { linkId: link.id, language, ...data },
      });
    } else if (card.status === "FAILED") {
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
        imageUrl: this.cardUrl(link.code, "square"),
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
