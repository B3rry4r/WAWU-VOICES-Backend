import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Brand, Prisma } from "../generated/prisma/client";
import { FileAttachService, type FileTx } from "../media/file-attach.service";
import type { CurrentMeInfo } from "../me/me-context";
import { conflict, invalid, lagosDay, notFound } from "../admin/trust/common";
import { isLive } from "./surveys-admin.service";
import type { UpdateBrandDto, UpsertBrandDto } from "./dto";
import { dateOnly } from "../admin/trust/common";

function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "brand";
}

/** Brands an admin has set up, and the public brand page (no brand sign-in: admin-managed). */
/** A brand name with case, spaces and invisible format characters (zero-width space, joiners, marks) taken out. */
function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{Cf}]+/gu, "");
}

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileAttachService,
  ) {}

  private async logoUrl(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
    });
    const base = process.env.SPACES_CDN_BASE?.replace(/\/$/, "");
    return f && base ? `${base}/${f.key}` : null;
  }

  private async adminView(b: Brand) {
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      tagline: b.tagline,
      website: b.website,
      contactEmail: b.contactEmail,
      active: b.active,
      logoUrl: await this.logoUrl(b.logoFileId),
      label: "Brand",
    };
  }

  private async check(dto: Partial<UpsertBrandDto>) {
    if (dto.website) {
      try {
        if (/\s/.test(dto.website)) throw new Error();
        if (new URL(dto.website).protocol !== "https:") throw new Error();
      } catch {
        throw invalid("website", "Use a full link that starts with https://.");
      }
    }
    if (dto.logoFileId) {
      const ok = await this.files.confirm(dto.logoFileId, {
        kind: "AD_CREATIVE",
      });
      if (!ok) throw invalid("logoFileId", "That image was not found.");
    }
  }

  private async claim(tx: FileTx, id: string) {
    if (!(await this.files.claim(tx, id)))
      throw invalid("logoFileId", "That image was not found.");
  }

  async list() {
    const rows = await this.prisma.brand.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
    });
    return { items: await Promise.all(rows.map((r) => this.adminView(r))) };
  }

  /** Refuses a name that matches another brand's ignoring case, spaces and invisible characters ("Zobo Fresh" and "zobofresh"). */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    name: string,
    exceptId?: string,
  ) {
    // One lock for brand names, so two admins adding the same name at once cannot both pass.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('brand:name', 0))`;
    const key = nameKey(name);
    const all = await tx.brand.findMany({ select: { id: true, name: true } });
    const rows = all.filter(
      (r) => r.id !== exceptId && nameKey(r.name) === key,
    );
    if (rows.length)
      throw conflict(
        "A brand with that name already exists. Use it, or choose another name.",
      );
  }

  async create(actor: CurrentMeInfo, dto: UpsertBrandDto) {
    await this.check(dto);
    const base = slugOf(dto.name);
    let slug = base;
    for (
      let i = 2;
      await this.prisma.brand.findUnique({ where: { slug } });
      i++
    )
      slug = `${base}-${i}`;
    const b = await this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, dto.name);
      const row = await tx.brand.create({
        data: {
          name: dto.name,
          slug,
          tagline: dto.tagline ?? null,
          website: dto.website ?? null,
          contactEmail: dto.contactEmail ?? null,
          logoFileId: dto.logoFileId ?? null,
          active: dto.active ?? true,
          createdById: actor.id,
        },
      });
      if (dto.logoFileId) await this.claim(tx, dto.logoFileId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "brand.create",
          targetType: "brand",
          targetId: row.id,
          after: { name: row.name, slug: row.slug },
        },
      });
      return row;
    });
    return this.adminView(b);
  }

  async update(actor: CurrentMeInfo, id: string, dto: UpdateBrandDto) {
    await this.check(dto);
    const b = await this.prisma.$transaction(async (tx) => {
      const old = await tx.brand.findUnique({ where: { id } });
      if (!old) throw notFound("We could not find that brand.");
      if (dto.name !== undefined) await this.assertNameFree(tx, dto.name, id);
      const d: Prisma.BrandUncheckedUpdateInput = {};
      if (dto.name !== undefined) d.name = dto.name;
      if (dto.tagline !== undefined) d.tagline = dto.tagline;
      if (dto.website !== undefined) d.website = dto.website;
      if (dto.contactEmail !== undefined) d.contactEmail = dto.contactEmail;
      if (dto.logoFileId !== undefined) d.logoFileId = dto.logoFileId;
      if (dto.active !== undefined) d.active = dto.active;
      if (dto.logoFileId) await this.claim(tx, dto.logoFileId);
      const row = await tx.brand.update({ where: { id }, data: d });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "brand.update",
          targetType: "brand",
          targetId: id,
          before: { name: old.name, active: old.active },
          after: { name: row.name, active: row.active },
        },
      });
      return row;
    });
    return this.adminView(b);
  }

  /** GET /brands/:slug: public. Name, logo, one line, the live surveys and the live adverts. Never an address. */
  async page(raw: string) {
    // A link that cannot be a brand's slug is a plain "not found", never a database error.
    const slug = raw.toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(slug))
      throw notFound("We could not find that brand.");
    const b = await this.prisma.brand.findUnique({ where: { slug } });
    if (!b || !b.active) throw notFound("We could not find that brand.");
    const today = lagosDay();
    const [surveys, ads] = await Promise.all([
      this.prisma.sponsoredSurvey.findMany({
        // Only surveys that are live now: approved, inside their dates, results not yet fixed (the target is checked below).
        where: {
          brandId: b.id,
          status: "APPROVED",
          snapshotAt: null,
          AND: [
            {
              OR: [{ startsOn: null }, { startsOn: { lte: dateOnly(today) } }],
            },
            { OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(today) } }] },
          ],
        },
        include: { questions: { select: { id: true } } },
        orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      this.prisma.ad.findMany({
        where: {
          status: "APPROVED",
          // Only adverts the ad manager tied to this brand: a matching name alone puts nothing on the page.
          brandId: b.id,
          AND: [
            {
              OR: [{ startsOn: null }, { startsOn: { lte: dateOnly(today) } }],
            },
            { OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(today) } }] },
          ],
        },
        orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
    ]);
    const counts = surveys.length
      ? await this.prisma.surveyResponse.groupBy({
          by: ["surveyId"],
          where: { surveyId: { in: surveys.map((s) => s.id) } },
          _count: { _all: true },
        })
      : [];
    const cdn = process.env.SPACES_CDN_BASE?.replace(/\/$/, "");
    const files = ads.some((a) => a.imageFileId)
      ? await this.prisma.storedFile.findMany({
          where: {
            id: {
              in: ads.flatMap((a) => (a.imageFileId ? [a.imageFileId] : [])),
            },
          },
        })
      : [];
    return {
      brand: {
        name: b.name,
        slug: b.slug,
        tagline: b.tagline,
        website: b.website,
        logoUrl: await this.logoUrl(b.logoFileId),
        label: "Brand",
      },
      surveys: surveys
        .filter((s) =>
          isLive(
            s,
            counts.find((c) => c.surveyId === s.id)?._count._all ?? 0,
            today,
          ),
        )
        .map((s) => ({
          id: s.id,
          title: s.title,
          label: "Sponsored Survey",
          questionCount: s.questions.length,
          endsOn: s.endsOn ? s.endsOn.toISOString().slice(0, 10) : null,
        })),
      ads: ads.map((a) => ({
        id: a.id,
        kind: a.kind,
        label:
          a.kind === "FEED_CARD" || a.kind === "WALLET_OFFER"
            ? "Sponsored"
            : "Ad",
        headline: a.headline,
        body: a.body,
        imageUrl:
          a.imageFileId && cdn
            ? (() => {
                const k = files.find((f) => f.id === a.imageFileId)?.key;
                return k ? `${cdn}/${k}` : null;
              })()
            : null,
        linkUrl: a.linkUrl,
        ctaLabel: a.ctaLabel,
      })),
    };
  }
}
