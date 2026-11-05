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
import type { AdDecisionDto, AdListQuery, UpsertAdDto } from "./dto";

const BANNED_WORDS =
  /\b(bet|betting|casino|lottery|tobacco|cigarette|vote for|election|party|cure|cures|miracle)\b/i;

@Injectable()
export class AdminAdsService {
  constructor(private readonly prisma: PrismaService) {}

  private async view(rows: Ad[]) {
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
      const checks = [
        {
          text: "Labelled Ad, with a working link",
          ok:
            a.kind === "WALLET_OFFER"
              ? true
              : /^https?:\/\//i.test(a.linkUrl ?? ""),
        },
        {
          text: "Not political, betting, tobacco or a health claim",
          ok: !BANNED_WORDS.test(`${a.headline} ${a.body ?? ""}`),
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
        if (u.protocol !== "https:" && u.protocol !== "http:")
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
      const f = await this.prisma.storedFile.findUnique({
        where: { id: dto.imageFileId },
      });
      if (!f) throw invalid("imageFileId", "That image was not found.");
    }
    if (dto.audioClipId) {
      const c = await this.prisma.voiceClip.findUnique({
        where: { id: dto.audioClipId },
      });
      if (!c || c.status !== "READY")
        throw invalid("audioClipId", "That audio is not ready.");
    }
    if (dto.categoryIds?.length) {
      const n = await this.prisma.category.count({
        where: { id: { in: dto.categoryIds } },
      });
      if (n !== new Set(dto.categoryIds).size)
        throw invalid("categoryIds", "One of those categories does not exist.");
    }
  }

  private data(dto: Partial<UpsertAdDto>): Prisma.AdUncheckedUpdateInput {
    const d: Prisma.AdUncheckedUpdateInput = {};
    if (dto.brand !== undefined) d.brand = dto.brand;
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

  async update(actor: CurrentMeInfo, adId: string, dto: UpsertAdDto) {
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
      const next: AdStatus =
        a.status === "DRAFT" ? "AWAITING_APPROVAL" : a.status;
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
