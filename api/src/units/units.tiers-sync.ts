import type { Prisma } from "../generated/prisma/client";

export interface TierConfig {
  slug: string;
  name: string;
  priceKobo: number;
  unitsMilli: number;
  bonusMilli: number;
}

/**
 * The admin config key `units.tiers` is the one source of the packs. The UnitTier table is its projection, because a
 * Payment points at a tier row: this writes the config's packs into it (same transaction as the config write, so the two
 * never disagree). A pack that leaves the list is switched off, never deleted. A payment already started keeps the price
 * and units copied onto its own row, so a change here never alters what that payment credits.
 */
export async function syncUnitTiers(
  tx: Prisma.TransactionClient,
  value: unknown,
): Promise<void> {
  const packs = value as TierConfig[];
  const slugs = packs.map((p) => p.slug);
  for (const [i, p] of packs.entries()) {
    const data = {
      name: p.name,
      priceKobo: p.priceKobo,
      unitsMilli: p.unitsMilli,
      bonusMilli: p.bonusMilli,
      sortOrder: i + 1,
      active: true,
    };
    await tx.unitTier.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...data },
      update: data,
    });
  }
  await tx.unitTier.updateMany({
    where: { slug: { notIn: slugs } },
    data: { active: false },
  });
}
