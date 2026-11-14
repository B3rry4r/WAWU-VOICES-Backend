import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { ChargeSweeperService } from "../../src/talk/charge-sweeper.service";

const MIN = 60_000;
const DIST = join(process.cwd(), "node_modules", ".cache", "lit-dist");

/**
 * V-LINK-IN-TX: the API runs as a real process (compiled code), 50 people post at once and the process is killed part
 * way. After a restart and a sweep at +31 minutes nobody has a post AND a reversed charge, and nobody who was charged
 * without a post keeps the charge. SIGTERM lets a request in flight finish first.
 */
describe("V-LINK-IN-TX: a real process stopped part way", () => {
  jest.setTimeout(240_000);
  let h: Harness;
  let q: { id: string };
  let sweeper: ChargeSweeperService;
  const kids: ChildProcess[] = [];

  beforeAll(async () => {
    execFileSync(
      "npx",
      ["tsc", "-p", "tsconfig.build.json", "--outDir", DIST],
      { cwd: process.cwd(), stdio: "pipe" },
    );
    h = await startHarness();
    q = await makeQuestion(h);
    sweeper = h.app.get(ChargeSweeperService);
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    await sweeper.sweep(new Date(Date.now() + 400 * 86_400_000)); // other specs' leftovers
    // A slow post insert for the people listed (so the kill lands between the charge and the stored post), and a 1.5 s one for one text.
    await h.prisma.$executeRawUnsafe(
      `CREATE TABLE lit_slow ("userId" text PRIMARY KEY)`,
    );
    await h.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION lit_slow() RETURNS trigger AS $$
      BEGIN
        IF NEW."body" = 'slow-post-for-sigterm' THEN PERFORM pg_sleep(1.5);
        ELSIF EXISTS (SELECT 1 FROM lit_slow s WHERE s."userId" = NEW."authorId") THEN PERFORM pg_sleep(0.05 + random() * 0.15);
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await h.prisma.$executeRawUnsafe(
      `CREATE TRIGGER lit_slow BEFORE INSERT ON "Answer" FOR EACH ROW EXECUTE FUNCTION lit_slow()`,
    );
  });
  afterAll(async () => {
    for (const k of kids) k.kill("SIGKILL");
    await h.prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS lit_slow ON "Answer"`,
    );
    await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lit_slow()`);
    await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS lit_slow`);
    await h.close();
  });

  const freePort = () =>
    new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });

  async function boot() {
    const port = await freePort();
    const child = spawn("node", [join(DIST, "main.js")], {
      env: {
        ...process.env,
        PORT: String(port),
        MEDIA_WORKER: "off",
        THROTTLE_LIMIT: "1000000",
        WAWU_ID_JWKS_URL: h.jwks.url,
        NODE_ENV: "test",
      },
      stdio: "ignore",
    });
    kids.push(child);
    const exited = new Promise<number | null>((r) =>
      child.on("exit", (code, sig) => r(code ?? (sig ? -1 : null))),
    );
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
          return { child, port, exited };
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the API did not start");
  }

  const postVia = (port: number, p: Person, body: string) =>
    fetch(`http://127.0.0.1:${port}/api/v1/questions/${q.id}/answers`, {
      method: "POST",
      headers: {
        Authorization: p.auth,
        "Idempotency-Key": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "TEXT", body }),
    });

  it.each([1, 2, 3])(
    "run %i: 50 people post at once, SIGKILL part way, restart, sweep at +31 minutes",
    async (run) => {
      const people = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          makePerson(
            h,
            i % 2 ? { freePosts: 0, balanceMilli: 500_000 } : { freePosts: 3 },
          ),
        ),
      );
      const ids = people.map((p) => p.id);
      for (const p of people)
        await h.prisma
          .$executeRaw`INSERT INTO lit_slow ("userId") VALUES (${p.id})`;
      const api = await boot();
      const sent = people.map((p) =>
        postVia(api.port, p, `kill run ${run}`).then(
          (r) => r.status,
          () => 0,
        ),
      );
      // kill once a few posts are stored and the rest are still waiting in their transactions
      for (let i = 0; i < 2000; i++) {
        const n = await h.prisma.answer.count({
          where: { authorId: { in: ids } },
        });
        if (n >= 8) break;
        await new Promise((r) => setTimeout(r, 2));
      }
      api.child.kill("SIGKILL");
      await api.exited;
      const statuses = await Promise.all(sent);
      const answered = statuses.filter((s) => s === 201).length;
      // restart, then the sweeper's pass at +31 minutes
      const again = await boot();
      const reversedNow = await sweeper.sweep(new Date(Date.now() + 31 * MIN));
      again.child.kill("SIGKILL");
      await again.exited;

      const posts = await h.prisma.answer.findMany({
        where: { authorId: { in: ids } },
      });
      const charges = await h.prisma.charge.findMany({
        where: { userId: { in: ids } },
      });
      const byUser = new Map(charges.map((c) => [c.userId, c]));
      const postUsers = new Set(posts.map((a) => a.authorId));
      const linked = charges.filter((c) => c.refId !== null).length;
      const reversed = charges.filter((c) => c.status === "REVERSED").length;
      const postAndReversed = posts.filter(
        (a) => byUser.get(a.authorId)?.status === "REVERSED",
      );
      const postNotLinked = posts.filter(
        (a) => byUser.get(a.authorId)?.refId !== a.id,
      );
      const chargedNoPostKept = charges.filter(
        (c) => !postUsers.has(c.userId) && c.status !== "REVERSED",
      );
      console.info(
        `kill run ${run}: charges ${charges.length}, posts stored ${posts.length}, charges linked ${linked}, charges reversed ${reversed} (sweep ${reversedNow}), 201 answers seen ${answered}, post AND reversed charge ${postAndReversed.length}, post with unlinked charge ${postNotLinked.length}, charged with no post and not given back ${chargedNoPostKept.length}`,
      );
      expect(posts.length).toBeGreaterThanOrEqual(1);
      expect(postAndReversed).toHaveLength(0);
      expect(postNotLinked).toHaveLength(0);
      expect(chargedNoPostKept).toHaveLength(0);
      expect(linked).toBe(posts.length);
      expect(reversed).toBe(charges.length - posts.length);
      expect(answered).toBeLessThanOrEqual(posts.length);
      // the free-post people: a stored post used one, every other free post is back
      for (const p of people.filter((_, i) => i % 2 === 0)) {
        const left = (
          await h.prisma.freeAllowance.findUniqueOrThrow({
            where: { userId: p.id },
          })
        ).freePostsRemaining;
        expect(left).toBe(postUsers.has(p.id) ? 2 : 3);
      }
    },
  );

  it("SIGTERM: the request in flight finishes (201, stored, linked), a new connection is refused, the process exits 0", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const api = await boot();
    const t0 = Date.now();
    const slow = postVia(api.port, p, "slow-post-for-sigterm");
    await new Promise((r) => setTimeout(r, 400));
    api.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    await expect(
      fetch(`http://127.0.0.1:${api.port}/api/health`),
    ).rejects.toBeDefined();
    const res = await slow;
    expect(res.status).toBe(201);
    expect(await api.exited).toBe(0);
    const took = Date.now() - t0;
    console.info(`SIGTERM drain: 201 and exit 0 after ${took} ms`);
    expect(took).toBeLessThan(8000);
    const a = await h.prisma.answer.findFirstOrThrow({
      where: { authorId: p.id },
    });
    const c = await h.prisma.charge.findFirstOrThrow({
      where: { userId: p.id },
    });
    expect(c.refId).toBe(a.id);
    expect(c.status).toBe("COMMITTED");
  });
});
