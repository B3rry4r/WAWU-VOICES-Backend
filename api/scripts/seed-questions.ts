import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { importQuestions, type SeedFile } from "../src/feed/seed";

/** npm run seed:questions: loads docs/seed/questions.json. Safe to run twice. */
async function main(): Promise<void> {
  const file = process.env.SEED_FILE ?? join(__dirname, "../../docs/seed/questions.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const r = await importQuestions(db, data);
    console.log(
      `seed:questions done. categories +${r.categories}, topics +${r.topics}, polls +${r.polls}, questions +${r.questions} (${r.existingQuestions} already there).`,
    );
  } finally {
    await db.$disconnect();
  }
}
void main();
