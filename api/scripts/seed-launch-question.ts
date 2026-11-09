import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedLaunchQuestion } from "../src/feed/launch-question";

/** npm run seed:launch: puts the launch question on Sun 15 Nov 2026 (after seed:questions). Safe to run twice. */
async function main(): Promise<void> {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const r = await seedLaunchQuestion(db);
    console.log(
      r.created
        ? `seed:launch done. The launch question is on 15 Nov 2026${r.heldQuestionId ? `; the question it replaced (${r.heldQuestionId}) is in the week's held bank` : ""}.`
        : "seed:launch: the launch question is already there.",
    );
  } finally {
    await db.$disconnect();
  }
}
void main();
