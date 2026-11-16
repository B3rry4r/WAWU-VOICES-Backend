import type { PrismaClient } from "../generated/prisma/client";
import { CATEGORIES } from "./categories";
import { MOODS } from "../mood/mood";
import { invalidateUnreadableQuestions } from "./question-window";
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
  editStatus?: string | null;
  originalText?: string | null;
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
export interface WeekCategory {
  week: number;
  season: string;
  theme: string;
  category: string;
}
export interface SeedResult {
  recategorised: number;
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
  weekCategories: WeekCategory[],
): Promise<SeedResult> {
  const out: SeedResult = {
    recategorised: 0,
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
          sortOrder: CATEGORIES.indexOf(c) + 1,
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

  const byWeek = new Map<number, string>();
  for (const w of weekCategories) {
    const id = cats.get(w.category);
    if (!id)
      throw new Error(`week ${w.week}: unknown category "${w.category}"`);
    byWeek.set(w.week, id);
  }
  for (const w of data.weeks)
    if (!byWeek.has(w.week))
      throw new Error(`week ${w.week} has no category in week-categories.json`);

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
      return {
        seedKey: `q${q.n}`,
        topicId: t.id,
        categoryId: byWeek.get(q.week)!,
        kind: "DAILY" as const,
        status: "SCHEDULED" as const,
        text: q.text,
        hint: q.speakPrompt,
        editStatus: q.editStatus ?? null,
        originalText: q.originalText ?? null,
        scheduledFor: day ? dateOnly(day) : null,
        slotIndex: slot,
        isSpare: slot === null,
        // answerable from its day until the end of the week; the live view cuts "today" at the end of the Lagos day
        startsAt: day ? lagosDayStart(day) : null,
        endsAt: day ? lagosDayEnd(t.endsOn.toISOString().slice(0, 10)) : null,
        sensitive: t.sensitive,
        // rule W: every daily question offers the four words
        moodOptions: [...MOODS],
      };
    });
  if (rows.length)
    await db.question.createMany({ data: rows, skipDuplicates: true });
  // Rows made by an earlier run keep their wording; only the category follows the table.
  const existing = await db.question.findMany({
    where: { seedKey: { not: null } },
    select: { id: true, seedKey: true, categoryId: true },
  });
  const weekOf = new Map(data.questions.map((q) => [`q${q.n}`, q.week]));
  for (const e of existing) {
    const want = byWeek.get(weekOf.get(e.seedKey!) ?? -1);
    if (want && e.categoryId !== want) {
      await db.question.update({
        where: { id: e.id },
        data: { categoryId: want },
      });
      out.recategorised++;
    }
  }
  out.questions = rows.length;
  out.existingQuestions = data.questions.length - rows.length;
  invalidateUnreadableQuestions(); // C2.1-COST: rows were added
  return out;
}
