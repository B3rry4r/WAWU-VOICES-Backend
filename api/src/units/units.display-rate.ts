import type { PrismaService } from "../common/prisma/prisma.service";

/** price / units, rounded to whole kobo with integer maths only. */
export function perUnitKobo(priceKobo: number, unitsMilli: number): number {
  return unitsMilli > 0
    ? Math.floor((priceKobo * 1000 + Math.floor(unitsMilli / 2)) / unitsMilli)
    : 0;
}

/**
 * lead ruling WF-6 (RX4): the ONE source of the naira value shown beside a unit cost ("0.5 units (₦6.90)"). It is the
 * per-unit price of the smallest active pack (fewest units, then lowest price), read from the packs themselves, so an
 * admin changing that pack's price changes every figure in every response at once. `units.base_rate_kobo` is not read for
 * display any more; it is only the answer when no pack is active, so a half-set-up server still shows a number.
 */
export async function displayKoboPerUnit(
  db: Pick<PrismaService, "unitTier">,
  fallback: () => Promise<number> | number,
): Promise<number> {
  const smallest = await db.unitTier.findFirst({
    where: { active: true, unitsMilli: { gt: 0 } },
    orderBy: [{ unitsMilli: "asc" }, { priceKobo: "asc" }, { id: "asc" }],
    select: { priceKobo: true, unitsMilli: true },
  });
  return smallest
    ? perUnitKobo(smallest.priceKobo, smallest.unitsMilli)
    : await fallback();
}
