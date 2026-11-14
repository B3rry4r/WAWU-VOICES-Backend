import {
  FileAttachService,
  type FileTx,
} from "../../media/file-attach.service";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import type {
  Ad,
  AdKind,
  AdStatus,
  Prisma,
} from "../../generated/prisma/client";
import type { CurrentMeInfo } from "../../me/me-context";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import {
  conflict,
  dateOnly,
  invalid,
  isoDate,
  isRealDate,
  lagosDay,
  lockRow,
  notFound,
} from "./common";
import type {
  AdDecisionDto,
  AdListQuery,
  UpdateAdDto,
  UpsertAdDto,
} from "./dto";

/** Generic words that must not appear in an advert's brand, headline or body: betting and gambling, tobacco, health claims. */
const BANNED_WORDS = new RegExp(
  "\\b(" +
    [
      "vote for",
      "election",
      "tobacco",
      "cigarettes?",
      "cures?",
      "miracle",
      "bet",
      "bets",
      "betting",
      "bookie",
      "bookmaker",
      "sportsbook",
      "gambl(?:e|es|ing|er)",
      "wager",
      "stakes?",
      "jackpot",
      "casino",
      "lotto",
      "lottery",
      "poker",
      "roulette",
      "slots?",
      "odds",
      "payday",
      "loan shark",
    ].join("|") +
    ")\\b",
  "i",
);

/** Nigerian betting operators, matched INSIDE words after spaces and punctuation are removed ("B e t 9 j a", "bet-way"). */
export const BETTING_BRANDS = [
  "bet9ja",
  "1xbet",
  "betway",
  "nairabet",
  "sportybet",
  "betking",
  "msport",
  "merrybet",
  "bangbet",
  "livescorebet",
  "accessbet",
  "supabet",
  "bet365",
  "22bet",
  "parimatch",
  "footballpools",
  "betbonanza",
  "goldenbet",
];

/** Lending-app phrases (loan sharks), matched inside words the same way. A bare "loan" is not blocked: banks advertise loans. */
export const LOAN_APP_PHRASES = [
  "instantloan",
  "quickloan",
  "loanapp",
  "paylater",
  "fastcash",
  "quickcash",
  "instantcash",
  "nocollateral",
  "fastloan",
  "easyloan",
  "cashadvance",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
};

/** Lower case, with runs of single spaced letters joined ("g a m b l i n g" becomes "gambling"). */
function joinSpaced(t: string): string {
  return t
    .toLowerCase()
    .replace(
      /(?:^|(?<=[\s]))(?:[a-z0-9@$][\s._\-*]+){2,}[a-z0-9@$](?=$|[\s.,!?])/g,
      (m) => m.replace(/[\s._\-*]+/g, ""),
    );
}

/** True when the text (brand, headline, body together) carries betting, gambling, lending-app or other banned wording. */
export function hasBannedWording(text: string): boolean {
  const joined = joinSpaced(text);
  const leeted = joined.replace(/[01345789@$]/g, (c) => LEET[c] ?? c);
  if (BANNED_WORDS.test(joined) || BANNED_WORDS.test(leeted)) return true;
  const compact = (t: string) => t.replace(/[^a-z0-9]/g, "");
  const raw = compact(text.toLowerCase());
  const lt = compact(leeted);
  return [...BETTING_BRANDS, ...LOAN_APP_PHRASES].some((w) => {
    const k = compact(w);
    return (
      raw.includes(k) ||
      lt.includes(k.replace(/[01345789]/g, (c) => LEET[c] ?? c))
    );
  });
}

/** The topics an advert is kept away from (AdminAds board: politics, religion, health, sexual life), matched to category slug or name. */
export const KEPT_AWAY = /(politic|religio|health|sex|tribe)/i;

/** The longest audio advert (addendum 3B: a short audio ad slot). */
export const AD_AUDIO_MAX_MS = 30_000;

@Injectable()
export class AdminAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileAttachService,
  ) {}

  /** The words and kept-away screens, computed from the advert itself (never fixed green). */
  private screens(
    a: Ad,
    categories: { slug: string; name: string }[],
  ): { wordsOk: boolean; categoriesOk: boolean; badCategories: string[] } {
    const wordsOk = !hasBannedWording(
      `${a.brand} ${a.headline} ${a.body ?? ""}`,
    );
    const badCategories = categories
      .filter((c) => KEPT_AWAY.test(c.slug) || KEPT_AWAY.test(c.name))
      .map((c) => c.name);
    return { wordsOk, categoriesOk: badCategories.length === 0, badCategories };
  }

  /** Refuses (422, plain reason) an advert that fails the wording or kept-away screens. Used by APPROVE and RESUME. */
  private async assertScreens(tx: Prisma.TransactionClient, a: Ad) {
    const cats = a.categoryIds.length
      ? await tx.category.findMany({
          where: { id: { in: a.categoryIds } },
          select: { slug: true, name: true },
        })
      : [];
    const sc = this.screens(a, cats);
    if (!sc.wordsOk)
      throw invalid(
        "decision",
        "This advert has betting, gambling, lending-app, tobacco or health-claim wording. Ask for changes or reject it.",
      );
    if (!sc.categoriesOk)
      throw invalid(
        "decision",
        `This advert is aimed at ${sc.badCategories.join(", ")}, which adverts are kept away from. Ask for changes or reject it.`,
      );
  }

  /** The four checks the approval card shows. APPROVE refuses while any of them fails (lead ruling WF, 6 Nov, C-M8). */
  private checks(
    a: Ad,
    screens: { wordsOk: boolean; categoriesOk: boolean },
    c:
      | { status: string; transcript: { text: string | null } | null }
      | null
      | undefined,
  ): { text: string; ok: boolean }[] {
    return [
      {
        text: "Labelled Ad, with a working link",
        ok:
          a.kind === "WALLET_OFFER"
            ? true
            : /^https:\/\//i.test(a.linkUrl ?? ""),
      },
      {
        text: "Not political, betting, tobacco or a health claim",
        ok: screens.wordsOk && screens.categoriesOk,
      },
      {
        text: "Audio plays only on tap; transcript checked",
        ok: a.audioClipId
          ? !!c && c.status === "READY" && !!c.transcript?.text
          : a.kind !== "AUDIO_SLOT",
      },
      {
        text: "Dates are set and in order",
        ok:
          !!a.startsOn &&
          !!a.endsOn &&
          a.endsOn.getTime() >= a.startsOn.getTime(),
      },
    ];
  }

  /** 422 naming the first failing check, after the wording screens have had their say. */
  private async assertChecks(tx: Prisma.TransactionClient, a_: Ad) {
    await this.assertScreens(tx, a_);
    // One after the other: `tx` is a transaction's connection (C-L8).
    const cats = a_.categoryIds.length
      ? await tx.category.findMany({
          where: { id: { in: a_.categoryIds } },
          select: { slug: true, name: true },
        })
      : [];
    const clip = a_.audioClipId
      ? await tx.voiceClip.findUnique({
          where: { id: a_.audioClipId },
          include: { transcript: true },
        })
      : null;
    const failing = this.checks(a_, this.screens(a_, cats), clip).find(
      (x) => !x.ok,
    );
    if (failing)
      throw invalid(
        "decision",
        `This advert cannot be approved yet. It fails a check: ${failing.text}.`,
      );
  }

  private async view(rows: Ad[]) {
    const catIds = [...new Set(rows.flatMap((r) => r.categoryIds))];
    const cats = catIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: catIds } },
          select: { id: true, slug: true, name: true },
        })
      : [];
    const fileIds = rows
      .map((r) => r.imageFileId)
      .filter((x): x is string => !!x);
    const clipIds = rows
      .map((r) => r.audioClipId)
      .filter((x): x is string => !!x);
    const [files, clips, evs] = await Promise.all([
      fileIds.length
        ? this.prisma.storedFile.findMany({ where: { id: { in: fileIds } } })
        : [],
      clipIds.length
        ? this.prisma.voiceClip.findMany({
            where: { id: { in: clipIds } },
            include: { transcript: true },
          })
        : [],
      rows.length
        ? this.prisma.adEvent.groupBy({
            by: ["adId", "kind"],
            where: { adId: { in: rows.map((r) => r.id) } },
            _count: { _all: true },
          })
        : [],
    ]);
    const base = process.env.SPACES_CDN_BASE?.replace(/\/$/, "");
    const key = new Map(files.map((f) => [f.id, f.key]));
    const clip = new Map(clips.map((c) => [c.id, c]));
    const today = lagosDay();
    const n = (adId: string, kind: string) =>
      evs.find((e) => e.adId === adId && (e.kind as string) === kind)?._count
        ._all ?? 0;
    return rows.map((a) => {
      const c = a.audioClipId ? clip.get(a.audioClipId) : null;
      const screens = this.screens(
        a,
        cats.filter((x) => a.categoryIds.includes(x.id)),
      );
      const checks = this.checks(a, screens, c);
      const starts = isoDate(a.startsOn);
      const ends = isoDate(a.endsOn);
      return {
        live:
          a.status === "APPROVED" &&
          (!starts || starts <= today) &&
          (!ends || ends >= today),
        ageBands: a.ageBands,
        checks,
        id: a.id,
        brand: a.brand,
        brandId: a.brandId,
        kind: a.kind,
        status: a.status,
        headline: a.headline,
        body: a.body,
        linkUrl: a.linkUrl,
        ctaLabel: a.ctaLabel,
        imageUrl:
          a.imageFileId && base && key.get(a.imageFileId)
            ? `${base}/${key.get(a.imageFileId)}`
            : null,
        audioClipId: a.audioClipId,
        categoryIds: a.categoryIds,
        states: a.states,
        startsOn: starts,
        endsOn: ends,
        frequencyCapPerDay: a.frequencyCapPerDay,
        priceKobo: a.priceKobo,
        views: n(a.id, "IMPRESSION"),
        taps: n(a.id, "TAP"),
        listens: n(a.id, "LISTEN"),
        rejectReason: a.rejectReason,
        changeRequest: a.changeRequest,
      };
    });
  }

  async list(q: AdListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.ad.findMany({
      where: {
        ...(q.status ? { status: q.status as AdStatus } : {}),
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
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: await this.view(slice),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
      awaitingApproval: await this.prisma.ad.count({
        where: { status: "AWAITING_APPROVAL" },
      }),
    };
  }

  private async check(dto: Partial<UpsertAdDto>) {
    if (dto.linkUrl) {
      try {
        const u = new URL(dto.linkUrl);
        // G9: the hint says https://, so an http:// link is refused here and fails the "working link" check.
        // V-FIX-B round 2: the same bar for every kind of advert, on create and on update: a real https address with a host that
        // has a dot, no sign-in part. (javascript:, data:, ftp:, http: and "https:x" are all refused.)
        if (
          u.protocol !== "https:" ||
          !u.hostname.includes(".") ||
          u.username ||
          u.password
        )
          throw new Error();
      } catch {
        throw invalid("linkUrl", "Use a full link that starts with https://.");
      }
    }
    for (const k of ["startsOn", "endsOn"] as const) {
      const v = dto[k];
      if (v && !isRealDate(v)) throw invalid(k, "Use a real date.");
    }
    if (dto.startsOn && dto.endsOn && dto.endsOn < dto.startsOn)
      throw invalid("endsOn", "The end date comes before the start date.");
    if (dto.imageFileId) {
      // Right kind, in the bucket; an upload never completed is confirmed here (privacy fix PF2).
      const ok = await this.files.confirm(dto.imageFileId, {
        kind: "AD_CREATIVE",
      });
      if (!ok) throw invalid("imageFileId", "That image was not found.");
    }
    if (dto.audioClipId) {
      const c = await this.prisma.voiceClip.findUnique({
        where: { id: dto.audioClipId },
      });
      if (!c || c.status !== "READY")
        throw invalid("audioClipId", "That audio is not ready.");
      // A survey answer is private to the brand's report and never plays in public.
      if (
        c.purpose === "SURVEY_ANSWER" ||
        (await this.prisma.surveyAnswer.count({ where: { clipId: c.id } })) > 0
      )
        throw invalid("audioClipId", "That audio is not available.");
      // V-FIX-B: an advert plays an advert's own recording, and a short one ("a short audio ad slot", addendum 3B).
      if (c.purpose !== "AD_AUDIO")
        throw invalid("audioClipId", "That is not an advert recording.");
      if ((c.durationMs ?? 0) > AD_AUDIO_MAX_MS)
        throw invalid("audioClipId", "An audio advert is 30 seconds at most.");
    }
    if (dto.categoryIds?.length) {
      const n = await this.prisma.category.count({
        where: { id: { in: dto.categoryIds } },
      });
      if (n !== new Set(dto.categoryIds).size)
        throw invalid("categoryIds", "One of those categories does not exist.");
    }
    if (dto.brandId) {
      const b = await this.prisma.brand.findUnique({
        where: { id: dto.brandId },
        select: { id: true },
      });
      if (!b) throw invalid("brandId", "That brand was not found.");
    }
  }

  private data(dto: Partial<UpsertAdDto>): Prisma.AdUncheckedUpdateInput {
    const d: Prisma.AdUncheckedUpdateInput = {};
    if (dto.brand !== undefined) d.brand = dto.brand;
    if (dto.brandId !== undefined) d.brandId = dto.brandId;
    if (dto.kind !== undefined) d.kind = dto.kind as AdKind;
    if (dto.headline !== undefined) d.headline = dto.headline;
    if (dto.body !== undefined) d.body = dto.body;
    if (dto.linkUrl !== undefined) d.linkUrl = dto.linkUrl;
    if (dto.ctaLabel !== undefined) d.ctaLabel = dto.ctaLabel;
    if (dto.imageFileId !== undefined) d.imageFileId = dto.imageFileId;
    if (dto.audioClipId !== undefined) d.audioClipId = dto.audioClipId;
    if (dto.categoryIds !== undefined) d.categoryIds = dto.categoryIds;
    if (dto.states !== undefined) d.states = dto.states;
    if (dto.ageBands !== undefined) d.ageBands = dto.ageBands;
    if (dto.startsOn !== undefined) d.startsOn = dateOnly(dto.startsOn);
    if (dto.endsOn !== undefined) d.endsOn = dateOnly(dto.endsOn);
    if (dto.frequencyCapPerDay !== undefined)
      d.frequencyCapPerDay = dto.frequencyCapPerDay;
    if (dto.priceKobo !== undefined) d.priceKobo = dto.priceKobo;
    return d;
  }

  private async claimImage(tx: FileTx, fileId: string): Promise<void> {
    if (!(await this.files.claim(tx, fileId)))
      throw invalid("imageFileId", "That image was not found.");
  }

  async create(actor: CurrentMeInfo, dto: UpsertAdDto) {
    await this.check(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      const ad = await tx.ad.create({
        data: {
          ...(this.data(dto) as Prisma.AdUncheckedCreateInput),
          brand: dto.brand,
          kind: dto.kind as AdKind,
          headline: dto.headline,
          status: "AWAITING_APPROVAL",
          createdById: actor.id,
        },
      });
      if (dto.imageFileId) await this.claimImage(tx, dto.imageFileId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ad.create",
          targetType: "ad",
          targetId: ad.id,
          after: { brand: ad.brand, kind: ad.kind, status: ad.status },
        },
      });
      return ad;
    });
    return (await this.view([row]))[0];
  }

  async update(actor: CurrentMeInfo, adId: string, dto: UpdateAdDto) {
    await this.check(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "Ad", "id", adId);
      const a = await tx.ad.findUnique({ where: { id: adId } });
      if (!a) throw notFound("We could not find that advert.");
      if (a.status === "APPROVED" || a.status === "REJECTED")
        throw conflict(
          a.status === "APPROVED"
            ? "Pause the advert before you edit it."
            : "A rejected advert cannot be edited. Make a new one.",
        );
      // A dates-only edit is checked against the saved other date too.
      {
        const iso = (d: Date | null) =>
          d ? d.toISOString().slice(0, 10) : null;
        const from = dto.startsOn ?? iso(a.startsOn);
        const to = dto.endsOn ?? iso(a.endsOn);
        if (from && to && to < from)
          throw invalid("endsOn", "The end date comes before the start date.");
      }
      // Changing what people see or hear on a paused advert sends it back to the approval queue: it was approved as it was.
      const CONTENT: (keyof UpsertAdDto)[] = [
        "brand",
        "brandId",
        "kind",
        "headline",
        "body",
        "linkUrl",
        "ctaLabel",
        "imageFileId",
        "audioClipId",
        "categoryIds",
      ];
      const touched =
        a.status === "PAUSED" &&
        CONTENT.some(
          (k) => (dto as unknown as Record<string, unknown>)[k] !== undefined,
        );
      const next: AdStatus =
        a.status === "DRAFT" || touched ? "AWAITING_APPROVAL" : a.status;
      if (dto.imageFileId) await this.claimImage(tx, dto.imageFileId);
      const ad = await tx.ad.update({
        where: { id: adId },
        data: {
          ...this.data(dto),
          status: next,
          ...(a.status === "DRAFT" ? { changeRequest: null } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ad.update",
          targetType: "ad",
          targetId: adId,
          before: { headline: a.headline, brand: a.brand, status: a.status },
          after: { headline: ad.headline, brand: ad.brand, status: ad.status },
        },
      });
      return ad;
    });
    return (await this.view([row]))[0];
  }

  async decide(actor: CurrentMeInfo, adId: string, dto: AdDecisionDto) {
    const needsReason =
      dto.decision === "REJECT" || dto.decision === "ASK_FOR_CHANGES";
    if (needsReason && !dto.reason)
      throw invalid("reason", "Say why, so the brand can act on it.");
    const row = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "Ad", "id", adId);
      const a = await tx.ad.findUnique({ where: { id: adId } });
      if (!a) throw notFound("We could not find that advert.");
      const from = a.status;
      let data: Prisma.AdUncheckedUpdateInput;
      switch (dto.decision) {
        case "APPROVE":
          if (from !== "AWAITING_APPROVAL")
            throw conflict("Only an advert awaiting approval can be approved.");
          await this.assertChecks(tx, a);
          data = {
            status: "APPROVED",
            approvedById: actor.id,
            approvedAt: new Date(),
            rejectReason: null,
            changeRequest: null,
          };
          break;
        case "REJECT":
          if (from === "REJECTED")
            throw conflict("This advert is already rejected.");
          data = { status: "REJECTED", rejectReason: dto.reason };
          break;
        case "ASK_FOR_CHANGES":
          if (from !== "AWAITING_APPROVAL")
            throw conflict(
              "Only an advert awaiting approval can be sent back.",
            );
          data = { status: "DRAFT", changeRequest: dto.reason };
          break;
        case "PAUSE":
          if (from !== "APPROVED")
            throw conflict("Only a running advert can be paused.");
          data = { status: "PAUSED" };
          break;
        default:
          if (from !== "PAUSED")
            throw conflict("Only a paused advert can be resumed.");
          // Resuming is an approval too: the screens run again on what the advert says now.
          await this.assertScreens(tx, a);
          data = { status: "APPROVED" };
      }
      const ad = await tx.ad.update({ where: { id: adId }, data });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ad.decision",
          targetType: "ad",
          targetId: adId,
          reason: dto.reason ?? null,
          before: { status: from },
          after: { decision: dto.decision, status: ad.status },
        },
      });
      return ad;
    });
    return (await this.view([row]))[0];
  }
}
