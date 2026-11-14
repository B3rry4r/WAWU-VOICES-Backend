import { makePerson, startHarness, type Harness, type Person } from "./harness";

/**
 * V-ADMIN-FIRST (owner order, 14 Nov): a named post by someone who has the ADMIN role now comes first, newest first, in
 * the answers under a question (every sort, every filter) and in the replies of a thread. Nothing else is reordered.
 */
describe("admin first", () => {
  let h: Harness;
  let admin: Person;
  let editor: Person;
  let m1: Person;
  let m2: Person;
  let m3: Person;
  let blocker: Person;
  let qid: string;
  const T0 = Date.now() - 3 * 3_600_000;
  const at = (n: number) => new Date(T0 + n * 60_000);
  const ids: Record<string, string> = {};

  const answer = async (
    key: string,
    by: Person,
    n: number,
    o: {
      anonymous?: boolean;
      mood?: "ANGRY" | "TIRED" | "PROUD" | "HOPEFUL";
      rank?: number;
      debate?: number;
      news?: "GOSSIP" | "UNVERIFIED_NEWS";
      status?: "HELD" | "REMOVED";
      questionId?: string;
    } = {},
  ) => {
    const a = await h.prisma.answer.create({
      data: {
        questionId: o.questionId ?? qid,
        authorId: by.id,
        kind: "TEXT",
        body: `answer ${key}`,
        anonymous: o.anonymous ?? false,
        mood: o.mood ?? null,
        rankScore: o.rank ?? 0,
        debateScore: o.debate ?? 0,
        isNews: !!o.news,
        newsTag: o.news ?? null,
        status: o.status ?? "PUBLISHED",
        createdAt: at(n),
      },
    });
    ids[key] = a.id;
    return a.id;
  };
  const key = (id: string) => Object.keys(ids).find((k) => ids[k] === id) ?? id;
  const list = async (
    who: Person | null,
    qs = "",
    path = `/api/v1/questions/${qid}/answers`,
  ) => {
    const r = h.http().get(`${path}?${qs}`);
    const res = await (who ? r.set("Authorization", who.auth) : r).expect(200);
    return res.body as {
      items: { answer: { id: string } }[];
      nextCursor: string | null;
    };
  };
  const names = async (who: Person | null, qs = "") =>
    (await list(who, qs)).items.map((i) => key(i.answer.id));
  const grantAdmin = (p: Person) =>
    h.prisma.userRoleGrant.create({
      data: { userId: p.id, role: "ADMIN", grantedById: "seed" },
    });
  const revokeAdmin = (p: Person) =>
    h.prisma.userRoleGrant.deleteMany({
      where: { userId: p.id, role: "ADMIN" },
    });

  beforeAll(async () => {
    h = await startHarness();
    admin = await makePerson(h, { roles: ["ADMIN"] });
    editor = await makePerson(h, { roles: ["EDITOR"] });
    m1 = await makePerson(h);
    m2 = await makePerson(h);
    m3 = await makePerson(h);
    blocker = await makePerson(h);
    const q = await h.prisma.question.create({
      data: {
        text: "How was the week?",
        status: "LIVE",
        startsAt: new Date(T0 - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
      },
    });
    qid = q.id;
    // admin: A1 (t1, PROUD), A3 nameless (t3, ANGRY, the best rank), A2 (t5, HOPEFUL, a gossip news post)
    await answer("A1", admin, 1, { mood: "PROUD", rank: 1, debate: 1 });
    await answer("A3", admin, 3, {
      anonymous: true,
      mood: "ANGRY",
      rank: 200,
      debate: 200,
    });
    await answer("A2", admin, 5, {
      mood: "HOPEFUL",
      rank: 2,
      debate: 2,
      news: "GOSSIP",
    });
    await answer("E1", editor, 4, { mood: "TIRED", rank: 100, debate: 100 });
    await answer("M1", m1, 2, { mood: "ANGRY", rank: 50, debate: 50 });
    await answer("M2", m2, 6, {
      mood: "TIRED",
      rank: 10,
      debate: 10,
      news: "GOSSIP",
    });
    await answer("M3", m3, 7, { mood: "PROUD", rank: 5, debate: 5 });
    await answer("AH", admin, 8, { status: "HELD" }); // held: never shown
    await h.prisma.block.create({
      data: { blockerId: blocker.id, blockedId: admin.id },
    });
  });
  afterAll(() => h.close());

  const NORMAL = {
    NEW: ["M3", "M2", "E1", "A3", "M1"],
    TOP: ["A3", "E1", "M1", "M2", "M3"],
    DEBATED: ["A3", "E1", "M1", "M2", "M3"],
  };

  it.each(["NEW", "TOP", "DEBATED"] as const)(
    "sort %s: the admin's named answers first, newest first, the rest in today's order",
    async (sort) => {
      for (const who of [m1, editor, admin, null]) {
        expect(await names(who, `sort=${sort}`)).toEqual([
          "A2",
          "A1",
          ...NORMAL[sort],
        ]);
      }
    },
  );

  it("every filter: a mood word the admin's answer does not match, a news tag, a word that matches", async () => {
    // A1 is PROUD and A2 HOPEFUL: both are first under TIRED anyway
    expect(await names(m1, "mood=TIRED&sort=NEW")).toEqual([
      "A2",
      "A1",
      "M2",
      "E1",
    ]);
    expect(await names(m1, "mood=PROUD&sort=NEW")).toEqual(["A2", "A1", "M3"]);
    // the news tag filter: only M2 is gossip besides A2; A1 is not news at all and is still first
    expect(await names(m1, "tag=GOSSIP&sort=NEW")).toEqual(["A2", "A1", "M2"]);
    expect(await names(m1, "tag=UNVERIFIED_NEWS")).toEqual(["A2", "A1"]);
  });

  it("three pages of 2: no post twice, none lost; the admin's go on top of the first page, outside limit", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await list(
        m1,
        `sort=NEW&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      sizes.push(r.items.length);
      seen.push(...r.items.map((x) => key(x.answer.id)));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    expect(sizes).toEqual([4, 2, 1]); // 2 admin on top + 2 ordinary, then 2, then the last 1
    expect(seen).toEqual(["A2", "A1", ...NORMAL.NEW]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain("AH");
  });

  it("the editor's posts are not moved, the admin's nameless answer is in its normal place and nothing marks it", async () => {
    const r = await list(m1, "sort=NEW");
    const byKey = Object.fromEntries(
      r.items.map((i) => [key(i.answer.id), i.answer as Record<string, any>]),
    );
    expect(Object.keys(byKey)).toEqual(["A2", "A1", ...NORMAL.NEW]);
    // same fields as any other answer; the nameless one carries no author, and no flag at all that the others lack
    expect(Object.keys(byKey.A3).sort()).toEqual(Object.keys(byKey.M1).sort());
    expect(byKey.A3.author ?? null).toBeNull();
    expect(JSON.stringify(byKey.A3)).not.toContain(admin.id);
  });

  it("a member who blocked the admin still gets the admin's named answers first; the nameless one follows the old rule", async () => {
    expect(await names(blocker, "sort=NEW")).toEqual([
      "A2",
      "A1",
      ...NORMAL.NEW,
    ]);
    expect(await names(blocker, "mood=ANGRY&sort=NEW")).toEqual([
      "A2",
      "A1",
      "A3",
      "M1",
    ]);
    // blocks still hide an ordinary person's named answer, as today
    await h.prisma.block.create({
      data: { blockerId: blocker.id, blockedId: m1.id },
    });
    expect(await names(blocker, "sort=NEW")).toEqual([
      "A2",
      "A1",
      "M3",
      "M2",
      "E1",
      "A3",
    ]);
    await h.prisma.block.deleteMany({
      where: { blockerId: blocker.id, blockedId: m1.id },
    });
  });

  it("taking the ADMIN role away puts the posts back at once; giving it back moves them up again", async () => {
    await revokeAdmin(admin);
    expect(await names(m1, "sort=NEW")).toEqual([
      "M3",
      "M2",
      "A2",
      "E1",
      "A3",
      "M1",
      "A1",
    ]);
    // and the block now hides them from the blocker again, as for anyone
    expect(await names(blocker, "sort=NEW")).toEqual([
      "M3",
      "M2",
      "E1",
      "A3",
      "M1",
    ]);
    await grantAdmin(admin);
    expect(await names(m1, "sort=NEW")).toEqual(["A2", "A1", ...NORMAL.NEW]);
  });

  it("more than 20 admin answers: the newest 20 are on top; the older ones stay in their normal place, none lost or doubled", async () => {
    const q2 = await h.prisma.question.create({
      data: {
        text: "Cap?",
        status: "LIVE",
        startsAt: new Date(T0 - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const made: string[] = [];
    for (let i = 0; i < 22; i++)
      made.push(await answer(`C${i}`, admin, 100 + i, { questionId: q2.id }));
    await answer("CM", m1, 99, { questionId: q2.id });
    const path = `/api/v1/questions/${q2.id}/answers`;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await list(
        m2,
        `sort=NEW&limit=5${cursor ? `&cursor=${cursor}` : ""}`,
        path,
      );
      seen.push(...r.items.map((x) => key(x.answer.id)));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    expect(seen.slice(0, 20)).toEqual(
      made
        .slice(2)
        .reverse()
        .map((id) => key(id)),
    );
    expect(seen.slice(20)).toEqual(["C1", "C0", "CM"]);
    expect(new Set(seen).size).toBe(23);
  });

  it("a question that has not opened still shows nothing", async () => {
    const q3 = await h.prisma.question.create({
      data: {
        text: "Not yet",
        status: "SCHEDULED",
        startsAt: new Date(Date.now() + 3 * 86_400_000),
      },
    });
    await answer("FA", admin, 1, { questionId: q3.id });
    const res = await h
      .http()
      .get(`/api/v1/questions/${q3.id}/answers`)
      .set("Authorization", m1.auth);
    expect(JSON.stringify(res.body)).not.toContain(ids.FA);
    const mine = await h
      .http()
      .get(`/api/v1/questions/${q3.id}/answers`)
      .set("Authorization", admin.auth);
    expect(JSON.stringify(mine.body)).not.toContain(ids.FA);
    expect(mine.status).toBe(res.status);
  });

  describe("replies in a thread", () => {
    let thread: string;
    const reply = async (
      k: string,
      by: Person,
      n: number,
      stance: "AGREE" | "DISAGREE" = "AGREE",
      status: "PUBLISHED" | "HELD" = "PUBLISHED",
    ) => {
      const r = await h.prisma.reply.create({
        data: {
          answerId: thread,
          authorId: by.id,
          stance,
          kind: "TEXT",
          body: `reply ${k}`,
          status,
          createdAt: at(n),
        },
      });
      ids[k] = r.id;
    };
    const replies = async (who: Person | null, qs = "") => {
      const r = h.http().get(`/api/v1/answers/${thread}/replies?${qs}`);
      const res = await (who ? r.set("Authorization", who.auth) : r).expect(
        200,
      );
      return res.body as {
        items: { id: string }[];
        nextCursor: string | null;
        counts: Record<string, number>;
      };
    };
    beforeAll(async () => {
      thread = await answer("TH", m1, 20);
      await reply("R1", admin, 21);
      await reply("r2", m2, 22);
      await reply("r3", editor, 23);
      await reply("R2", admin, 24, "DISAGREE");
      await reply("r4", m3, 25);
      await reply("r5", m2, 26);
      await reply("RH", admin, 27, "AGREE", "HELD");
      await h.prisma.answer.update({
        where: { id: thread },
        data: { agreeCount: 5, disagreeCount: 1 },
      });
    });

    it("the admin's replies first, newest first, the rest oldest first; three pages of 2, none twice", async () => {
      const full = await replies(m2);
      expect(full.items.map((i) => key(i.id))).toEqual([
        "R2",
        "R1",
        "r2",
        "r3",
        "r4",
        "r5",
      ]);
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 6; i++) {
        const r = await replies(
          m2,
          `limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        );
        sizes.push(r.items.length);
        seen.push(...r.items.map((x) => key(x.id)));
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      expect(sizes).toEqual([4, 2]); // 2 admin on top + 2 ordinary, then the last 2
      expect(seen).toEqual(["R2", "R1", "r2", "r3", "r4", "r5"]);
    });

    it("the stance tab still applies; the counts are the stored ones, with or without the role", async () => {
      expect(
        (await replies(m2, "stance=DISAGREE")).items.map((i) => key(i.id)),
      ).toEqual(["R2"]);
      expect(
        (await replies(m2, "stance=AGREE")).items.map((i) => key(i.id)),
      ).toEqual(["R1", "r2", "r3", "r4", "r5"]);
      const withRole = (await replies(m2)).counts;
      await revokeAdmin(admin);
      const without = (await replies(m2)).counts;
      await grantAdmin(admin);
      expect(without).toEqual(withRole);
      expect(withRole).toEqual({ agree: 5, disagree: 1, experience: 0 });
    });

    it("a member who blocked the admin still gets the admin's replies first; removing the role puts them back", async () => {
      expect((await replies(blocker)).items.map((i) => key(i.id))).toEqual([
        "R2",
        "R1",
        "r2",
        "r3",
        "r4",
        "r5",
      ]);
      await revokeAdmin(admin);
      expect((await replies(m2)).items.map((i) => key(i.id))).toEqual([
        "R1",
        "r2",
        "r3",
        "R2",
        "r4",
        "r5",
      ]);
      expect((await replies(blocker)).items.map((i) => key(i.id))).toEqual([
        "r2",
        "r3",
        "r4",
        "r5",
      ]);
      await grantAdmin(admin);
    });

    it("the editor's replies are not moved", async () => {
      await revokeAdmin(admin);
      const without = (await replies(m2)).items.map((i) => key(i.id));
      await grantAdmin(admin);
      expect(without.indexOf("r3")).toBe(2);
      const withRole = (await replies(m2)).items.map((i) => key(i.id));
      expect(withRole.filter((k) => !k.startsWith("R"))).toEqual(
        without.filter((k) => !k.startsWith("R")),
      );
    });
  });
});
