import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { TEST_DATABASE_URL } from "../../test/test-env";
import { importQuestions, type SeedFile, type WeekCategory } from "./seed";
import { seedLaunchQuestion, LAUNCH_QUESTION } from "./launch-question";
import { questionOpenWhere } from "./question-window";
import { pollOpenWhere } from "./present";
import { addDays, dateOnly, lagosDayStart, toDay } from "./lagos";
import { applyShift, formatPlan, planShift, SHIFT } from "./launch-shift";

const root = join(__dirname, "../../../docs/seed");
const seed = JSON.parse(
  readFileSync(join(root, "questions.json"), "utf8"),
) as SeedFile;
const cats = JSON.parse(
  readFileSync(join(root, "week-categories.json"), "utf8"),
) as WeekCategory[];

/** V-CAL-LAUNCH: a database seeded exactly like production (seed:questions, then seed:launch), then the shift. */
describe("calendar:launch-shift (V-CAL-LAUNCH)", () => {
  let db: PrismaClient;
  const at = (iso: string) => new Date(iso);
  const openQ = (now: Date) =>
    db.question.findMany({
      where: questionOpenWhere(now),
      select: { seedKey: true, text: true },
    });
  const openP = (now: Date) => db.poll.count({ where: pollOpenWhere(now) });
  const counts = async () => ({
    topics: await db.topic.count(),
    questions: await db.question.count(),
    polls: await db.poll.count(),
    options: await db.pollOption.count(),
    answers: await db.answer.count(),
    votes: await db.vote.count(),
    spare: await db.question.count({ where: { isSpare: true } }),
    questionCountSum: (
      await db.topic.aggregate({ _sum: { questionCount: true } })
    )._sum.questionCount,
  });
  let before: Awaited<ReturnType<typeof counts>>;
  let answerId: string;
  let answerBody: unknown;
  let held: string | null;

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await db.$executeRawUnsafe(
      'TRUNCATE "Topic","Category","User","AuditLog" CASCADE',
    );
    await importQuestions(db, seed, cats);
    held = (await seedLaunchQuestion(db)).heldQuestionId;
    // a person who answered a bank question and voted in week 1's poll while the questions were wrongly open
    const user = await db.user.create({
      data: { wawuId: "w-shift", handle: "shifter", referralCode: "SHIFT1" },
    });
    const q1 = await db.question.findUniqueOrThrow({
      where: { seedKey: "q1" },
    });
    const a = await db.answer.create({
      data: {
        questionId: q1.id,
        authorId: user.id,
        kind: "TEXT",
        body: "Still hopeful.",
      },
    });
    answerId = a.id;
    answerBody = a.body;
    const poll = await db.poll.findFirstOrThrow({
      where: { topic: { weekNumber: 1 }, kind: "WEEKLY" },
      include: { options: true },
    });
    await db.vote.create({
      data: {
        pollId: poll.id,
        userId: user.id,
        phoneHash: "h",
        idempotencyKey: "k",
        choices: { create: { optionId: poll.options[0].id } },
      },
    });
    before = await counts();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it("starts as production was: bank questions open on 12 to 14 Nov, week 1 on the 12th", async () => {
    expect((await openQ(at("2026-11-14T12:00:00Z"))).length).toBe(3);
    expect(await openP(at("2026-11-14T12:00:00Z"))).toBe(1);
    expect(held).toBeTruthy();
    const t1 = await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } });
    expect(toDay(t1.startsOn)).toBe("2026-11-12");
  });

  it("a dry run lists every change and changes nothing", async () => {
    const plan = await planShift(db, seed);
    expect(plan.refusals).toEqual([]);
    expect(plan.counts).toEqual({
      topic: 103,
      question: 720,
      poll: 103,
      launch: 1,
      restore: 1,
    });
    const text = formatPlan(plan, "dry-run");
    expect(text).toContain("week 1 ");
    expect(text).toContain("LAUNCH question");
    expect(await counts()).toEqual(before);
    expect(
      toDay(
        (await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } }))
          .startsOn,
      ),
    ).toBe("2026-11-12");
  });

  it("apply moves everything in one go, the second apply finds nothing", async () => {
    const first = await applyShift(db, seed);
    expect(first.refusals).toEqual([]);
    expect(first.changes).toHaveLength(928);
    const second = await applyShift(db, seed);
    expect(second.changes).toHaveLength(0);
    expect(second.refusals).toEqual([]);
    expect((await planShift(db, seed)).changes).toHaveLength(0);
    expect(
      await db.auditLog.count({ where: { action: "calendar.launch_shift" } }),
    ).toBe(1);
  });

  it("nothing from the bank is open on 12 to 14 Nov, 15 Nov has only the launch question", async () => {
    for (const d of [
      "2026-11-12T08:00:00Z",
      "2026-11-13T12:00:00Z",
      "2026-11-14T22:59:00Z",
    ]) {
      expect(await openQ(at(d))).toEqual([]);
      expect(await openP(at(d))).toBe(0);
    }
    const sun = await openQ(at("2026-11-15T10:00:00Z"));
    expect(sun.map((q) => q.seedKey)).toEqual([LAUNCH_QUESTION.seedKey]);
    expect(await openP(at("2026-11-15T10:00:00Z"))).toBe(0);
    // opens at the start of the Lagos day: 23:00 UTC on the 14th
    expect(
      (await openQ(at("2026-11-14T23:00:00Z"))).map((q) => q.seedKey),
    ).toEqual([LAUNCH_QUESTION.seedKey]);
    const onDay = await db.question.findMany({
      where: { scheduledFor: dateOnly("2026-11-15"), isSpare: false },
    });
    expect(onDay.map((q) => q.seedKey)).toEqual([LAUNCH_QUESTION.seedKey]);
  });

  it("week 1 is 16 to 22 Nov with seven days and its poll, the displaced question is back on day 4", async () => {
    const t1 = await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } });
    expect([toDay(t1.startsOn), toDay(t1.endsOn)]).toEqual([
      "2026-11-16",
      "2026-11-22",
    ]);
    const days = await db.question.findMany({
      where: { topicId: t1.id, isSpare: false, slotIndex: { not: null } },
      orderBy: { slotIndex: "asc" },
    });
    expect(days.map((q) => toDay(q.scheduledFor))).toEqual(
      [16, 17, 18, 19, 20, 21, 22].map((d) => `2026-11-${d}`),
    );
    expect(days[3].id).toBe(held);
    expect(
      days.every(
        (q) => q.endsAt!.getTime() === lagosDayStart("2026-11-23").getTime(),
      ),
    ).toBe(true);
    const poll = await db.poll.findFirstOrThrow({
      where: { topicId: t1.id, kind: "WEEKLY" },
    });
    expect(poll.startsAt.getTime()).toBe(lagosDayStart("2026-11-16").getTime());
    expect(poll.endsAt.getTime()).toBe(lagosDayStart("2026-11-23").getTime());
    expect(
      (await openQ(at("2026-11-16T10:00:00Z"))).map((q) => q.seedKey).sort(),
    ).toEqual([LAUNCH_QUESTION.seedKey, days[0].seedKey].sort());
    expect(await openP(at("2026-11-16T10:00:00Z"))).toBe(1);
  });

  it("week 103 moved by four days, every week keeps its order", async () => {
    const t = await db.topic.findUniqueOrThrow({ where: { weekNumber: 103 } });
    expect(toDay(t.startsOn)).toBe(addDays("2028-10-26", 4));
    expect(toDay(t.endsOn)).toBe("2028-11-05");
    const all = await db.topic.findMany({ orderBy: { weekNumber: "asc" } });
    all.forEach((w, i) =>
      expect(toDay(w.startsOn)).toBe(addDays(SHIFT.newWeek1, 7 * i)),
    );
    const q = await db.question.findMany({
      where: { topicId: t.id, slotIndex: { not: null } },
      orderBy: { slotIndex: "asc" },
    });
    expect(q.map((x) => toDay(x.scheduledFor))).toEqual(
      q.map((_, i) => addDays("2028-10-30", i)),
    );
  });

  it("counts are unchanged and the answer and vote stay attached to their question and poll", async () => {
    expect(await counts()).toEqual({ ...before, spare: before.spare - 1 }); // only the displaced question left the held bank
    const a = await db.answer.findUniqueOrThrow({
      where: { id: answerId },
      include: { question: true },
    });
    expect(a.body).toEqual(answerBody);
    expect(a.status).toBe("PUBLISHED");
    expect(a.question.seedKey).toBe("q1");
    expect(toDay(a.question.scheduledFor)).toBe("2026-11-16");
    expect(await db.vote.count()).toBe(1);
  });

  it("refuses, and changes nothing, when a week was moved by hand or the launch question is missing", async () => {
    // an editor moved week 5 in the calendar by two days: neither the seeded nor the shifted dates
    await db.$executeRawUnsafe(
      `UPDATE "Topic" SET "startsOn" = "startsOn" + 2, "endsOn" = "endsOn" + 2 WHERE "weekNumber" = 5`,
    );
    const p = await planShift(db, seed);
    expect(p.refusals.join("\n")).toMatch(/week 5 runs/);
    await expect(applyShift(db, seed)).resolves.toMatchObject({
      refusals: expect.any(Array) as unknown,
    });
    await db.$executeRawUnsafe(
      `UPDATE "Topic" SET "startsOn" = "startsOn" - 2, "endsOn" = "endsOn" - 2 WHERE "weekNumber" = 5`,
    );
    // a fresh production-like copy
    await db.$executeRawUnsafe('TRUNCATE "Topic","Category","User" CASCADE');
    await importQuestions(db, seed, cats);
    const none = await planShift(db, seed);
    expect(none.refusals.join("\n")).toMatch(/launch question .* is missing/);
    expect(none.changes.length).toBeGreaterThan(0);
    const r = await applyShift(db, seed);
    expect(r.refusals.length).toBeGreaterThan(0);
    expect(
      toDay(
        (await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } }))
          .startsOn,
      ),
    ).toBe("2026-11-12");
    // week 4 edited by hand on a fresh copy: a question dated outside its week
    await seedLaunchQuestion(db);
    await db.$executeRawUnsafe(
      `UPDATE "Question" SET "scheduledFor" = "scheduledFor" + 10 WHERE "seedKey" = 'q31'`,
    );
    expect((await planShift(db, seed)).refusals.join("\n")).toMatch(
      /outside week 4's seeded dates/,
    );
    // a half-done shift
    await db.$executeRawUnsafe(
      `UPDATE "Question" SET "scheduledFor" = "scheduledFor" - 10 WHERE "seedKey" = 'q31'`,
    );
    await db.$executeRawUnsafe(
      `UPDATE "Topic" SET "startsOn" = "startsOn" + 4, "endsOn" = "endsOn" + 4 WHERE "weekNumber" = 2`,
    );
    expect((await planShift(db, seed)).refusals.join("\n")).toMatch(
      /half-done shift/,
    );
  });
});
