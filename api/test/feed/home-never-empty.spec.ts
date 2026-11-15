import { dateOnly, lagosDay } from "../../src/feed/lagos";
import {
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

/**
 * V-HOME-NEVER-EMPTY (rule H): Home's trending list reads the whole ranking window. First the named posts of a current,
 * public ADMIN (any question in the window, newest first, at most 3), then 2 places for other voices: today's open question
 * first, left-over places from the other questions in the window. No post twice. An empty window gives [].
 */
describe("Home trending is never empty (rule H)", () => {
  let h: Harness;
  let admin: Person;
  let hiddenAdmin: Person;
  let m1: Person;
  let m2: Person;
  let m3: Person;
  let blocker: Person;
  let windowDays = 7;
  let topicId = "";
  let todayId = "";
  let launchId = "";
  let oldId = "";
  const ids: Record<string, string> = {};
  const T0 = Date.now() - 3 * 3_600_000;
  const at = (n: number) => new Date(T0 + n * 60_000);
  const key = (id: string) => Object.keys(ids).find((k) => ids[k] === id) ?? id;
  const specStart = new Date();
  // Rows of other specs that this spec moves out of the way, and puts back in afterAll.
  let hidden: { id: string; status: "SCHEDULED" | "LIVE" | "CLOSED" }[] = [];
  let unscheduled: { id: string; scheduledFor: Date }[] = [];

  const open = () => ({
    status: "LIVE" as const,
    startsAt: new Date(T0 - 3_600_000),
    endsAt: new Date(Date.now() + 86_400_000),
  });
  const question = async (
    text: string,
    o: Record<string, unknown> = {},
  ): Promise<string> =>
    (
      await h.prisma.question.create({
        data: { text, kind: "DAILY", ...open(), ...o },
      })
    ).id;
  const post = async (
    k: string,
    by: Person,
    qid: string,
    n: number,
    o: { rank?: number; anonymous?: boolean } = {},
  ) => {
    ids[k] = (
      await h.prisma.answer.create({
        data: {
          questionId: qid,
          authorId: by.id,
          kind: "TEXT",
          body: `answer ${k}`,
          anonymous: o.anonymous ?? false,
          rankScore: o.rank ?? 0,
          status: "PUBLISHED",
          createdAt: at(n),
        },
      })
    ).id;
  };
  interface Item {
    id: string;
    questionId: string;
    questionText: string;
    isMine: boolean;
  }
  const trending = async (who: Person | null): Promise<Item[]> => {
    const r = h.http().get("/api/v1/home");
    const res = await (who ? r.set("Authorization", who.auth) : r).expect(200);
    return (res.body as { trending: Item[] }).trending;
  };
  const names = async (who: Person | null) =>
    (await trending(who)).map((a) => key(a.id));
  const expectAll = async (want: string[]) => {
    for (const who of [null, m1, admin]) expect(await names(who)).toEqual(want);
  };

  beforeAll(async () => {
    h = await startHarness();
    const w = await h.prisma.configEntry.findUnique({
      where: { key: "ranking.window_days" },
      select: { valueJson: true },
    });
    if (typeof w?.valueJson === "number") windowDays = w.valueJson;
    admin = await makePerson(h, { roles: ["ADMIN"] });
    hiddenAdmin = await makePerson(h, { roles: ["ADMIN"] });
    await h.prisma.user.update({
      where: { id: hiddenAdmin.id },
      data: { status: "BANNED" },
    });
    m1 = await makePerson(h);
    m2 = await makePerson(h);
    m3 = await makePerson(h);
    blocker = await makePerson(h);
    await h.prisma.block.create({
      data: { blockerId: blocker.id, blockedId: m1.id },
    });
    const today = dateOnly(lagosDay(new Date()));
    topicId = (
      await h.prisma.topic.create({
        data: {
          weekNumber: 100_000 + Math.floor(Math.random() * 800_000),
          title: "A week",
          startsOn: new Date(today.getTime() - 3 * 86_400_000),
          endsOn: new Date(today.getTime() + 3 * 86_400_000),
          status: "LIVE",
        },
      })
    ).id;
    // The test database is shared: move every other question out of the window and off "today" for now.
    hidden = (
      await h.prisma.question.findMany({
        where: {
          createdAt: { lt: specStart },
          status: { in: ["SCHEDULED", "LIVE", "CLOSED"] },
        },
        select: { id: true, status: true },
      })
    ).map((q) => ({
      id: q.id,
      status: q.status as "SCHEDULED" | "LIVE" | "CLOSED",
    }));
    unscheduled = (
      await h.prisma.question.findMany({
        where: { scheduledFor: { not: null } },
        select: { id: true, scheduledFor: true },
      })
    ).map((q) => ({ id: q.id, scheduledFor: q.scheduledFor as Date }));
    await h.prisma.question.updateMany({
      where: { id: { in: hidden.map((q) => q.id) } },
      data: { status: "DRAFT" },
    });
    await h.prisma.question.updateMany({
      where: { id: { in: unscheduled.map((q) => q.id) } },
      data: { scheduledFor: null },
    });
  }, 120_000);

  afterAll(async () => {
    // A draft question is read by nobody: nothing this spec posted stays readable.
    await h.prisma.question.updateMany({
      where: { createdAt: { gte: specStart } },
      data: { status: "DRAFT" },
    });
    for (const s of ["SCHEDULED", "LIVE", "CLOSED"] as const)
      await h.prisma.question.updateMany({
        where: {
          id: { in: hidden.filter((q) => q.status === s).map((q) => q.id) },
        },
        data: { status: s },
      });
    for (const q of unscheduled)
      await h.prisma.question.update({
        where: { id: q.id },
        data: { scheduledFor: q.scheduledFor },
      });
    if (topicId)
      await h.prisma.topic
        .delete({ where: { id: topicId } })
        .catch(() => undefined);
    await h.close();
  });

  it("before any question is open: []", async () => {
    await expectAll([]);
    // A question that has not opened yet, with no post: still [].
    await question("Not yet?", {
      status: "SCHEDULED",
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 2 * 86_400_000),
      scheduledFor: dateOnly(lagosDay(new Date())),
    });
    await expectAll([]);
    await h.prisma.question.updateMany({
      where: { createdAt: { gte: specStart } },
      data: { status: "DRAFT" },
    });
  });

  it("today has 0 voices, the launch question has voices and an admin post: [admin, top, second]", async () => {
    todayId = await question("Today?", {
      pinned: true,
      scheduledFor: dateOnly(lagosDay(new Date())),
    });
    launchId = await question("Launch?");
    await post("A1", admin, launchId, 1);
    await post("L1", m1, launchId, 10, { rank: 100 });
    await post("L2", m2, launchId, 11, { rank: 90 });
    await post("L3", m3, launchId, 12, { rank: 80 });
    await expectAll(["A1", "L1", "L2"]);
    const [a] = await trending(null);
    expect(a.questionId).toBe(launchId);
    expect(a.questionText).toBe("Launch?");
  });

  it("today has 1 voice: [admin, today's voice, top voice of the other questions]", async () => {
    await post("T1", m3, todayId, 20, { rank: 5 });
    await expectAll(["A1", "T1", "L1"]);
  });

  it("today has 5 voices: [admin, today's top 2], other questions add nothing", async () => {
    await post("T2", m1, todayId, 21, { rank: 50 });
    await post("T3", m2, todayId, 22, { rank: 40 });
    await post("T4", m2, todayId, 23, { rank: 30 });
    await post("T5", m3, todayId, 24, { rank: 20 });
    await expectAll(["A1", "T2", "T3"]);
  });

  it("an admin post on today's question is shown once; one on another question counts too; the cap is 3, newest first", async () => {
    await post("A2", admin, todayId, 30, { rank: 999 });
    await expectAll(["A2", "A1", "T2", "T3"]);
    await post("A3", admin, launchId, 31);
    await post("A4", admin, todayId, 32);
    const got = await names(null);
    expect(got).toEqual(["A4", "A3", "A2", "T2", "T3"]);
    expect(new Set(got).size).toBe(got.length);
  });

  it("an anonymous admin post and a post of a not-public admin are not lifted", async () => {
    await h.prisma.answer.deleteMany({
      where: { id: { in: ["A1", "A2", "A3", "A4"].map((k) => ids[k]) } },
    });
    await post("AN", admin, todayId, 40, { anonymous: true, rank: 45 });
    await post("HID", hiddenAdmin, launchId, 41, { rank: 1 });
    const got = await names(null);
    // The anonymous post keeps only its ranked place; nothing is lifted above T2.
    expect(got).toEqual(["T2", "AN"]);
    expect(got).not.toContain("HID");
  });

  it("a blocked author is hidden in the ranked places; the admin is still shown", async () => {
    await post("A5", admin, launchId, 50);
    // `blocker` blocked m1 (T2): the ranked places skip it, the admin post stays.
    const got = (await trending(blocker)).map((a) => key(a.id));
    expect(got[0]).toBe("A5");
    expect(got).not.toContain("T2");
    expect(got).toHaveLength(3);
    // Everyone else still sees T2.
    expect(await names(m2)).toEqual(["A5", "T2", "AN"]);
  });

  it("a signed-in viewer sees isMine on their own post, a guest on none", async () => {
    expect((await trending(m1)).find((a) => key(a.id) === "T2")?.isMine).toBe(
      true,
    );
    expect((await trending(null)).every((a) => !a.isMine)).toBe(true);
  });

  it("the window edge: a question closed longer ago than ranking.window_days gives nothing", async () => {
    for (const q of [todayId, launchId])
      await h.prisma.question.update({
        where: { id: q },
        data: { status: "DRAFT" },
      });
    oldId = await question("Old?", {
      status: "CLOSED",
      startsAt: new Date(Date.now() - (windowDays + 5) * 86_400_000),
      endsAt: new Date(Date.now() - (windowDays + 2) * 86_400_000),
    });
    await post("OA", admin, oldId, 60);
    await post("O1", m1, oldId, 61, { rank: 10 });
    await expectAll([]);
    // Inside the window it comes back (closed 1 day ago).
    await h.prisma.question.update({
      where: { id: oldId },
      data: { endsAt: new Date(Date.now() - 86_400_000) },
    });
    await expectAll(["OA", "O1"]);
  });
});
