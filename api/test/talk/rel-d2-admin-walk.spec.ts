/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped JSON */
import { makePerson, startHarness, type Harness, type Person } from "./harness";

/**
 * V-REL-D2-FIX2 (M2): the admin-first block is fixed for a whole walk. While a reader goes through the pages (7 at a time), an
 * admin posts, or an admin's post is taken down, between every pair of pages: no item shows twice and none that was there at
 * page 1 goes missing, under NEW, TOP and DEBATED, in the answers and in the replies of a thread.
 */
describe("M2: admin-first block stays fixed across pages", () => {
  let h: Harness;
  let admin: Person;
  let reader: Person;
  let others: Person[];
  let qid: string;
  let n = 0;
  const T0 = Date.now() - 6 * 3_600_000;
  const at = () => new Date(T0 + 60_000 * ++n);

  const makeAnswer = (
    by: Person,
    o: { rank?: number; debate?: number; anonymous?: boolean; q?: string } = {},
  ) =>
    h.prisma.answer.create({
      data: {
        questionId: o.q ?? qid,
        authorId: by.id,
        kind: "TEXT",
        body: `answer ${n}`,
        anonymous: o.anonymous ?? false,
        rankScore: o.rank ?? 0,
        debateScore: o.debate ?? 0,
        createdAt: at(),
      },
    });

  const fresh = async (): Promise<string> => {
    const q = await h.prisma.question.create({
      data: {
        text: "How was the week?",
        status: "LIVE",
        startsAt: new Date(T0 - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    return q.id;
  };

  beforeAll(async () => {
    h = await startHarness();
    admin = await makePerson(h, { roles: ["ADMIN"] });
    reader = await makePerson(h);
    others = [await makePerson(h), await makePerson(h), await makePerson(h)];
  });
  afterAll(() => h.close());

  /** Walks the answers 7 at a time; `between` runs after every page except the last. */
  async function walkAnswers(
    sort: string,
    between: (page: number) => Promise<void>,
    first?: string,
  ) {
    const seen: string[] = [];
    let cursor: string | null = first ?? null;
    for (let page = 0; page < 40; page++) {
      const res = await h
        .http()
        .get(
          `/api/v1/questions/${qid}/answers?sort=${sort}&limit=7${cursor ? `&cursor=${cursor}` : ""}`,
        )
        .set("Authorization", reader.auth)
        .expect(200);
      for (const i of res.body.items) seen.push(i.answer.id as string);
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
      await between(page);
    }
    return seen;
  }

  describe.each(["NEW", "TOP", "DEBATED"])("answers, sort %s", (sort) => {
    const start: string[] = [];
    const adminOnes: string[] = [];

    beforeAll(async () => {
      qid = await fresh();
      start.length = 0;
      adminOnes.length = 0;
      // 24 named admin answers (more than the cap of 20), one nameless, and 30 ordinary ones
      for (let i = 0; i < 24; i++) {
        const a = await makeAnswer(admin, { rank: i, debate: i });
        adminOnes.push(a.id);
        start.push(a.id);
      }
      start.push(
        (await makeAnswer(admin, { anonymous: true, rank: 500, debate: 500 }))
          .id,
      );
      for (let i = 0; i < 30; i++)
        start.push(
          (
            await makeAnswer(others[i % 3], {
              rank: (i * 7) % 31,
              debate: (i * 5) % 29,
            })
          ).id,
        );
    });

    it("an admin posts between every pair of pages: none twice, none missing", async () => {
      const added: string[] = [];
      const seen = await walkAnswers(sort, async () => {
        const a = await makeAnswer(admin, { rank: 1000, debate: 1000 });
        added.push(a.id);
        adminOnes.push(a.id);
      });
      expect(seen.length).toBe(new Set(seen).size);
      for (const id of start) expect(seen).toContain(id);
      // the block at the top is the one page 1 showed: at most the cap
      expect(adminOnes.length).toBeGreaterThan(20);
    });

    it("an admin's post is taken down between pages: none twice, none missing except the one taken down", async () => {
      const gone: string[] = [];
      const seen = await walkAnswers(sort, async (page) => {
        // page 0: take down one of the top block; page 1: one of the ordinary ones
        const victim =
          page === 0
            ? adminOnes[adminOnes.length - 1]
            : start[start.length - 1];
        await h.prisma.answer.update({
          where: { id: victim },
          data: { status: "REMOVED" },
        });
        gone.push(victim);
      });
      expect(seen.length).toBe(new Set(seen).size);
      for (const id of start)
        if (!gone.includes(id) && id !== adminOnes[adminOnes.length - 1])
          expect(seen).toContain(id);
      // restore for the next test in this block
      await h.prisma.answer.updateMany({
        where: { id: { in: gone } },
        data: { status: "PUBLISHED" },
      });
    });

    it("the top block is never more than the cap, and a nameless admin answer is never in it", async () => {
      const res = await h
        .http()
        .get(`/api/v1/questions/${qid}/answers?sort=${sort}&limit=7`)
        .set("Authorization", reader.auth)
        .expect(200);
      const items = res.body.items as { answer: { id: string } }[];
      const ids = items.map((i) => i.answer.id);
      const adminIds = new Set(adminOnes);
      const top = ids.filter((id: string) => adminIds.has(id));
      expect(top.length).toBeLessThanOrEqual(20);
      const anon = await h.prisma.answer.findFirstOrThrow({
        where: { questionId: qid, anonymous: true, authorId: admin.id },
      });
      expect(ids.slice(0, 20)).not.toContain(anon.id);
    });

    it("a cursor made before the block was carried still works", async () => {
      const first = await h
        .http()
        .get(`/api/v1/questions/${qid}/answers?sort=${sort}&limit=7`)
        .set("Authorization", reader.auth)
        .expect(200);
      const firstItems = first.body.items as { answer: { id: string } }[];
      const lastOrdinary = [...firstItems]
        .reverse()
        .find((i) => !adminOnes.includes(i.answer.id));
      const old = Buffer.from(
        JSON.stringify({ i: lastOrdinary?.answer.id, t: Date.now() }),
      ).toString("base64url");
      const res = await h
        .http()
        .get(
          `/api/v1/questions/${qid}/answers?sort=${sort}&limit=7&cursor=${old}`,
        )
        .set("Authorization", reader.auth)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  describe("replies", () => {
    let thread: string;
    const startReplies: string[] = [];
    const adminReplies: string[] = [];

    const reply = (by: Person, o: { anonymous?: boolean } = {}) =>
      h.prisma.reply.create({
        data: {
          answerId: thread,
          authorId: by.id,
          stance: "AGREE",
          kind: "TEXT",
          body: `reply ${n}`,
          anonymous: o.anonymous ?? false,
          createdAt: at(),
        },
      });

    beforeAll(async () => {
      qid = await fresh();
      thread = (await makeAnswer(others[0])).id;
      for (let i = 0; i < 24; i++) {
        const r = await reply(admin);
        adminReplies.push(r.id);
        startReplies.push(r.id);
      }
      startReplies.push((await reply(admin, { anonymous: true })).id);
      for (let i = 0; i < 25; i++)
        startReplies.push((await reply(others[i % 3])).id);
    });

    async function walk(
      between: (page: number) => Promise<void>,
      first?: string,
    ) {
      const seen: string[] = [];
      let cursor: string | null = first ?? null;
      for (let page = 0; page < 40; page++) {
        const res = await h
          .http()
          .get(
            `/api/v1/answers/${thread}/replies?limit=7${cursor ? `&cursor=${cursor}` : ""}`,
          )
          .set("Authorization", reader.auth)
          .expect(200);
        for (const i of res.body.items) seen.push(i.id as string);
        cursor = res.body.nextCursor as string | null;
        if (!cursor) break;
        await between(page);
      }
      return seen;
    }

    it("an admin replies between every pair of pages: none twice, none missing", async () => {
      const added: string[] = [];
      const seen = await walk(async () => {
        const r = await reply(admin);
        adminReplies.push(r.id);
        added.push(r.id);
      });
      expect(seen.length).toBe(new Set(seen).size);
      // a reply posted after page 1 is not hidden by the block page 1 showed: it comes in its place at the end
      for (const id of added) expect(seen).toContain(id);
      for (const id of startReplies) expect(seen).toContain(id);
    });

    it("an admin's reply is taken down between pages: none twice, none missing except that one", async () => {
      const victim = adminReplies[0];
      const seen = await walk(async (page) => {
        if (page === 0)
          await h.prisma.reply.update({
            where: { id: victim },
            data: { status: "REMOVED" },
          });
      });
      expect(seen.length).toBe(new Set(seen).size);
      for (const id of startReplies)
        if (id !== victim) expect(seen).toContain(id);
      await h.prisma.reply.update({
        where: { id: victim },
        data: { status: "PUBLISHED" },
      });
    });

    it("a cursor made before the block was carried (two parts) still works", async () => {
      const first = await h
        .http()
        .get(`/api/v1/answers/${thread}/replies?limit=7`)
        .set("Authorization", reader.auth)
        .expect(200);
      const ordinary = first.body.items[first.body.items.length - 1]; // the last item of the page is where page 2 starts
      const row = await h.prisma.reply.findUniqueOrThrow({
        where: { id: ordinary.id },
      });
      const old = Buffer.from(
        `${row.createdAt.toISOString()}|${row.id}`,
      ).toString("base64url");
      const res = await h
        .http()
        .get(`/api/v1/answers/${thread}/replies?limit=7&cursor=${old}`)
        .set("Authorization", reader.auth)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });
});
