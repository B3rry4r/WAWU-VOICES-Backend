import type { PrismaClient } from "../generated/prisma/client";
import { CATEGORIES, categoryFor } from "./categories";
import {
  addDays,
  dateOnly,
  lagosDayEnd,
  lagosDayStart,
  weekStart,
} from "./lagos";

interface SeedQuestion {
  n: number;
  week: number;
  category: string;
  theme: string;
  qInWeek: number;
  text: string;
  speakPrompt: string | null;
}
interface SeedWeek {
  week: number;
  topic: string;
  category: string;
  poll: { question: string; options: { key: string; text: string }[] };
  whatNext: { question: string };
}
export interface SeedFile {
  questions: SeedQuestion[];
  weeks: SeedWeek[];
}
export interface SeedResult {
  categories: number;
  topics: number;
  polls: number;
  questions: number;
  existingQuestions: number;
}

const SENSITIVE =
  /elect|campaign|politic|democracy|ballot|governor|religio|tribe|faith|pastor|imam/i;

/**
 * Idempotent by question number (Question.seedKey = "q<n>"). A row that already exists is left alone, so an
 * editor's wording and status survive a re-run. V-14: week 1 starts Thu 12 Nov 2026, later weeks follow; the
 * sheet's own dates (16 Nov) are ignored. Slots 1 to 7 are the week's daily questions; 8 to 10 are spares.
 */
export async function importQuestions(
  db: PrismaClient,
  data: SeedFile,
): Promise<SeedResult> {
  const out: SeedResult = {
    categories: 0,
    topics: 0,
    polls: 0,
    questions: 0,
    existingQuestions: 0,
  };

  for (const c of CATEGORIES) {
    const found = await db.category.findUnique({ where: { slug: c.slug } });
    if (!found) {
      await db.category.create({
        data: {
          slug: c.slug,
          name: c.name,
          blurb: c.blurb,
          sortOrder: c.sortOrder,
        },
      });
      out.categories++;
    }
  }
  const cats = new Map(
    (await db.category.findMany()).map((c) => [c.slug, c.id]),
  );

  for (const w of data.weeks) {
    const startsOn = weekStart(w.week);
    const existing = await db.topic.findUnique({
      where: { weekNumber: w.week },
    });
    const sensitive = SENSITIVE.test(`${w.category} ${w.topic}`);
    const topic =
      existing ??
      (await db.topic.create({
        data: {
          weekNumber: w.week,
          title: w.topic,
          blurb: w.category,
          startsOn: dateOnly(startsOn),
          endsOn: dateOnly(addDays(startsOn, 6)),
          status: "SCHEDULED",
          sensitive,
          questionCount: data.questions.filter((q) => q.week === w.week).length,
          whatNextPrompt: w.whatNext?.question ?? null,
        },
      }));
    if (!existing) out.topics++;

    const hasPoll = await db.poll.findFirst({
      where: { topicId: topic.id, kind: "WEEKLY" },
      select: { id: true },
    });
    if (!hasPoll && w.poll) {
      const start = topic.startsOn.toISOString().slice(0, 10);
      await db.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: w.poll.question,
          status: "SCHEDULED",
          startsAt: lagosDayStart(start),
          endsAt: lagosDayEnd(addDays(start, 6)),
          options: {
            create: w.poll.options.map((o, i) => ({
              label: o.text,
              sortOrder: i + 1,
            })),
          },
        },
      });
      out.polls++;
    }
  }

  const topics = new Map(
    (await db.topic.findMany()).map((t) => [t.weekNumber, t]),
  );
  const have = new Set(
    (
      await db.question.findMany({
        where: { seedKey: { not: null } },
        select: { seedKey: true },
      })
    ).map((q) => q.seedKey),
  );
  const rows = data.questions
    .filter((q) => !have.has(`q${q.n}`))
    .map((q) => {
      const t = topics.get(q.week)!;
      const slot = q.qInWeek <= 7 ? q.qInWeek : null;
      const start = t.startsOn.toISOString().slice(0, 10);
      const day = slot ? addDays(start, slot - 1) : null;
      const slug = categoryFor(q.category, q.theme, q.text);
      return {
        seedKey: `q${q.n}`,
        topicId: t.id,
        categoryId: slug ? (cats.get(slug) ?? null) : null,
        kind: "DAILY" as const,
        status: "SCHEDULED" as const,
        text: q.text,
        hint: q.speakPrompt,
        scheduledFor: day ? dateOnly(day) : null,
        slotIndex: slot,
        isSpare: slot === null,
        // answerable from its day until the end of the week; the live view cuts "today" at the end of the Lagos day
        startsAt: day ? lagosDayStart(day) : null,
        endsAt: day ? lagosDayEnd(t.endsOn.toISOString().slice(0, 10)) : null,
        sensitive: t.sensitive,
      };
    });
  if (rows.length)
    await db.question.createMany({ data: rows, skipDuplicates: true });
  out.questions = rows.length;
  out.existingQuestions = data.questions.length - rows.length;
  return out;
}
