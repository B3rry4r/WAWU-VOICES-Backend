/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { startHarness, type Harness } from "../talk/harness";
import { TEST_DATABASE_URL } from "../test-env";
import { RankingService, RANKING_LOCK } from "../../src/feed/ranking.service";
import { RANKING_DEFAULTS } from "../../src/feed/ranking.config";

/** Ruling RK: the ranking job writes rankScore and debateScore. Real Postgres, real routes. */
describe("ranking job", () => {
  let h: Harness;
  let job: RankingService;
  const HOUR = 3_600_000;
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  let n = 0;

  beforeAll(async () => {
    h = await startHarness();
    job = h.app.get(RankingService);
  });
  afterAll(() => h.close());

  const user = async (
    status:
      | "ACTIVE"
      | "SUSPENDED"
      | "BANNED"
      | "DELETION_PENDING"
      | "DELETED" = "ACTIVE",
  ) => {
    n++;
    return h.prisma.user.create({
      data: {
        wawuId: `wawu-${randomUUID()}`,
        handle: `r${Date.now().toString(36)}${n}`.slice(0, 20),
        referralCode: randomUUID().slice(0, 12),
        status,
      },
    });
  };
  const question = (status: "LIVE" | "CLOSED" = "LIVE", extra = {}) =>
    h.prisma.question.create({
      data: {
        text: "How do you stretch a salary?",
        status,
        startsAt: ago(200),
        ...extra,
      },
    });
  const answer = async (qid: string, authorId: string, hours: number) =>
    h.prisma.answer.create({
      data: {
        questionId: qid,
        authorId,
        kind: "TEXT",
        body: "Plans around the light.",
        createdAt: ago(hours),
      },
    });
  const like = (answerId: string, userId: string) =>
    h.prisma.like.create({ data: { answerId, userId } });
  const react = (answerId: string, userId: string, kind = "POWERFUL") =>
    h.prisma.reaction.create({
      data: { answerId, userId, kind: kind as never },
    });
  const reply = (
    answerId: string,
    authorId: string,
    stance: "AGREE" | "DISAGREE" | "EXPERIENCE" = "AGREE",
    body = "This is a reply with plenty of words in it.",
  ) =>
    h.prisma.reply.create({
      data: { answerId, authorId, stance, kind: "TEXT", body },
    });
  const share = async (answerId: string, userId: string) => {
    const l = await h.prisma.shortLink.create({
      data: {
        code: randomUUID().slice(0, 7),
        objectType: "ANSWER",
        objectId: answerId,
      },
    });
    await h.prisma.shareEvent.create({
      data: { linkId: l.id, kind: "intent", userId },
    });
  };
  const scores = async (id: string) =>
    h.prisma.answer.findUniqueOrThrow({
      where: { id },
      select: { rankScore: true, debateScore: true },
    });
  const decay = (hours: number, exp = 1.5) => Math.pow(hours + 2, exp);

  it("counts different people once per kind, never events", async () => {
    const q = await question();
    const author = await user();
    const p = await user();
    const a = await answer(q.id, author.id, 10);
    await like(a.id, p.id);
    await react(a.id, p.id);
    await reply(a.id, p.id);
    await reply(
      a.id,
      p.id,
      "AGREE",
      "A second reply from the very same person.",
    );
    await share(a.id, p.id);
    await share(a.id, p.id);
    const r = await job.run(now);
    expect(r.ran).toBe(true);
    const s = await scores(a.id);
    // one liker 1.0, one reactor 1.5, one replier 2.0, one sharer 1.0
    expect(s.rankScore).toBeCloseTo(5.5 / decay(10), 9);
    expect(s.debateScore).toBeCloseTo(1 / decay(10, 1.2), 9);
    // four more different people double the people, not more
    const more = await Promise.all([user(), user(), user(), user()]);
    for (const m of more) await like(a.id, m.id);
    await job.run(now);
    expect((await scores(a.id)).rankScore).toBeCloseTo(9.5 / decay(10), 9);
  });

  it("leaves out the author, blocked people both ways, and suspended, banned, deleted and deleting accounts", async () => {
    const q = await question();
    const author = await user();
    const a = await answer(q.id, author.id, 10);
    const blockedByAuthor = await user();
    const blockedAuthor = await user();
    await h.prisma.block.create({
      data: { blockerId: author.id, blockedId: blockedByAuthor.id },
    });
    await h.prisma.block.create({
      data: { blockerId: blockedAuthor.id, blockedId: author.id },
    });
    const bad = [
      author,
      blockedByAuthor,
      blockedAuthor,
      await user("SUSPENDED"),
      await user("BANNED"),
      await user("DELETED"),
      await user("DELETION_PENDING"),
    ];
    for (const b of bad) {
      await like(a.id, b.id);
      await react(a.id, b.id);
      await reply(a.id, b.id);
      await share(a.id, b.id);
    }
    await job.run(now);
    expect(await scores(a.id)).toEqual({ rankScore: 0, debateScore: 0 });
    const good = await user();
    await like(a.id, good.id);
    await job.run(now);
    expect((await scores(a.id)).rankScore).toBeCloseTo(1 / decay(10), 9);
  });

  it("counts a reply only when it is meaningful: 20 characters, or a voice clip", async () => {
    const q = await question();
    const a = await answer(q.id, (await user()).id, 10);
    await reply(a.id, (await user()).id, "AGREE", "too short");
    expect(
      (await (async () => (await job.run(now), scores(a.id)))()).rankScore,
    ).toBe(0);
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: (await user()).id,
        purpose: "REPLY",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        maxDurationMs: 10000,
      },
    });
    await h.prisma.reply.create({
      data: {
        answerId: a.id,
        authorId: clip.ownerId,
        stance: "EXPERIENCE",
        kind: "VOICE",
        clipId: clip.id,
      },
    });
    await job.run(now);
    expect((await scores(a.id)).rankScore).toBeCloseTo(2 / decay(10), 9);
  });

  it("older answers with the same signals rank lower (decay)", async () => {
    const q = await question();
    const fans = await Promise.all([user(), user(), user()]);
    const ids: string[] = [];
    for (const age of [8, 20, 60]) {
      const a = await answer(q.id, (await user()).id, age);
      for (const f of fans) await react(a.id, f.id);
      ids.push(a.id);
    }
    await job.run(now);
    const [x, y, z] = await Promise.all(ids.map(scores));
    expect(x.rankScore).toBeGreaterThan(y.rankScore);
    expect(y.rankScore).toBeGreaterThan(z.rankScore);
    expect(x.rankScore).toBeCloseTo(4.5 / decay(8), 9);
  });

  it("gives an answer under 6 hours old at least the question's median, and nobody older", async () => {
    const q = await question();
    const fans = await Promise.all([user(), user(), user(), user()]);
    const old: string[] = [];
    for (const k of [1, 2, 3]) {
      const a = await answer(q.id, (await user()).id, 12);
      for (const f of fans.slice(0, k)) await like(a.id, f.id);
      old.push(a.id);
    }
    const fresh = await answer(q.id, (await user()).id, 1);
    const stale = await answer(q.id, (await user()).id, 7);
    await job.run(now);
    const base = [1, 2, 3].map((k) => k / decay(12));
    const median = [0, 0, ...base].sort((a, b) => a - b); // the fresh and the 7 hour answer score 0 before the floor
    const mid = median[2];
    expect((await scores(fresh.id)).rankScore).toBeCloseTo(mid, 9);
    expect((await scores(stale.id)).rankScore).toBe(0);
    // the floor never lowers a strong new answer
    const strong = await answer(q.id, (await user()).id, 1);
    for (const f of fans) await react(strong.id, f.id);
    await job.run(now);
    expect((await scores(strong.id)).rankScore).toBeCloseTo(6 / decay(1), 9);
  });

  it("a Disagree reaction raises rank like any other kind, and never lowers it", async () => {
    const q = await question();
    const author = await user();
    const [a, b] = [
      await answer(q.id, author.id, 10),
      await answer(q.id, author.id, 10),
    ];
    const fan = await user();
    const crowd = await Promise.all([user(), user()]);
    for (const c of crowd) {
      await react(a.id, c.id, "POWERFUL");
      await react(b.id, c.id, "POWERFUL");
    }
    await job.run(now);
    const before = (await scores(a.id)).rankScore;
    await react(a.id, fan.id, "DISAGREE");
    await react(b.id, fan.id, "WELL_SAID");
    await job.run(now);
    const afterA = (await scores(a.id)).rankScore;
    expect(afterA).toBeGreaterThan(before);
    expect(afterA).toBeCloseTo(4.5 / decay(10), 9);
    expect(afterA).toBe((await scores(b.id)).rankScore);
  });

  it("debateScore rewards replies from both sides over one side", async () => {
    const q = await question();
    const author = await user();
    const two = await answer(q.id, author.id, 10);
    const one = await answer(q.id, author.id, 10);
    const [p1, p2, p3] = await Promise.all([user(), user(), user()]);
    await reply(two.id, p1.id, "AGREE");
    await reply(two.id, p2.id, "DISAGREE");
    await reply(one.id, p1.id, "AGREE");
    await reply(one.id, p3.id, "AGREE");
    // one person on both sides is not a debate
    const solo = await answer(q.id, author.id, 10);
    await reply(solo.id, p1.id, "AGREE");
    await reply(
      solo.id,
      p1.id,
      "DISAGREE",
      "And now the other side of it, too.",
    );
    await job.run(now);
    expect((await scores(two.id)).debateScore).toBeCloseTo(
      4 / decay(10, 1.2),
      9,
    );
    expect((await scores(one.id)).debateScore).toBeCloseTo(
      2 / decay(10, 1.2),
      9,
    );
    expect((await scores(solo.id)).debateScore).toBeCloseTo(
      1 / decay(10, 1.2),
      9,
    );
    expect((await scores(two.id)).debateScore).toBeGreaterThan(
      (await scores(one.id)).debateScore,
    );
  });

  it("only questions that are open, or closed within 7 days, are rescored", async () => {
    const closedLong = await question("CLOSED", { endsAt: ago(24 * 9) });
    const closedRecent = await question("CLOSED", { endsAt: ago(24 * 2) });
    const fan = await user();
    const ids: string[] = [];
    for (const q of [closedLong, closedRecent]) {
      const a = await answer(q.id, (await user()).id, 30);
      await like(a.id, fan.id);
      ids.push(a.id);
    }
    await job.run(now);
    const [x, y] = await Promise.all(ids.map(scores));
    expect(x.rankScore).toBe(0);
    expect(y.rankScore).toBeGreaterThan(0);
  });

  it("a list across questions leaves out stale scores from questions the job no longer rescores", async () => {
    const cat = await h.prisma.category.create({
      data: { slug: `rs-${randomUUID().slice(0, 8)}`, name: "Stale" },
    });
    const old = await question("CLOSED", {
      categoryId: cat.id,
      endsAt: ago(24 * 9),
    });
    const recent = await question("LIVE", { categoryId: cat.id });
    const stale = await h.prisma.answer.create({
      data: {
        questionId: old.id,
        authorId: (await user()).id,
        kind: "TEXT",
        body: "An old strong one.",
        rankScore: 50,
      },
    });
    const live = await answer(recent.id, (await user()).id, 3);
    const r = await h
      .http()
      .get(`/api/v1/feed/trending?categoryId=${cat.id}`)
      .expect(200);
    const got = (r.body.items as { answer: { id: string } }[]).map(
      (i) => i.answer.id,
    );
    expect(got).toEqual([live.id]);
    expect(got).not.toContain(stale.id);
  });

  it("20 parallel runs give one consistent result, and a second process waits its turn", async () => {
    const q = await question();
    const fans = await Promise.all([user(), user(), user()]);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const a = await answer(q.id, (await user()).id, 8 + i);
      for (const f of fans.slice(0, i % 4)) await like(a.id, f.id);
      ids.push(a.id);
    }
    const runs = await Promise.all(
      Array.from({ length: 20 }, () => job.run(now)),
    );
    expect(new Set(runs).size).toBe(1); // every caller got the same single pass
    expect(runs[0].ran).toBe(true);
    const first = await Promise.all(ids.map(scores));
    first.forEach((s, i) =>
      expect(s.rankScore).toBeCloseTo(((i % 4) * 1) / decay(8 + i), 9),
    );
    await job.run(now);
    expect(await Promise.all(ids.map(scores))).toEqual(first);
    // another process holds the lock: this one does nothing and says so
    const other = new Client({ connectionString: TEST_DATABASE_URL });
    await other.connect();
    try {
      await other.query("SELECT pg_advisory_lock($1)", [RANKING_LOCK]);
      await h.prisma.like.create({
        data: { answerId: ids[0], userId: fans[0].id },
      });
      const skipped = await job.run(now);
      expect(skipped.ran).toBe(false);
      expect((await scores(ids[0])).rankScore).toBe(first[0].rankScore);
    } finally {
      await other.query("SELECT pg_advisory_unlock($1)", [RANKING_LOCK]);
      await other.end();
    }
    expect((await job.run(now)).ran).toBe(true);
    expect((await scores(ids[0])).rankScore).toBeGreaterThan(0);
  });

  it("reads the weights from config", async () => {
    const q = await question();
    const a = await answer(q.id, (await user()).id, 10);
    await like(a.id, (await user()).id);
    await h.prisma.configEntry.upsert({
      where: { key: "ranking.weight_like_pct" },
      create: { key: "ranking.weight_like_pct", valueJson: 300 },
      update: { valueJson: 300 },
    });
    try {
      await job.run(now);
      expect((await scores(a.id)).rankScore).toBeCloseTo(3 / decay(10), 9);
    } finally {
      await h.prisma.configEntry.delete({
        where: { key: "ranking.weight_like_pct" },
      });
    }
    expect(RANKING_DEFAULTS).toMatchObject({
      intervalMinutes: 5,
      windowDays: 7,
      fairChanceHours: 6,
      likeWeight: 100,
      reactionWeight: 150,
      replyWeight: 200,
      shareWeight: 100,
    });
  });

  it("Top, Debated, Trending and the featured voice follow the scores, on real data", async () => {
    const cat = await h.prisma.category.create({
      data: { slug: `rk-${randomUUID().slice(0, 8)}`, name: "Ranking" },
    });
    const q = await question("LIVE", { categoryId: cat.id });
    const author = await user();
    const crowd = await Promise.all(Array.from({ length: 6 }, () => user()));
    // newest first: c (1 like), b (3 reactions), a (4 reactions, 4 replies both sides), d (nothing, oldest)
    const d = await answer(q.id, author.id, 40);
    const a = await answer(q.id, author.id, 30);
    const b = await answer(q.id, author.id, 20);
    const c = await answer(q.id, author.id, 10);
    for (const p of crowd.slice(0, 4)) await react(a.id, p.id);
    await reply(a.id, crowd[0].id, "AGREE");
    await reply(a.id, crowd[1].id, "DISAGREE");
    await reply(a.id, crowd[2].id, "AGREE");
    await reply(a.id, crowd[3].id, "DISAGREE");
    // the counters the reply route keeps (the label reads them with debateScore)
    await h.prisma.answer.update({
      where: { id: a.id },
      data: { agreeCount: 2, disagreeCount: 2, replyCount: 4 },
    });
    for (const p of crowd.slice(0, 3)) await react(b.id, p.id);
    await like(c.id, crowd[5].id);
    await job.run(now);
    const get = (path: string) => h.http().get(`/api/v1${path}`);
    const ids = (r: {
      body: { items: { answer?: { id: string }; id?: string }[] };
    }) => r.body.items.map((i) => i.answer?.id ?? i.id);
    const sa = await scores(a.id);
    const sb = await scores(b.id);
    const sc = await scores(c.id);
    expect(sa.rankScore).toBeGreaterThan(sb.rankScore);
    expect(sb.rankScore).toBeGreaterThan(sc.rankScore);
    expect(sc.rankScore).toBeGreaterThan(0);
    const top = await get(`/questions/${q.id}/answers?sort=TOP`).expect(200);
    expect(ids(top)).toEqual([a.id, b.id, c.id, d.id]);
    const debated = await get(`/questions/${q.id}/answers?sort=DEBATED`).expect(
      200,
    );
    expect(ids(debated)[0]).toBe(a.id);
    const fresh = await get(`/questions/${q.id}/answers?sort=NEW`).expect(200);
    expect(ids(fresh)).toEqual([c.id, b.id, a.id, d.id]);
    const first = top.body.items[0].answer;
    expect(first.labels).toContain("MOST_DEBATED");
    // the featured voice of the question's share page is the top one
    const l = await h
      .http()
      .post("/api/v1/share/links")
      .send({ objectType: "QUESTION", objectId: q.id })
      .expect(201);
    const page = await get(`/share/${l.body.code}`).expect(200);
    expect(page.body.featuredVoice.id).toBe(a.id);
    // Home trending: this question's best answer comes before its weaker ones
    const trending = await get(`/feed/trending?categoryId=${cat.id}`).expect(
      200,
    );
    const order = ids(trending);
    expect(order.indexOf(a.id)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(a.id)).toBeLessThan(order.indexOf(b.id));
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(c.id));
    expect(trending.body.items[0].answer.labels).toContain("TRENDING");
  });

  it("2,000 answers on one question finish inside one tick without delaying a request", async () => {
    const q = await question();
    const sql = (text: string, params: unknown[] = []) =>
      h.prisma.$executeRawUnsafe(text, ...params);
    await sql(
      `INSERT INTO "User" (id, "wawuId", handle, "referralCode", "updatedAt")
       SELECT gen_random_uuid()::text, 'big-' || i || '-' || $1, 'b' || i || substr($1, 1, 6), 'bg' || i || substr($1, 1, 6), now()
       FROM generate_series(1, 400) i`,
      [randomUUID().slice(0, 8)],
    );
    const people = (
      await h.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "User" WHERE "wawuId" LIKE 'big-%' ORDER BY id`,
      )
    ).map((p) => p.id);
    expect(people.length).toBeGreaterThanOrEqual(400);
    await h.prisma.answer.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        questionId: q.id,
        authorId: people[i % 400],
        kind: "TEXT" as const,
        body: `Voice number ${i} about the salary.`,
        createdAt: ago(1 + (i % 150)),
      })),
    });
    const ansIds = (
      await h.prisma.answer.findMany({
        where: { questionId: q.id },
        select: { id: true },
        orderBy: { id: "asc" },
      })
    ).map((x) => x.id);
    expect(ansIds).toHaveLength(2000);
    await h.prisma.like.createMany({
      data: ansIds.flatMap((id, i) =>
        [1, 2, 3].map((k) => ({
          answerId: id,
          userId: people[(i + k * 37) % 400],
        })),
      ),
      skipDuplicates: true,
    });
    await h.prisma.reaction.createMany({
      data: ansIds.flatMap((id, i) =>
        [5, 9].map((k) => ({
          answerId: id,
          userId: people[(i + k * 11) % 400],
          kind: (k === 5 ? "DISAGREE" : "WELL_SAID") as never,
        })),
      ),
      skipDuplicates: true,
    });
    await h.prisma.reply.createMany({
      data: ansIds.flatMap((id, i) =>
        [3, 4].map((k) => ({
          answerId: id,
          authorId: people[(i + k * 53) % 400],
          stance: (k === 3 ? "AGREE" : "DISAGREE") as never,
          kind: "TEXT" as const,
          body: "A reply long enough to be meaningful here.",
        })),
      ),
    });

    const latencies: number[] = [];
    let go = true;
    const reader = (async () => {
      while (go) {
        const t = Date.now();
        await h
          .http()
          .get(`/api/v1/questions/${q.id}/answers?sort=TOP&limit=20`)
          .expect(200);
        latencies.push(Date.now() - t);
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
    const idle: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      await h
        .http()
        .get(`/api/v1/questions/${q.id}/answers?sort=TOP&limit=20`)
        .expect(200);
      idle.push(Date.now() - t);
    }
    latencies.length = 0;
    const t0 = Date.now();
    const r = await job.run(now);
    const ms = Date.now() - t0;
    go = false;
    await reader;
    const worst = Math.max(...latencies);
    console.log(
      `ranking 2,000 answers: job ${ms} ms (${r.questions} questions, ${r.written} written), ` +
        `GETs during the job: ${latencies.length}, worst ${worst} ms; idle GET max ${Math.max(...idle)} ms`,
    );
    expect(r.answers).toBeGreaterThanOrEqual(2000);
    expect(ms).toBeLessThan(5 * 60_000); // inside one 5 minute tick
    expect(latencies.length).toBeGreaterThan(0);
    expect(worst).toBeLessThan(200);
    const top = await h
      .http()
      .get(`/api/v1/questions/${q.id}/answers?sort=TOP&limit=50`)
      .expect(200);
    const rs = (
      await Promise.all(
        (top.body.items as { answer: { id: string } }[]).map((i) =>
          scores(i.answer.id),
        ),
      )
    ).map((s) => s.rankScore);
    expect([...rs].sort((x, y) => y - x)).toEqual(rs);
    // a second pass changes nothing: nothing to write
    expect((await job.run(now)).written).toBe(0);
  });
});
