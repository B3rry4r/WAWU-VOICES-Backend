import { dateOnly, lagosDay } from "../../src/feed/lagos";
import {
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

/**
 * V-ADMIN-FIRST-HOME (owner order, 14 Nov): the named posts of a current ADMIN also come first in Trending answers
 * (Home, capped at 3, and GET /feed/trending) and in a category's top voices (capped at 3). Nameless posts are never lifted.
 */
describe("admin first on Home, trending and category top voices", () => {
  let h: Harness;
  const specStart = new Date();
  let others: { id: string; status: "SCHEDULED" | "LIVE" | "CLOSED" }[] = [];
  let dated: { id: string; scheduledFor: Date }[] = [];
  let admin: Person;
  let exAdmin: Person;
  let m1: Person;
  let m2: Person;
  let blocker: Person;
  let qid: string;
  let otherQid: string;
  let catId: string;
  let catSlug: string;
  const ids: Record<string, string> = {};
  const T0 = Date.now() - 3 * 3_600_000;
  const at = (n: number) => new Date(T0 + n * 60_000);
  const key = (id: string) => Object.keys(ids).find((k) => ids[k] === id) ?? id;

  const post = async (
    k: string,
    by: Person,
    n: number,
    o: { rank?: number; anonymous?: boolean; questionId?: string } = {},
  ) => {
    const a = await h.prisma.answer.create({
      data: {
        questionId: o.questionId ?? qid,
        authorId: by.id,
        kind: "TEXT",
        body: `answer ${k}`,
        anonymous: o.anonymous ?? false,
        rankScore: o.rank ?? 0,
        status: "PUBLISHED",
        createdAt: at(n),
      },
    });
    ids[k] = a.id;
  };
  interface Body {
    trending: { id: string }[];
    topVoices: { id: string }[];
    items: { answer: { id: string } }[];
    nextCursor: string | null;
  }
  const get = async (who: Person | null, path: string): Promise<Body> => {
    const r = h.http().get(path);
    return (await (who ? r.set("Authorization", who.auth) : r).expect(200))
      .body as Body;
  };
  const home = async (who: Person | null) =>
    ((await get(who, "/api/v1/home")).trending as { id: string }[]).map((a) =>
      key(a.id),
    );
  const viewers = () => [null, m1, blocker, admin];
  const expectHome = async (want: string[]) => {
    for (const who of viewers()) expect(await home(who)).toEqual(want);
  };

  beforeAll(async () => {
    h = await startHarness();
    // Under the whole-window rule another spec's leftover admin post on a still-open question would be lifted onto Home:
    // for the length of this spec every readable question it did not create is a draft (put back in afterAll).
    others = (
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
    dated = (
      await h.prisma.question.findMany({
        where: { scheduledFor: { not: null } },
        select: { id: true, scheduledFor: true },
      })
    ).map((q) => ({ id: q.id, scheduledFor: q.scheduledFor as Date }));
    await h.prisma.question.updateMany({
      where: { id: { in: others.map((q) => q.id) } },
      data: { status: "DRAFT" },
    });
    admin = await makePerson(h, { roles: ["ADMIN"] });
    exAdmin = await makePerson(h, { roles: ["ADMIN"] });
    m1 = await makePerson(h);
    m2 = await makePerson(h);
    blocker = await makePerson(h);
    await h.prisma.block.create({
      data: { blockerId: blocker.id, blockedId: admin.id },
    });
    const today = dateOnly(lagosDay(new Date()));
    await h.prisma.topic.create({
      data: {
        weekNumber: 100_000 + Math.floor(Math.random() * 800_000),
        title: "A week",
        startsOn: new Date(today.getTime() - 3 * 86_400_000),
        endsOn: new Date(today.getTime() + 3 * 86_400_000),
        status: "LIVE",
      },
    });
    // The test database is shared and used: no earlier spec's question may be "today's question" beside this one.
    await h.prisma.question.updateMany({
      where: { scheduledFor: { not: null } },
      data: { scheduledFor: null },
    });
    const cat = await h.prisma.category.create({
      data: { slug: `adm-first-${Date.now()}`, name: "Admin first" },
    });
    catId = cat.id;
    catSlug = cat.slug;
    const open = {
      status: "LIVE" as const,
      startsAt: new Date(T0 - 3_600_000),
      endsAt: new Date(Date.now() + 86_400_000),
    };
    qid = (
      await h.prisma.question.create({
        data: {
          text: "Today?",
          kind: "DAILY",
          pinned: true,
          scheduledFor: today,
          categoryId: catId,
          ...open,
        },
      })
    ).id;
    otherQid = (
      await h.prisma.question.create({
        data: {
          text: "Another one?",
          kind: "DAILY",
          categoryId: catId,
          ...open,
        },
      })
    ).id;
    await post("R1", m1, 10, { rank: 100 });
    await post("AN", admin, 11, { rank: 95, anonymous: true });
    await post("R2", m2, 12, { rank: 90 });
    await post("R3", m1, 13, { rank: 80 });
  }, 120_000);
  // The test database is shared by every spec: leave nothing readable behind. A draft question is read by nobody, so the
  // posts made here stay out of the lists (trending, new, news) that later specs read. Specs run one at a time, so every
  // question created since this file was loaded is this spec's own.
  afterAll(async () => {
    try {
      await h.prisma.question.updateMany({
        where: { createdAt: { gte: specStart } },
        data: { status: "DRAFT" },
      });
    } finally {
      for (const st of ["SCHEDULED", "LIVE", "CLOSED"] as const)
        await h.prisma.question.updateMany({
          where: {
            id: { in: others.filter((q) => q.status === st).map((q) => q.id) },
          },
          data: { status: st },
        });
      for (const q of dated)
        await h.prisma.question.update({
          where: { id: q.id },
          data: { scheduledFor: q.scheduledFor },
        });
      await h.close();
    }
  });

  it("no admin post: the same 2 as before; a nameless admin post keeps its ranked place", async () => {
    await expectHome(["R1", "AN"]);
  });

  it("one admin post: [admin, top 1, top 2]", async () => {
    await post("A1", admin, 1);
    await expectHome(["A1", "R1", "AN"]);
  });

  it("an admin post that is itself the top ranked one is shown once", async () => {
    await h.prisma.answer.update({
      where: { id: ids.A1 },
      data: { rankScore: 500 },
    });
    await expectHome(["A1", "R1", "AN"]);
    await h.prisma.answer.update({
      where: { id: ids.A1 },
      data: { rankScore: 0 },
    });
  });

  it("an admin post on another open question is lifted on Home; a removed admin is not lifted", async () => {
    await post("AO", admin, 50, { questionId: otherQid });
    await post("X", exAdmin, 51, { rank: 0 });
    await h.prisma.userRoleGrant.deleteMany({
      where: { userId: exAdmin.id, role: "ADMIN" },
    });
    // Owner's order, 16 Nov 2026 ("Keep Home filled"): Home reads the whole ranking window.
    await expectHome(["AO", "A1", "R1", "AN"]);
  });

  it("five admin posts: the 3 newest, then 2 ranked", async () => {
    for (const [i, k] of ["A2", "A3", "A4", "A5"].entries())
      await post(k, admin, 2 + i);
    // Owner's order, 16 Nov 2026 ("Keep Home filled"): Home reads the whole ranking window.
    await expectHome(["AO", "A5", "A4", "R1", "AN"]);
  });

  it("GET /feed/trending: block on page 1 only, pages of 2 walk to the end with no duplicate and none missing", async () => {
    for (const withQ of [true, false]) {
      const qs = withQ ? `&questionId=${qid}` : `&categoryId=${catId}`;
      const want = (
        await h.prisma.answer.findMany({
          where: {
            status: "PUBLISHED",
            question: { categoryId: catId },
            ...(withQ ? { questionId: qid } : {}),
          },
          select: { id: true },
        })
      ).map((a) => a.id);
      for (const who of viewers()) {
        const seen: string[] = [];
        const sizes: number[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 20; i++) {
          const r = await get(
            who,
            `/api/v1/feed/trending?limit=2${qs}${cursor ? `&cursor=${cursor}` : ""}`,
          );
          sizes.push(r.items.length);
          seen.push(
            ...r.items.map((x: { answer: { id: string } }) => x.answer.id),
          );
          cursor = r.nextCursor;
          if (!cursor) break;
        }
        expect(new Set(seen).size).toBe(seen.length);
        // X is now a plain member: it is in the ranked list, not lifted
        expect([...seen].sort()).toEqual([...want].sort());
        // page 1: the admin block (5 on the question, 6 with AO) then 2 ordinary; later pages are at most 2
        expect(sizes[0]).toBe(withQ ? 7 : 8);
        expect(sizes.slice(1).every((s) => s <= 2)).toBe(true);
        const first = seen.slice(0, withQ ? 5 : 6).map(key);
        expect(first).toEqual(
          withQ
            ? ["A5", "A4", "A3", "A2", "A1"]
            : ["AO", "A5", "A4", "A3", "A2", "A1"],
        );
        if (who === null) expect(seen.map(key)).not.toContain("undefined");
      }
    }
  });

  it("category top voices: admin posts first, at most 3, then the ranked ones", async () => {
    for (const who of viewers()) {
      const d = await get(who, `/api/v1/categories/${catSlug}`);
      expect(d.topVoices.map((a: { id: string }) => key(a.id))).toEqual([
        "AO",
        "A5",
        "A4",
        "R1",
        "AN",
        "R2",
      ]);
    }
  });
  describe("an admin whose account is not public is not lifted", () => {
    const setStatus = (
      status:
        "ACTIVE" | "BANNED" | "DELETION_PENDING" | "DELETED" | "SUSPENDED",
    ) => h.prisma.user.update({ where: { id: admin.id }, data: { status } });
    const adminKeys = new Set(["A1", "A2", "A3", "A4", "A5", "AO"]);
    const trendingFirst = async (who: Person | null) => {
      const r = await get(
        who,
        `/api/v1/feed/trending?limit=2&questionId=${qid}`,
      );
      return r.items.map((x) => key(x.answer.id));
    };
    const catTop = async (who: Person | null) =>
      (await get(who, `/api/v1/categories/${catSlug}`)).topVoices.map((a) =>
        key(a.id),
      );

    it.each(["BANNED", "DELETION_PENDING", "DELETED"] as const)(
      "%s: not lifted on Home, trending or the category page; back to ACTIVE: lifted; SUSPENDED: lifted",
      async (status) => {
        try {
          await setStatus(status);
          for (const who of [null, m1, blocker]) {
            const hm = await home(who);
            expect(hm.slice(0, 3).filter((k) => adminKeys.has(k))).toEqual([]);
            expect(await trendingFirst(who)).not.toEqual(
              expect.arrayContaining(["A5", "A4"]),
            );
            expect(
              (await catTop(who)).slice(0, 3).filter((k) => adminKeys.has(k)),
            ).toEqual([]);
          }
          await setStatus("ACTIVE");
          for (const who of [null, m1, blocker]) {
            // Owner's order, 16 Nov 2026 ("Keep Home filled"): Home reads the whole ranking window.
            expect(await home(who)).toEqual(["AO", "A5", "A4", "R1", "AN"]);
            expect((await catTop(who)).slice(0, 3)).toEqual(["AO", "A5", "A4"]);
          }
          await setStatus("SUSPENDED");
          for (const who of [null, m1, blocker]) {
            // Owner's order, 16 Nov 2026 ("Keep Home filled"): Home reads the whole ranking window.
            expect(await home(who)).toEqual(["AO", "A5", "A4", "R1", "AN"]);
            expect((await catTop(who)).slice(0, 3)).toEqual(["AO", "A5", "A4"]);
          }
        } finally {
          await setStatus("ACTIVE");
        }
      },
    );
  });
});
