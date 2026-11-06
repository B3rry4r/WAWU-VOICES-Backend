/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { RankingService } from "../../src/feed/ranking.service";
import { DeletionService } from "../../src/me/deletion.service";
import { ExportService, ExportStore } from "../../src/me/export.service";
import { ListenRetentionService } from "../../src/talk/listen-retention.service";
import { visitorKeyOf } from "../../src/talk/listen-record";

/** LISTEN-1: who listened, kept on the server for the ranking and never shown. Real Postgres, real routes. */
describe("listen records", () => {
  let h: Harness;
  let q: { id: string };
  let author: Person;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 86_400_000) },
    });
    author = await makePerson(h);
  });
  afterAll(() => h.close());

  /** A voice answer whose clip is 10 seconds long, so finished is 9 seconds. */
  const voice = async (
    by: Person = author,
    durationMs: number | null = 10_000,
  ) => {
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: by.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: `raw/${randomUUID()}`,
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        maxDurationMs: 10_000,
        ...(durationMs ? { durationMs } : {}),
      },
    });
    return h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: by.id,
        kind: "VOICE",
        clipId: clip.id,
      },
    });
  };
  const report = (
    answerId: string,
    who: Person | string | null,
    body: object,
  ) => {
    const r = h.http().post(`/api/v1/answers/${answerId}/listen`);
    if (who && typeof who !== "string") r.set("Authorization", who.auth);
    if (typeof who === "string") r.set("X-Visitor-Id", who);
    return r.send(body);
  };
  const rowsOf = (answerId: string) =>
    h.prisma.answerListen.findMany({ where: { answerId } });

  it("keeps one row per person per answer, the maximum seconds never going down", async () => {
    const a = await voice();
    const p = await makePerson(h);
    await report(a.id, p, { secondsPlayed: 5, finished: false }).expect(204);
    await report(a.id, p, { secondsPlayed: 3, finished: false }).expect(204);
    let rows = await rowsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: p.id,
      visitorKey: null,
      secondsPlayed: 5,
      finished: false,
    });
    await report(a.id, p, { secondsPlayed: 7, finished: false }).expect(204);
    rows = await rowsOf(a.id);
    expect(rows[0].secondsPlayed).toBe(7);
    expect(rows[0].lastAt.getTime()).toBeGreaterThanOrEqual(
      rows[0].firstAt.getTime(),
    );
    // another person is another row
    const p2 = await makePerson(h);
    await report(a.id, p2, { secondsPlayed: 1 }).expect(204);
    expect(await rowsOf(a.id)).toHaveLength(2);
  });

  it("finished means at least 90% of the clip; the server decides from the clip's length and it never goes back", async () => {
    const a = await voice(); // 10 s
    const p = await makePerson(h);
    await report(a.id, p, { secondsPlayed: 8, finished: true }).expect(204);
    // the player says finished, the clip says 8 of 10 seconds: not finished
    expect((await rowsOf(a.id))[0].finished).toBe(false);
    await report(a.id, p, { secondsPlayed: 9, finished: false }).expect(204);
    expect((await rowsOf(a.id))[0]).toMatchObject({
      secondsPlayed: 9,
      finished: true,
    });
    await report(a.id, p, { secondsPlayed: 2, finished: false }).expect(204);
    expect((await rowsOf(a.id))[0]).toMatchObject({
      secondsPlayed: 9,
      finished: true,
    });
    // seconds past the end are capped at the clip's length
    const q2 = await voice();
    const p2 = await makePerson(h);
    await report(q2.id, p2, { secondsPlayed: 500 }).expect(204);
    expect((await rowsOf(q2.id))[0].secondsPlayed).toBe(10);
    // a clip with no stored length believes the player
    const noLen = await voice(author, null);
    await report(noLen.id, p, { secondsPlayed: 4, finished: true }).expect(204);
    expect((await rowsOf(noLen.id))[0].finished).toBe(true);
  });

  it("20 parallel reports from one person make 1 row, and one finish on the stored counter", async () => {
    const a = await voice();
    const p = await makePerson(h);
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        report(a.id, p, { secondsPlayed: 6 + (i % 5), finished: i % 5 === 3 }),
      ),
    );
    for (const r of res) expect(r.status).toBe(204);
    const rows = await rowsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ secondsPlayed: 10, finished: true });
    const row = await h.prisma.answer.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(row.listenThroughCount).toBe(1);
    expect(row.listenCount).toBe(0); // progress reports are not starts
  });

  it("20 parallel first reports from one guest make 1 row", async () => {
    const a = await voice();
    const v = randomUUID();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        report(a.id, v, { secondsPlayed: 10, finished: true }),
      ),
    );
    expect(await rowsOf(a.id)).toHaveLength(1);
    expect(
      (await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } }))
        .listenThroughCount,
    ).toBe(1);
  });

  it("a guest is kept by a keyed hash of the visitor id, never the id itself", async () => {
    const a = await voice();
    const v = randomUUID();
    await report(a.id, v, { secondsPlayed: 4 }).expect(204);
    await report(a.id, v, { secondsPlayed: 6 }).expect(204);
    const rows = await rowsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].visitorKey).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].visitorKey).toBe(visitorKeyOf(v));
    expect(rows[0].visitorKey).not.toContain(v);
    expect(JSON.stringify(rows)).not.toContain(v);
    // another id is another guest; a missing or odd id keeps no record at all
    await report(a.id, randomUUID(), { secondsPlayed: 1 }).expect(204);
    await report(a.id, null, { secondsPlayed: 1 }).expect(204);
    await report(a.id, "not a plain id!", { secondsPlayed: 1 }).expect(204);
    expect(await rowsOf(a.id)).toHaveLength(2);
    // a signed-in person is kept by account, even when a visitor id is also sent
    const p = await makePerson(h);
    await h
      .http()
      .post(`/api/v1/answers/${a.id}/listen`)
      .set("Authorization", p.auth)
      .set("X-Visitor-Id", v)
      .send({ secondsPlayed: 2 })
      .expect(204);
    const mine = (await rowsOf(a.id)).filter((r) => r.userId === p.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].visitorKey).toBeNull();
  });

  it("the old body still works and counts as a start", async () => {
    const a = await voice();
    const p = await makePerson(h);
    await report(a.id, p, { completed: false }).expect(204);
    await report(a.id, null, {}).expect(204);
    let row = await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.listenCount, row.listenThroughCount]).toEqual([2, 0]);
    expect(await rowsOf(a.id)).toEqual([
      expect.objectContaining({
        userId: p.id,
        secondsPlayed: 0,
        finished: false,
      }),
    ]);
    await report(a.id, p, { completed: true, positionMs: 9000 }).expect(204);
    row = await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.listenCount, row.listenThroughCount]).toEqual([3, 1]);
    expect((await rowsOf(a.id))[0]).toMatchObject({
      finished: true,
      secondsPlayed: 10,
    });
    // a repeat of the same person's finish does not add another finish
    await report(a.id, p, { completed: true }).expect(204);
    row = await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.listenCount, row.listenThroughCount]).toEqual([4, 1]);
    await report(a.id, p, { secondsPlayed: -1 }).expect(422);
    await report(a.id, p, { secondsPlayed: 1.5 }).expect(422);
  });

  it("a text answer, a missing answer and a hidden answer keep nothing", async () => {
    const p = await makePerson(h);
    const text = await h.prisma.answer.create({
      data: { questionId: q.id, authorId: author.id, kind: "TEXT", body: "hi" },
    });
    await report(text.id, p, { secondsPlayed: 3 }).expect(204);
    expect(await rowsOf(text.id)).toHaveLength(0);
    await report(randomUUID(), p, { secondsPlayed: 3 }).expect(404);
    const a = await voice();
    await h.prisma.block.create({
      data: { blockerId: author.id, blockedId: p.id },
    });
    await report(a.id, p, { secondsPlayed: 3 }).expect(404);
    expect(await rowsOf(a.id)).toHaveLength(0);
    await h.prisma.block.deleteMany({ where: { blockerId: author.id } });
  });

  describe("ranking", () => {
    const HOUR = 3_600_000;
    const now = new Date();
    it("adds unique FINISHED listeners at weight 0.5, with the same exclusions as the other inputs", async () => {
      const job = h.app.get(RankingService);
      const qq = await h.prisma.question.create({
        data: {
          text: "Ranking question",
          status: "LIVE",
          startsAt: new Date(now.getTime() - 200 * HOUR),
        },
      });
      const a = await h.prisma.answer.create({
        data: {
          questionId: qq.id,
          authorId: author.id,
          kind: "VOICE",
          createdAt: new Date(now.getTime() - 10 * HOUR),
        },
      });
      const mk = async (
        status: "ACTIVE" | "SUSPENDED" | "DELETED" = "ACTIVE",
      ) => {
        const p = await makePerson(h);
        if (status !== "ACTIVE")
          await h.prisma.user.update({ where: { id: p.id }, data: { status } });
        return p;
      };
      const listen = (
        userId: string | null,
        finished: boolean,
        visitorKey: string | null = null,
      ) =>
        h.prisma.answerListen.create({
          data: {
            answerId: a.id,
            userId,
            visitorKey,
            finished,
            secondsPlayed: finished ? 9 : 2,
          },
        });
      const good = await mk();
      const unfinished = await mk();
      const blockedByAuthor = await mk();
      const blockedAuthor = await mk();
      await h.prisma.block.createMany({
        data: [
          { blockerId: author.id, blockedId: blockedByAuthor.id },
          { blockerId: blockedAuthor.id, blockedId: author.id },
        ],
      });
      await listen(good.id, true);
      await listen(unfinished.id, false);
      await listen(blockedByAuthor.id, true);
      await listen(blockedAuthor.id, true);
      await listen((await mk("SUSPENDED")).id, true);
      await listen((await mk("DELETED")).id, true);
      await listen(author.id, true); // the author never counts
      await listen(null, true, "g".repeat(64)); // a guest counts, by key
      await listen(null, true, "h".repeat(64));
      await listen(null, false, "i".repeat(64)); // not finished
      await job.run(now);
      const s = await h.prisma.answer.findUniqueOrThrow({
        where: { id: a.id },
        select: { rankScore: true },
      });
      // one person at 0.5 and two guests at half of that (LS7, 0.25 each), over (10 + 2) ^ 1.5
      expect(s.rankScore).toBeCloseTo(1.0 / Math.pow(12, 1.5), 9);
      expect((await job.config()).listenWeight).toBe(50);
    });
  });

  describe("privacy", () => {
    it("the account purge deletes that person's listen rows and nobody else's", async () => {
      const a = await voice();
      const gone = await makePerson(h);
      const stays = await makePerson(h);
      await report(a.id, gone, { secondsPlayed: 5 }).expect(204);
      await report(a.id, stays, { secondsPlayed: 5 }).expect(204);
      await h.prisma.user.update({
        where: { id: gone.id },
        data: {
          status: "DELETION_PENDING",
          deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000),
        },
      });
      expect(
        await h.app.get(DeletionService).purgeDue(),
      ).toBeGreaterThanOrEqual(1);
      const rows = await rowsOf(a.id);
      expect(rows.map((r) => r.userId)).toEqual([stays.id]);
    });

    it("the data export includes the person's own listen rows and no one else's", async () => {
      const a = await voice();
      const me = await makePerson(h);
      const other = await makePerson(h);
      await report(a.id, me, { secondsPlayed: 9 }).expect(204);
      await report(a.id, other, { secondsPlayed: 3 }).expect(204);
      const ex = await h.prisma.dataExport.create({ data: { userId: me.id } });
      const store = h.app.get(ExportStore);
      const put: Buffer[] = [];
      jest.spyOn(store, "isConfigured").mockReturnValue(true);
      jest.spyOn(store, "put").mockImplementation((_k, b) => {
        put.push(b);
        return Promise.resolve();
      });
      await h.app.get(ExportService).build(ex.id, me.id);
      jest.restoreAllMocks();
      const file = JSON.parse(put[0].toString("utf8"));
      expect(file.listens).toEqual([
        {
          answerId: a.id,
          secondsPlayed: 9,
          finished: true,
          firstAt: expect.any(String),
          lastAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(file)).not.toContain(other.id);
    });

    it("guest rows older than 90 days are deleted; younger guests and signed-in rows stay", async () => {
      const a = await voice();
      const p = await makePerson(h);
      const day = 86_400_000;
      const at = (d: number) => new Date(Date.now() - d * day);
      await h.prisma.answerListen.createMany({
        data: [
          { answerId: a.id, visitorKey: "o".repeat(64), lastAt: at(91) },
          { answerId: a.id, visitorKey: "y".repeat(64), lastAt: at(89) },
          { answerId: a.id, userId: p.id, lastAt: at(400) },
        ],
      });
      const n = await h.app.get(ListenRetentionService).purgeGuests();
      expect(n).toBe(1);
      const left = (await rowsOf(a.id)).map((r) => r.visitorKey ?? "user");
      expect(left.sort()).toEqual(["user", "y".repeat(64)]);
      // the days are config
      await h.prisma.configEntry.upsert({
        where: { key: "privacy.listen_guest_days" },
        create: { key: "privacy.listen_guest_days", valueJson: 30 },
        update: { valueJson: 30 },
      });
      h.app.get(ListenRetentionService)["config"].invalidate();
      await h.prisma.answerListen.update({
        where: {
          answerId_visitorKey: { answerId: a.id, visitorKey: "y".repeat(64) },
        },
        data: { lastAt: at(31) },
      });
      expect(await h.app.get(ListenRetentionService).purgeGuests()).toBe(1);
      await h.prisma.configEntry.delete({
        where: { key: "privacy.listen_guest_days" },
      });
      h.app.get(ListenRetentionService)["config"].invalidate();
    });

    it("no API response or contract field exposes who listened", async () => {
      const a = await voice();
      const p = await makePerson(h);
      const v = randomUUID();
      await report(a.id, p, { secondsPlayed: 9 }).expect(204);
      await report(a.id, v, { secondsPlayed: 9 }).expect(204);
      const got = await h
        .http()
        .get(`/api/v1/answers/${a.id}`)
        .set("Authorization", author.auth)
        .expect(200);
      const list = await h
        .http()
        .get(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", author.auth)
        .expect(200);
      const key = visitorKeyOf(v) as string;
      for (const body of [got.body, list.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(key);
        expect(text).not.toContain(v);
        expect(text).not.toContain(p.id);
        expect(text).not.toMatch(/listeners|visitorKey|secondsPlayed/);
      }
      const spec = readFileSync(
        join(__dirname, "..", "..", "..", "docs", "contract", "openapi.yaml"),
        "utf8",
      );
      expect(spec).not.toMatch(/visitorKey|listeners|AnswerListen/);
    });
  });

  it("a visitor who sends more than 120 reports a minute is throttled; another visitor is not", async () => {
    const a = await voice();
    const v = randomUUID();
    for (let i = 0; i < 120; i++)
      await report(a.id, v, { secondsPlayed: 1 }).expect(204);
    const over = await report(a.id, v, { secondsPlayed: 1 }).expect(429);
    expect(over.body.error.code).toBe("RATE_LIMITED");
    await report(a.id, randomUUID(), { secondsPlayed: 1 }).expect(204);
  });

  describe("LS7: rotated visitor ids", () => {
    const HOUR = 3_600_000;
    const aged = async () => {
      const qq = await h.prisma.question.create({
        data: {
          text: "LS7 question",
          status: "LIVE",
          startsAt: new Date(Date.now() - 200 * HOUR),
        },
      });
      const clip = await h.prisma.voiceClip.create({
        data: {
          ownerId: author.id,
          purpose: "ANSWER",
          status: "READY",
          rawKey: `raw/${randomUUID()}`,
          rawMime: "audio/webm",
          playKey: `voice/${randomUUID()}.m4a`,
          maxDurationMs: 10_000,
          durationMs: 10_000,
        },
      });
      return h.prisma.answer.create({
        data: {
          questionId: qq.id,
          authorId: author.id,
          kind: "VOICE",
          clipId: clip.id,
          createdAt: new Date(Date.now() - 10 * HOUR),
        },
      });
    };
    const rank = async (id: string) =>
      (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).rankScore;

    it("a guest finisher adds half of what a signed-in finisher adds", async () => {
      const job = h.app.get(RankingService);
      const mine = await aged();
      const theirs = await aged();
      const p = await makePerson(h);
      await h.prisma.answerListen.create({
        data: {
          answerId: mine.id,
          userId: p.id,
          finished: true,
          secondsPlayed: 10,
        },
      });
      await h.prisma.answerListen.create({
        data: {
          answerId: theirs.id,
          visitorKey: "z".repeat(64),
          finished: true,
          secondsPlayed: 10,
        },
      });
      await job.run();
      const signed = await rank(mine.id);
      const guest = await rank(theirs.id);
      expect(signed).toBeGreaterThan(0);
      expect(guest / signed).toBeCloseTo(0.5, 6);
      expect((await job.config()).guestListenWeight).toBe(50);
    });

    it("500 rotated visitor ids from one address: past 300 a minute is 429, and ranking moves no more than 300 guests allow; no address is stored or logged", async () => {
      const IP = "203.0.113.77"; // one network address, as the proxy would pass it (trust proxy is 1 hop)
      const job = h.app.get(RankingService);
      const a = await aged();
      const written: string[] = [];
      const out = jest
        .spyOn(process.stdout, "write")
        .mockImplementation((c: unknown) => (written.push(String(c)), true));
      const err = jest
        .spyOn(process.stderr, "write")
        .mockImplementation((c: unknown) => (written.push(String(c)), true));
      let ok = 0;
      let limited = 0;
      try {
        for (let i = 0; i < 500; i++) {
          const r = await h
            .http()
            .post(`/api/v1/answers/${a.id}/listen`)
            .set("X-Forwarded-For", IP)
            .set("X-Visitor-Id", randomUUID())
            .send({ secondsPlayed: 10, finished: true });
          if (r.status === 204) ok++;
          else if (r.status === 429) limited++;
        }
        await job.run(new Date(a.createdAt.getTime() + 10 * HOUR));
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      expect(ok).toBe(300);
      expect(limited).toBe(200);
      expect(await rowsOf(a.id)).toHaveLength(300);
      // 300 guests at 0.5 x 0.5 over (10 + 2) ^ 1.5, and not a point more
      expect(await rank(a.id)).toBeCloseTo((300 * 0.25) / Math.pow(12, 1.5), 6);
      // the address is in no row and in no log line
      const hits = await h.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "AnswerListen" t WHERE row_to_json(t)::text ~ '(203\\.0\\.113|127\\.0\\.0\\.1|::1|::ffff)'`;
      expect(hits[0].n).toBe(0);
      expect(written.join("")).not.toMatch(
        /203\.0\.113|127\.0\.0\.1|::ffff|::1\b/,
      );
    });
  });
});
