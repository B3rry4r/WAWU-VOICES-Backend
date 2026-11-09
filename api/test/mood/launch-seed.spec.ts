import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importQuestions } from "../../src/feed/seed";
import type { SeedFile, WeekCategory } from "../../src/feed/seed";
import {
  LAUNCH_QUESTION,
  seedLaunchQuestion,
} from "../../src/feed/launch-question";
import { Harness, resetDb, startHarness } from "../reach/helpers";

/** LCH-02: the launch question is on Sun 15 Nov 2026 and the question it replaces is held, not lost. */
describe("launch question seed", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  const bank = async () => {
    const dir = join(__dirname, "../../../docs/seed");
    const data = JSON.parse(
      readFileSync(join(dir, "questions.json"), "utf8"),
    ) as SeedFile;
    const cats = JSON.parse(
      readFileSync(join(dir, "week-categories.json"), "utf8"),
    ) as WeekCategory[];
    await importQuestions(h.prisma, data, cats);
  };

  it("puts the question, its four words and its line on the day, and holds the one it replaces", async () => {
    await bank();
    const day = new Date("2026-11-15T00:00:00.000Z");
    const before = await h.prisma.question.findFirstOrThrow({
      where: { scheduledFor: day, isSpare: false },
    });
    const total = await h.prisma.question.count();
    const r = await seedLaunchQuestion(h.prisma);
    expect(r).toEqual({ created: true, heldQuestionId: before.id });

    const onDay = await h.prisma.question.findMany({
      where: { scheduledFor: day, isSpare: false },
    });
    expect(onDay).toHaveLength(1);
    expect(onDay[0]).toMatchObject({
      seedKey: LAUNCH_QUESTION.seedKey,
      text: "How do you feel about Nigeria right now?",
      hint: "With everything going on, say it in your voice. 10 seconds.",
      moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
      slotIndex: before.slotIndex,
      topicId: before.topicId,
      categoryId: before.categoryId,
      status: "SCHEDULED",
    });
    // starts at the Lagos start of 15 Nov and stays open to the end of its week, as every seeded daily question
    expect(onDay[0].startsAt?.toISOString()).toBe("2026-11-14T23:00:00.000Z");
    expect(onDay[0].endsAt?.getTime()).toBe(before.endsAt?.getTime());

    // the replaced question is kept, in the week's held bank (spare), wording untouched
    const held = await h.prisma.question.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(held).toMatchObject({
      text: before.text,
      isSpare: true,
      slotIndex: null,
      scheduledFor: null,
      startsAt: null,
      endsAt: null,
      topicId: before.topicId,
    });
    expect(await h.prisma.question.count()).toBe(total + 1);
    // the other days of the week did not move
    const week = await h.prisma.question.findMany({
      where: { topicId: before.topicId, isSpare: false },
      orderBy: { slotIndex: "asc" },
    });
    expect(week.map((q) => q.slotIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("is safe to run twice, and says so when the bank is missing", async () => {
    await expect(seedLaunchQuestion(h.prisma)).rejects.toThrow(
      /run seed:questions first/,
    );
    await bank();
    await seedLaunchQuestion(h.prisma);
    const again = await seedLaunchQuestion(h.prisma);
    expect(again).toEqual({ created: false, heldQuestionId: null });
    expect(
      await h.prisma.question.count({
        where: { seedKey: LAUNCH_QUESTION.seedKey },
      }),
    ).toBe(1);
  });
});
