import { Client } from "pg";
import { startHarness, makeQuestion, type Harness } from "../talk/harness";
import { TEST_DATABASE_URL } from "../test-env";
import { RankingService, RANKING_LOCK } from "../../src/feed/ranking.service";

/** The advisory-lock connection of the ranking job can be dropped by the database: the process must stay up. */
describe("ranking job lock connection", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it("survives the lock backend being killed mid-run, and the next run works", async () => {
    const job = h.app.get(RankingService);
    const q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 86_400_000) },
    });
    const errors: unknown[] = [];
    const onUncaught = (e: unknown) => errors.push(e);
    process.on("uncaughtException", onUncaught);
    // Hold the run inside its first question until the lock backend is killed.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const real = (job as unknown as { signals: (...a: unknown[]) => unknown })
      .signals;
    const spy = jest
      .spyOn(
        job as unknown as { signals: (...a: unknown[]) => unknown },
        "signals",
      )
      .mockImplementation(async (...a: unknown[]) => {
        await held;
        return real.apply(job, a);
      });
    const admin = new Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    try {
      const running = job.run();
      let pid: number | undefined;
      for (let i = 0; i < 100 && !pid; i++) {
        const r = await admin.query<{ pid: number }>(
          `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted
             AND ((classid::bigint << 32) | objid::bigint) = $1`,
          [RANKING_LOCK],
        );
        pid = r.rows[0]?.pid;
        if (!pid) await new Promise((r) => setTimeout(r, 50));
      }
      expect(pid).toBeDefined();
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      await new Promise((r) => setTimeout(r, 300)); // the 'error' event arrives
      release();
      const r = await running; // resolves; it does not reject or crash
      expect(r.ran).toBe(true);
      expect(errors).toEqual([]);
      spy.mockRestore();
      // the lock is free again and the next run does its work
      const next = await job.run();
      expect(next.ran).toBe(true);
      expect(next.questions).toBeGreaterThanOrEqual(1);
    } finally {
      process.off("uncaughtException", onUncaught);
      jest.restoreAllMocks();
      await admin.end();
    }
  });

  it("a pass visits only questions with a published answer (or live ones), and does not rewrite a score that moved less than 1e-6", async () => {
    const job = h.app.get(RankingService);
    const future = new Date(Date.now() + 30 * 86_400_000);
    const mk = (status: "SCHEDULED" | "LIVE") =>
      h.prisma.question.create({
        data: { text: "bank question", status, startsAt: future },
      });
    const base = await job.run();
    for (let i = 0; i < 5; i++) await mk("SCHEDULED"); // the bank: no answers
    expect((await job.run()).questions).toBe(base.questions);
    const withAnswer = await mk("SCHEDULED");
    const author = await h.prisma.user.create({
      data: {
        wawuId: `w-${Date.now()}`,
        handle: `eps${Date.now().toString(36)}`.slice(0, 20),
        referralCode: `r${Date.now().toString(36)}`,
      },
    });
    const a = await h.prisma.answer.create({
      data: {
        questionId: withAnswer.id,
        authorId: author.id,
        kind: "TEXT",
        body: "hello there",
        createdAt: new Date(Date.now() - 20 * 3_600_000),
        rankScore: 5e-9,
      },
    });
    expect((await job.run()).questions).toBe(base.questions + 1);
    // the true score is 0: a difference of 5e-9 is left alone, a difference of 1e-3 is corrected
    const score = async () =>
      (await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } }))
        .rankScore;
    expect(await score()).toBe(5e-9);
    await h.prisma.answer.update({
      where: { id: a.id },
      data: { rankScore: 0.001 },
    });
    await job.run();
    expect(await score()).toBe(0);
  });
});
