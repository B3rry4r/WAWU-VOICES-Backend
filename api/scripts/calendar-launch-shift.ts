import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applyShift, formatPlan, planShift } from "../src/feed/launch-shift";
import type { SeedFile } from "../src/feed/seed";

/**
 * npm run calendar:launch-shift [-- --dry-run | --apply]: V-CAL-LAUNCH, a one-off. Moves the seeded question bank from
 * week 1 on Thu 12 Nov to week 1 on Mon 16 Nov 2026. --dry-run (the default) prints every change and changes nothing.
 * Safe to run twice: a second --apply finds nothing to change.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    console.error("Use --dry-run or --apply, not both.");
    process.exit(2);
  }
  const bad = args.filter((a) => a !== "--apply" && a !== "--dry-run");
  if (bad.length) {
    console.error(
      `Unknown option ${bad.join(" ")}. Use --dry-run (default) or --apply.`,
    );
    process.exit(2);
  }
  const file =
    process.env.SEED_FILE ?? join(__dirname, "../../docs/seed/questions.json");
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const plan = apply ? await applyShift(db, seed) : await planShift(db, seed);
    console.log(formatPlan(plan, apply ? "apply" : "dry-run"));
    if (plan.refusals.length) process.exitCode = 1;
    else if (apply)
      console.log(
        plan.changes.length
          ? "\nApplied in one transaction."
          : "\nNothing to apply.",
      );
    else
      console.log(
        "\nDry run: nothing was changed. Run with --apply to make these changes.",
      );
  } finally {
    await db.$disconnect();
  }
}
void main();
