/* eslint-disable -- a measuring script, run by hand with jest; it is not part of the suite or the build */
/**
 * C2.1-COST: statements and SQL time per route. Needs a Postgres whose log has log_min_duration_statement=0 (the log file
 * is PG_LOG) and a database loaded by the loader SQL. Run from a tree's api/ directory:
 *   DATABASE_URL=... PG_LOG=... BENCH_OUT=file.json npx tsx scripts/c21-cost-bench.ts
 * It counts the "execute" lines the server logged for each request (the same on every tree) and sums their durations.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { startHarness } from "../talk/harness";

const LOG = process.env.PG_LOG as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("measures", async () => {
  const h = await startHarness();
  const user = await h.prisma.user.findUniqueOrThrow({ where: { id: "00000000-0000-4000-8000-000000000001" } });
  const auth = `Bearer ${h.jwks.sign({ sub: user.wawuId })}`;
  const guest = { "X-Guest-Id": "00000000-0000-4000-8000-000000000001" };
  const routes: [string, string, boolean][] = [
    ["home guest", "/api/v1/home", false],
    ["home member", "/api/v1/home", true],
    ["notifications unread-count", "/api/v1/notifications/unread-count", true],
    ["notifications list", "/api/v1/notifications", true],
    ["me", "/api/v1/me", true],
    ["me/answers", "/api/v1/me/answers", true],
    ["people/{id} (guest)", "/api/v1/people/00000000-0000-4000-8000-000000000002", false],
    ["people/{id} (member)", "/api/v1/people/00000000-0000-4000-8000-000000000002", true],
    ["search people", "/api/v1/search?type=people&q=user1", true],
  ];
  let ip = 1;
  const one = async (url: string, member: boolean) => {
    const before = statSync(LOG).size;
    const r = h
      .http()
      .get(url)
      .set("X-Forwarded-For", `10.9.${(ip >> 8) & 255}.${ip++ & 255}`);
    const res = await (member ? r.set("Authorization", auth) : r.set(guest));
    await sleep(120);
    const buf = readFileSync(LOG).subarray(before).toString();
    let n = 0;
    let ms = 0;
    for (const m of buf.matchAll(/duration: ([\d.]+) ms\s+(?:execute [^:]*|statement):/g)) {
      n++;
      ms += Number(m[1]);
    }
    if (process.env.BENCH_SQL) {
      mkdirSync(process.env.BENCH_SQL, { recursive: true });
      writeFileSync(`${process.env.BENCH_SQL}/${url.replace(/[^a-z0-9]/gi, "_").slice(0, 60)}-${member ? "m" : "g"}.txt`, buf);
    }
    return { status: res.status, n, ms };
  };
  const out: Record<string, unknown> = {};
  for (const [name, url, member] of routes) {
    for (let i = 0; i < 3; i++) await one(url, member); // warm
    const runs = [];
    for (let i = 0; i < 9; i++) runs.push(await one(url, member));
    runs.sort((a, b) => a.ms - b.ms);
    const mid = runs[4];
    out[name] = { status: mid.status, statements: mid.n, sqlMs: Math.round(mid.ms * 10) / 10 };
    console.log(name.padEnd(28), mid.status, String(mid.n).padStart(4), mid.ms.toFixed(1).padStart(7));
  }
  writeFileSync(process.env.BENCH_OUT as string, JSON.stringify(out, null, 1));
  await h.close();
}, 600_000);
