import { WeeklyAdminService } from "../../src/admin/weekly.service";
import { bootAdmin, type Admin } from "./helpers";

/**
 * V-FIX-D: the weekly summary check "No names, handles or phone numbers" must not tell an editor that a person posted
 * without a name. Only named posts make a handle "someone who spoke this week".
 */
describe("V-FIX-D: the weekly check ignores nameless posts", () => {
  let a: Admin;
  let topicId: string;

  beforeAll(async () => {
    a = await bootAdmin();
    for (const n of ["quiet", "named", "none", "poster"]) await a.person(n);
    const topic = await a.prisma.topic.create({
      data: {
        weekNumber: 901,
        title: "Week 901",
        startsOn: new Date("2026-11-23"),
        endsOn: new Date("2026-11-29"),
        status: "LIVE",
      },
    });
    topicId = topic.id;
    const q = await a.prisma.question.create({
      data: { topicId, text: "How is it?", status: "LIVE", slotIndex: 1 },
    });
    const base = { questionId: q.id, kind: "TEXT" as const, body: "Prices." };
    // quiet: a nameless answer and a nameless reply only. named: a named answer.
    const own = await a.prisma.answer.create({
      data: { ...base, authorId: a.people.poster.id },
    });
    await a.prisma.answer.create({
      data: { ...base, authorId: a.people.quiet.id, anonymous: true },
    });
    await a.prisma.reply.create({
      data: {
        answerId: own.id,
        authorId: a.people.quiet.id,
        stance: "AGREE",
        kind: "TEXT",
        body: "Yes",
        anonymous: true,
      },
    });
    await a.prisma.answer.create({
      data: { ...base, authorId: a.people.named.id },
    });
  });
  afterAll(async () => {
    await a.close();
  });

  const leaks = async (word: string) => {
    const svc = a.h.app.get<unknown>(WeeklyAdminService) as {
      leaks: (r: unknown) => Promise<string[]>;
    };
    return svc.leaks({
      topicId,
      headline: `Prices, says ${word}.`,
      mood: "",
      summary: "",
      cardTitle: "",
      editorNote: "",
      themes: [],
      quotes: [],
    });
  };
  const spoke = (l: string[]) =>
    l.includes("a handle of someone who spoke this week");

  it("a person whose only posts are nameless passes like a person with no post", async () => {
    expect(spoke(await leaks(a.people.none.handle))).toBe(false);
    expect(spoke(await leaks(a.people.quiet.handle))).toBe(false);
  });

  it("a person with a named post still fails the check", async () => {
    expect(spoke(await leaks(a.people.named.handle))).toBe(true);
    expect(spoke(await leaks(a.people.poster.handle))).toBe(true);
  });
});
