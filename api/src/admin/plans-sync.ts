import type { Prisma } from "../generated/prisma/client";

export interface PlanConfig {
  slug: string;
  name: string;
  months: number;
  priceKobo: number;
  monthlyMilli: number;
  active: boolean;
}

/**
 * The admin config key `units.plans` is the one source of the subscription plans, the same way `units.tiers` is for the
 * packs (V-ADMIN-MONEY). The SubscriptionPlan table is its projection, because a Payment and a Subscription point at a
 * plan row: this writes the config's plans into it, in the same transaction as the config write. A plan that leaves the
 * list is switched off, never deleted. A plan already on sale keeps its months and tokens a month (a payment that has
 * started was shown those, and only the price, the name and the on-sale switch change here). A payment already started
 * keeps the price and tokens copied onto its own row.
 */
export async function syncSubscriptionPlans(
  tx: Prisma.TransactionClient,
  value: unknown,
): Promise<void> {
  const plans = value as PlanConfig[];
  const slugs = plans.map((p) => p.slug);
  for (const [i, p] of plans.entries()) {
    const data = {
      name: p.name,
      priceKobo: p.priceKobo,
      active: p.active,
      sortOrder: i + 1,
    };
    await tx.subscriptionPlan.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        months: p.months,
        monthlyMilli: p.monthlyMilli,
        ...data,
      },
      update: data,
    });
  }
  await tx.subscriptionPlan.updateMany({
    where: { slug: { notIn: slugs } },
    data: { active: false },
  });
}

/** A message when the new plans would change what a plan already on sale gives (its months or tokens a month), else null. */
export async function plansConflict(
  tx: Prisma.TransactionClient,
  value: unknown,
): Promise<string | null> {
  const plans = value as PlanConfig[];
  const rows = await tx.subscriptionPlan.findMany();
  const by = new Map(plans.map((p) => [p.slug, p]));
  for (const r of rows) {
    const p = by.get(r.slug);
    if (!p)
      return `The ${r.name} plan cannot be removed. Switch it off instead.`;
    if (p.months !== r.months || p.monthlyMilli !== r.monthlyMilli)
      return `The ${r.name} plan keeps its ${r.months} months and its tokens a month. Add a new plan to change them.`;
  }
  return null;
}
