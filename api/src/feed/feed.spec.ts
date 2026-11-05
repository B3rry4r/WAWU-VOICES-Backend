/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment -- response bodies are read as loose JSON */
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../../test/test-env";
import { TestJwks } from "../../test/test-jwks";
import { importQuestions, type SeedFile, type WeekCategory } from "./seed";
import { CATEGORIES } from "./categories";
import { decodeCursor, encodeCursor } from "./cursor";
import { lagosDay, weekStart } from "./lagos";

const weekCats = JSON.parse(
  readFileSync(
    join(__dirname, "../../../docs/seed/week-categories.json"),
    "utf8",
  ),
) as WeekCategory[];
const seed = JSON.parse(
  readFileSync(join(__dirname, "../../../docs/seed/questions.json"), "utf8"),
) as SeedFile;

/** Only Date is faked, so the I/O keeps working. */
const ALL_BUT_DATE = [
  "nextTick",
  "setImmediate",
  "clearImmediate",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "performance",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "hrtime",
] as never[];
const at = (iso: string) =>
  jest.useFakeTimers({ now: new Date(iso), doNotFake: ALL_BUT_DATE });

describe("feed (A2)", () => {
  const jwks = new TestJwks();
  let app: INestApplication;
  let db: import("../common/prisma/prisma.service").PrismaService;
  const http = () => request(app.getHttpServer() as App);
  type J = Record<string, any>;
  const get = (url: string, token?: string) => {
    const r = http().get(`/api/v1${url}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };

  beforeAll(async () => {
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    const { AppModule } = await import("../app.module.js");
    const { configureApp } = await import("../app-config.js");
    const { PrismaService } =
      await import("../common/prisma/prisma.service.js");
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    await db.$executeRawUnsafe('TRUNCATE "Topic","Category","User" CASCADE');
    await importQuestions(db, seed, weekCats);
  });

  afterAll(async () => {
    jest.useRealTimers();
    await app?.close();
    await jwks.stop();
  });
  afterEach(() => jest.useRealTimers());

  describe("seed importer", () => {
    it("loads 103 weeks, 1030 questions and 103 polls, week 1 on Thu 12 Nov 2026 (V-14)", async () => {
      expect(await db.topic.count()).toBe(103);
      expect(await db.question.count()).toBe(1030);
      expect(await db.poll.count({ where: { kind: "WEEKLY" } })).toBe(103);
      const t1 = await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } });
      expect(t1.startsOn.toISOString().slice(0, 10)).toBe("2026-11-12");
      expect(t1.endsOn.toISOString().slice(0, 10)).toBe("2026-11-18");
      expect(weekStart(2)).toBe("2026-11-19");
      expect(new Date("2026-11-12T00:00:00Z").getUTCDay()).toBe(4); // Thursday
      const q1 = await db.question.findUniqueOrThrow({
        where: { seedKey: "q1" },
      });
      expect(q1.scheduledFor?.toISOString().slice(0, 10)).toBe("2026-11-12");
      const q7 = await db.question.findUniqueOrThrow({
        where: { seedKey: "q7" },
      });
      expect(q7.scheduledFor?.toISOString().slice(0, 10)).toBe("2026-11-18");
      const spare = await db.question.findUniqueOrThrow({
        where: { seedKey: "q8" },
      });
      expect(spare.isSpare).toBe(true);
      expect(spare.scheduledFor).toBeNull();
    });

    it("is idempotent and keeps an editor's wording", async () => {
      await db.question.update({
        where: { seedKey: "q2" },
        data: { text: "Edited by an editor." },
      });
      const r = await importQuestions(db, seed, weekCats);
      expect(r).toEqual({
        recategorised: 0,
        categories: 0,
        topics: 0,
        polls: 0,
        questions: 0,
        existingQuestions: 1030,
      });
      expect(await db.question.count()).toBe(1030);
      expect(
        (await db.question.findUniqueOrThrow({ where: { seedKey: "q2" } }))
          .text,
      ).toBe("Edited by an editor.");
      await db.question.update({
        where: { seedKey: "q2" },
        data: { text: seed.questions[1].text },
      });
    });

    it("every week maps to one of the 15 categories and every question takes its week's", async () => {
      expect(CATEGORIES).toHaveLength(15);
      expect(weekCats).toHaveLength(103);
      expect(
        weekCats.every((w) => CATEGORIES.some((c) => c.slug === w.category)),
      ).toBe(true);
      expect(await db.question.count({ where: { categoryId: null } })).toBe(0);
      const q = await db.question.findUniqueOrThrow({
        where: { seedKey: "q1" },
        include: { category: true },
      });
      expect(q.category?.slug).toBe(weekCats[0].category);
    });

    it("re-running updates only the category when the table changes", async () => {
      const changed = weekCats.map((w) =>
        w.week === 2 ? { ...w, category: "politics" } : w,
      );
      const r = await importQuestions(db, seed, changed);
      expect(r).toMatchObject({ questions: 0, recategorised: 10 });
      expect(
        (
          await db.question.findUniqueOrThrow({
            where: { seedKey: "q11" },
            include: { category: true },
          })
        ).category?.slug,
      ).toBe("politics");
      await importQuestions(db, seed, weekCats);
    });
  });

  describe("cursor", () => {
    it("expires after 24 hours and rejects junk", () => {
      const c = encodeCursor("abc", Date.now() - 25 * 3_600_000);
      expect(() => decodeCursor(c)).toThrow();
      expect(() => decodeCursor("not-a-cursor")).toThrow();
      expect(decodeCursor(encodeCursor("abc"))).toBe("abc");
    });
  });

  /** The category with the most daily questions in week 6, so a page of one has a next page. */
  const busiestWeek6Category = async (): Promise<string> => {
    const rows = await db.question.groupBy({
      by: ["categoryId"],
      where: {
        topic: { weekNumber: 6 },
        isSpare: false,
        categoryId: { not: null },
      },
      _count: true,
      orderBy: { _count: { categoryId: "desc" } },
      take: 1,
    });
    return (
      await db.category.findUniqueOrThrow({
        where: { id: rows[0].categoryId! },
      })
    ).slug;
  };

  describe("topics and calendar", () => {
    it("lagosDay uses the Lagos day, not the UTC day", () => {
      expect(lagosDay(new Date("2026-11-12T23:30:00Z"))).toBe("2026-11-13");
    });

    it("GET /topics/current is week 1 on launch day and week 2 a week later", async () => {
      at("2026-11-12T08:00:00Z");
      const a = (await get("/topics/current").expect(200)).body as J;
      expect(a).toMatchObject({
        weekNumber: 1,
        startsOn: "2026-11-12",
        endsOn: "2026-11-18",
        status: "LIVE",
        questionCount: 10,
      });
      expect(a.weeklyPollId).toEqual(expect.any(String));
      at("2026-11-19T08:00:00Z");
      expect(((await get("/topics/current")).body as J).weekNumber).toBe(2);
    });

    it("before launch the current topic is the first week, still SCHEDULED", async () => {
      at("2026-11-05T08:00:00Z");
      const b = (await get("/topics/current").expect(200)).body as J;
      expect(b).toMatchObject({ weekNumber: 1, status: "SCHEDULED" });
    });

    it("GET /topics/:id, 404 for an unknown or malformed id", async () => {
      const t = await db.topic.findUniqueOrThrow({ where: { weekNumber: 3 } });
      expect(
        ((await get(`/topics/${t.id}`).expect(200)).body as J).weekNumber,
      ).toBe(3);
      const nf = await get(
        "/topics/00000000-0000-7000-8000-000000000000",
      ).expect(404);
      expect((nf.body as J).error.code).toBe("NOT_FOUND");
      await get("/topics/nope").expect(404);
    });

    it("GET /calendar pages in week order with an opaque cursor", async () => {
      const p1 = (await get("/calendar?limit=2").expect(200)).body as J;
      expect(p1.items.map((i: J) => i.weekNumber)).toEqual([1, 2]);
      expect(p1.items[0]).toEqual(
        expect.objectContaining({
          topicId: expect.any(String),
          title: expect.any(String),
          startsOn: "2026-11-12",
        }),
      );
      const p2 = (
        await get(`/calendar?limit=2&cursor=${p1.nextCursor}`).expect(200)
      ).body as J;
      expect(p2.items.map((i: J) => i.weekNumber)).toEqual([3, 4]);
      await get("/calendar?status=BOGUS").expect(422);
    });
  });

  describe("today, questions, categories", () => {
    it("GET /questions/today: launch day shows q1 with the clock cut at the end of the Lagos day", async () => {
      at("2026-11-12T08:00:00Z");
      const q = (await get("/questions/today").expect(200)).body as J;
      expect(q).toMatchObject({
        scheduledFor: "2026-11-12",
        status: "LIVE",
        weekNumber: 1,
        kind: "DAILY",
      });
      expect(q.endsAt).toBe("2026-11-12T23:00:00.000Z");
      at("2026-11-14T08:00:00Z");
      expect(((await get("/questions/today")).body as J).scheduledFor).toBe(
        "2026-11-14",
      );
    });

    it("a live override replaces the day's question", async () => {
      at("2026-11-12T08:00:00Z");
      const oq = await db.question.create({
        data: {
          text: "Breaking: what do you think?",
          kind: "OVERRIDE",
          status: "LIVE",
          startsAt: new Date("2026-11-12T06:00:00Z"),
          endsAt: new Date("2026-11-13T06:00:00Z"),
        },
      });
      const admin = await db.user.create({
        data: {
          wawuId: "ov-admin",
          handle: "ovadmin",
          referralCode: "OVADMIN1",
        },
      });
      await db.override.create({
        data: {
          questionId: oq.id,
          contentKind: "TEXT",
          body: "Read this.",
          startsAt: new Date("2026-11-12T06:00:00Z"),
          endsAt: new Date("2026-11-13T06:00:00Z"),
          status: "LIVE",
          createdById: admin.id,
        },
      });
      const q = (await get("/questions/today").expect(200)).body as J;
      expect(q.id).toBe(oq.id);
      expect(q.override).toMatchObject({
        contentKind: "TEXT",
        body: "Read this.",
      });
      await db.override.deleteMany();
      await db.question.delete({ where: { id: oq.id } });
    });

    it("GET /categories lists exactly the fifteen of V-25, in order, none empty of questions after launch", async () => {
      const r = (await get("/categories").expect(200)).body as J;
      expect(r.items.map((c: J) => c.name)).toEqual([
        "Money",
        "Work",
        "Power",
        "Family",
        "Love",
        "Faith",
        "Food prices",
        "Roads",
        "Politics",
        "Elections",
        "School",
        "Health",
        "Security",
        "Entertainment",
        "Sport",
      ]);
      expect(r.items.map((c: J) => c.slug)).toEqual([
        "money",
        "work",
        "power",
        "family",
        "love",
        "faith",
        "food-prices",
        "roads",
        "politics",
        "elections",
        "school",
        "health",
        "security",
        "entertainment",
        "sport",
      ]);
      expect(r.items[0]).toEqual(
        expect.objectContaining({ voicesThisWeek: 0 }),
      );
    });

    it("GET /categories/:slug has tab counts, a todays question and pages the open tab; 404 and 422 are the error shape", async () => {
      at("2026-12-23T08:00:00Z"); // last day of week 6: all of its seven daily questions are open
      const slug = await busiestWeek6Category();
      const r = (await get(`/categories/${slug}`).expect(200)).body as J;
      expect(r.category.slug).toBe(slug);
      expect(r.counts.open).toBeGreaterThan(0);
      expect(r.questions.length).toBe(Math.min(20, r.counts.open));
      const small = (await get(`/categories/${slug}?limit=1`).expect(200))
        .body as J;
      expect(small.questions).toHaveLength(1);
      expect(small.nextCursor).toEqual(expect.any(String));
      const next = (
        await get(
          `/categories/${slug}?limit=1&cursor=${small.nextCursor}`,
        ).expect(200)
      ).body as J;
      expect(next.questions[0].id).not.toBe(small.questions[0].id);
      at("2027-01-20T08:00:00Z");
      expect(
        ((await get(`/categories/${slug}?tab=closed`)).body as J).questions
          .length,
      ).toBeGreaterThan(0);
      const nf = await get("/categories/nope").expect(404);
      expect((nf.body as J).error).toMatchObject({ code: "NOT_FOUND" });
      expect(
        ((await get(`/categories/${slug}?tab=zzz`).expect(422)).body as J).error
          .code,
      ).toBe("VALIDATION_FAILED");
    });

    it("GET /questions lists started questions newest first and filters by status", async () => {
      at("2026-11-14T08:00:00Z");
      const r = (await get("/questions?status=LIVE&limit=50").expect(200))
        .body as J;
      expect(r.items).toHaveLength(3); // 12, 13 and 14 Nov
      expect(r.items[0].scheduledFor).toBe("2026-11-14");
      expect(r.items.every((q: J) => q.status === "LIVE")).toBe(true);
      expect(
        ((await get("/feed/new?limit=2").expect(200)).body as J).items,
      ).toHaveLength(2);
      expect(
        ((await get("/feed/trending-questions").expect(200)).body as J).items
          .length,
      ).toBe(3);
    });
  });

  describe("home, trending, search", () => {
    let token: string;
    beforeAll(async () => {
      const [a, b] = await Promise.all([
        db.user.create({
          data: {
            wawuId: "u-ada",
            handle: "ada.o",
            displayName: "Ada Okafor",
            state: "Lagos",
            referralCode: "ADA00001",
          },
        }),
        db.user.create({
          data: {
            wawuId: "u-farida",
            handle: "farida.k",
            state: "Kaduna",
            referralCode: "FAR00001",
          },
        }),
      ]);
      const q = await db.question.findUniqueOrThrow({
        where: { seedKey: "q1" },
      });
      const mk = (
        authorId: string,
        body: string,
        rankScore: number,
        extra: object = {},
      ) =>
        db.answer.create({
          data: {
            questionId: q.id,
            authorId,
            kind: "TEXT",
            body,
            rankScore,
            ...extra,
          },
        });
      const a1 = await mk(
        a.id,
        "The fare to my village doubled this year.",
        5,
        { likeCount: 3 },
      );
      await mk(b.id, "Light came for two hours today.", 9);
      await mk(b.id, "Anonymous worry about rent.", 1, { anonymous: true });
      await mk(a.id, "A removed answer about fare.", 99, { status: "REMOVED" });
      await db.reaction.create({
        data: { answerId: a1.id, userId: b.id, kind: "RELATABLE" },
      });
      await db.poll.create({
        data: {
          kind: "FLASH",
          title: "How many hours of light today?",
          startsAt: new Date("2026-11-01T00:00:00Z"),
          endsAt: new Date("2026-12-31T00:00:00Z"),
          status: "OPEN",
          totalVotes: 0,
          options: {
            create: [
              { label: "None", sortOrder: 1 },
              { label: "1 to 6", sortOrder: 2 },
            ],
          },
        },
      });
    });

    it("GET /home as a guest: topic, daily question, flash poll, trending, no greeting", async () => {
      at("2026-11-12T08:00:00Z");
      const h = (await get("/home").expect(200)).body as J;
      expect(h.topicOfWeek.weekNumber).toBe(1);
      expect(h.dailyQuestion.scheduledFor).toBe("2026-11-12");
      expect(h.flashPoll).toMatchObject({
        label: "Open poll",
        status: "OPEN",
        myVote: null,
      });
      expect(h.flashPoll.options[0].votes).toBe(0); // live results on
      expect(h.greetingName).toBeNull();
      expect(h.sponsored).toBeNull();
      expect(h.trending.map((a: J) => a.body)).toEqual([
        "Light came for two hours today.",
        "The fare to my village doubled this year.",
      ]);
      expect(
        h.trending.every((a: J) => a.isMine === false && a.iLiked === false),
      ).toBe(true);
    });

    it("GET /home signed in greets by first name and marks my answers", async () => {
      at("2026-11-12T08:00:00Z");
      token = jwks.sign({ sub: "u-ada" }); // signed after the clock is set, so it is not expired
      const h = (await get("/home", token).expect(200)).body as J;
      expect(h.greetingName).toBe("Ada");
      expect(
        h.trending.find((a: J) => a.author?.handle === "ada.o").isMine,
      ).toBe(true);
    });

    it("a bad token is 401, not a silent guest view", async () => {
      await get("/home", "garbage").expect(401);
    });

    it("trending hides removed answers and shows anonymous ones with no author, paged by cursor", async () => {
      const p1 = (await get("/feed/trending?limit=2").expect(200)).body as J;
      expect(p1.items).toHaveLength(2);
      expect(p1.items[0].type).toBe("answer");
      expect(p1.items[0].answer.labels).toContain("TRENDING");
      const p2 = (
        await get(`/feed/trending?limit=2&cursor=${p1.nextCursor}`).expect(200)
      ).body as J;
      expect(p2.items).toHaveLength(1);
      expect(p2.items[0].answer.author).toBeNull();
      expect(p2.nextCursor).toBeNull();
    });

    it("a blocked author is hidden from the blocker", async () => {
      const ada = await db.user.findUniqueOrThrow({
        where: { wawuId: "u-ada" },
      });
      const far = await db.user.findUniqueOrThrow({
        where: { wawuId: "u-farida" },
      });
      await db.block.create({ data: { blockerId: ada.id, blockedId: far.id } });
      token = jwks.sign({ sub: "u-ada" });
      const r = (await get("/feed/trending", token).expect(200)).body as J;
      expect(r.items.map((i: J) => i.answer.author?.handle)).toEqual(["ada.o"]);
      await db.block.deleteMany();
    });

    it("GET /search finds questions, answers and people, with totals; 2 characters minimum", async () => {
      at("2026-12-20T08:00:00Z"); // week 5 (fares) has started
      const r = (await get("/search?q=fare").expect(200)).body as J;
      expect(r.answers.map((a: J) => a.body)).toEqual([
        "The fare to my village doubled this year.",
      ]);
      expect(r.questions.length).toBeGreaterThan(0);
      expect(r.totals.voices).toBe(1);
      const p = (await get("/search?q=farida&type=people").expect(200))
        .body as J;
      expect(p.people).toHaveLength(1);
      expect(p.people[0]).toMatchObject({
        handle: "farida.k",
        state: "Kaduna",
        voiceCount: 2,
      });
      expect(p.answers).toEqual([]);
      const t = (await get("/search?q=wallet&type=topics").expect(200))
        .body as J;
      expect(t.topics[0].weekNumber).toBe(2);
      const bad = await get("/search?q=a").expect(422);
      expect((bad.body as J).error.code).toBe("VALIDATION_FAILED");
      await get("/search?q=fare&type=zzz").expect(422);
      expect(
        ((await get("/search?q=%25%25").expect(200)).body as J).people,
      ).toEqual([]);
    });
  });
  describe("config, countries, one question", () => {
    it("GET /config/public reads ConfigEntry, falling back to the PRICES.md defaults, and lists active tiers", async () => {
      await db.unitTier.deleteMany(); // other suites share this database
      await db.configEntry.deleteMany();
      const first = (await get("/config/public").expect(200)).body as J;
      expect(first).toMatchObject({
        currency: "NGN",
        freePosts: 10,
        unitBaseKobo: 1380,
        voiceFreeSeconds: 10,
      });
      expect(first.costs).toMatchObject({
        minPackKobo: 13800,
        voteAfterFreeMilli: 200,
        extraVoice30Kobo: 15000,
        textMaxChars: 500,
      });
      expect(first.tiers).toEqual([]);
      await db.configEntry.upsert({
        where: { key: "allowance.free_posts" },
        update: { valueJson: 7 },
        create: { key: "allowance.free_posts", valueJson: 7 },
      });
      await db.unitTier.create({
        data: {
          slug: "spark",
          name: "Spark",
          priceKobo: 13800,
          unitsMilli: 10000,
          bonusMilli: 0,
          sortOrder: 1,
        },
      });
      const next = (await get("/config/public").expect(200)).body as J;
      expect(next.freePosts).toBe(7);
      expect(next.tiers[0]).toMatchObject({
        slug: "spark",
        priceKobo: 13800,
        effectiveKoboPerUnit: 1380,
        baseKoboPerUnit: 1380,
      });
      expect(next.extraVoice.map((e: J) => e.kind)).toEqual([
        "SECONDS_30",
        "SECONDS_60",
      ]);
      await db.configEntry.deleteMany();
      await db.unitTier.deleteMany();
    });

    it("GET /countries is Nigeria, live", async () => {
      expect(((await get("/countries").expect(200)).body as J).items).toEqual([
        { code: "NG", name: "Nigeria", currency: "NGN", status: "live" },
      ]);
    });

    it("GET /questions/:id, its answers (TOP, NEW, bad sort) and its polls", async () => {
      at("2026-11-14T08:00:00Z");
      const q = await db.question.findUniqueOrThrow({
        where: { seedKey: "q1" },
      });
      const one = (await get(`/questions/${q.id}`).expect(200)).body as J;
      expect(one.id).toBe(q.id);
      const future = await db.question.findUniqueOrThrow({
        where: { seedKey: "q30" },
      });
      await get(`/questions/${future.id}`).expect(404);
      await get("/questions/not-a-uuid").expect(404);
      const top = (await get(`/questions/${q.id}/answers`).expect(200))
        .body as J;
      expect(top.items[0].answer.body).toBe("Light came for two hours today.");
      const fresh = (
        await get(`/questions/${q.id}/answers?sort=NEW&limit=1`).expect(200)
      ).body as J;
      expect(fresh.items).toHaveLength(1);
      expect(fresh.nextCursor).toEqual(expect.any(String));
      await get(`/questions/${q.id}/answers?sort=ZZZ`).expect(422);
      const poll = await db.poll.create({
        data: {
          kind: "QUESTION",
          questionId: q.id,
          title: "Ready?",
          startsAt: new Date("2026-11-13T00:00:00Z"),
          endsAt: new Date("2026-11-20T00:00:00Z"),
          options: {
            create: [
              { label: "Yes", sortOrder: 1 },
              { label: "No", sortOrder: 2 },
            ],
          },
        },
      });
      const polls = (await get(`/questions/${q.id}/polls`).expect(200))
        .body as J;
      expect(polls.items[0]).toMatchObject({
        id: poll.id,
        status: "OPEN",
        label: "Open poll",
      });
      expect(((await get(`/questions/${q.id}`)).body as J).hasOpenPoll).toBe(
        true,
      );
    });

    it("V-26: before launch, today's question (future-dated) is readable by id with its answers and polls", async () => {
      at("2026-11-05T08:00:00Z");
      const today = (await get("/questions/today").expect(200)).body as J;
      expect(today.status).toBe("SCHEDULED");
      expect(Date.parse(today.startsAt)).toBeGreaterThan(Date.now());
      const home = (await get("/home").expect(200)).body as J;
      expect(home.dailyQuestion.id).toBe(today.id);
      expect(
        ((await get(`/questions/${today.id}`).expect(200)).body as J).id,
      ).toBe(today.id);
      await get(`/questions/${today.id}/answers`).expect(200);
      await get(`/questions/${today.id}/polls`).expect(200);
      const other = await db.question.findUniqueOrThrow({
        where: { seedKey: "q30" },
      });
      await get(`/questions/${other.id}`).expect(404); // only the one the app shows opens early
    });
  });
});
