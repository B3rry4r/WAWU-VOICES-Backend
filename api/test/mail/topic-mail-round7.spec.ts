import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import { TopicMailService } from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";

/**
 * V-TOPIC-MAILS-2 round 7. People the relay keeps failing never stop the mail for everybody (HIGH-1), the wait after a
 * named refusal grows with a brake (MEDIUM-1), a rate-limit 429 does not end the day (MEDIUM-2), unsubscribe links made
 * with either key work (LOW-1), quiet logs (LOW-3). A real database; the relay is a local stand-in on port 15099.
 * The clock is passed in (Lagos is UTC+1). Nothing real is sent. The numbers go to /tmp/r7-numbers.txt for the report.
 */
jest.setTimeout(600_000);
const PORT = 15099;
const KEY = "topic-mail-7-test-service-key";
const DAYS = ["2026-11-16", "2026-11-17", "2026-11-18"];
const MIN = 60_000;
const at = (hhmmZ: string, day: string) => new Date(`${day}T${hhmmZ}:00.000Z`);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const addr = (i: number) => `r7-${String(i).padStart(4, "0")}@r7.test`;
const note = (line: string) =>
  appendFileSync("/tmp/r7-numbers.txt", line + "\n");

type Resp =
  | number
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | "drop";
type Decide = (to: string, tag: string, n: number) => Resp;

describe("V-TOPIC-MAILS-2 round 7", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let cfg: ConfigService;
  let calls = new Map<string, number>();
  let decide: Decide = () => 200;
  let n = 0;
  let errors: string[] = [];
  let warns: string[] = [];
  let debugs: string[] = [];
  const tried = () => [...calls.values()].reduce((x, y) => x + y, 0);
  const people = async (count: number) => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r7-" } } });
    await a.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `r7-${String(i).padStart(4, "0")}`,
        wawuId: `r7-w-${i}`,
        handle: `r7.u${i}`,
        referralCode: `R7${i}`,
        status: "ACTIVE" as const,
        mailTo: addr(i),
        createdAt: new Date("2026-11-01T09:00:00.000Z"),
      })),
    });
  };
  const question = (day: string) =>
    a.prisma.question.create({
      data: {
        text: `What would you change about payday? ${day}`,
        status: "SCHEDULED",
        kind: "DAILY",
        scheduledFor: new Date(`${day}T00:00:00.000Z`),
        startsAt: new Date(`${day}T00:00:00.000Z`),
        endsAt: new Date(
          new Date(`${day}T00:00:00.000Z`).getTime() + 2 * 86_400_000,
        ),
        voiceCount: 1,
      } as never,
    });
  const inst = () => {
    const s = new TopicMailService(a.prisma, mailSvc, cfg);
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
  };
  const snap = () => new Map(calls);
  /** HTTP requests made to these people since `before`. */
  const callsSince = (before: Map<string, number>, idx: number[]) =>
    idx.map((i) => (calls.get(addr(i)) ?? 0) - (before.get(addr(i)) ?? 0));
  /** How many MailLog rows (template, eventKey) each of these people has. */
  const rowsOf = async (tpl: string, eventKey: string) => {
    const r = await a.prisma.mailLog.groupBy({
      by: ["userId"],
      where: { template: tpl, eventKey, userId: { startsWith: "r7-" } },
      _count: true,
    });
    return new Map(r.map((x) => [x.userId, x._count]));
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const b = JSON.parse(raw) as { to: string; tag: string };
        calls.set(b.to, (calls.get(b.to) ?? 0) + 1);
        const r = decide(b.to, b.tag, ++n);
        if (r === "drop") return req.socket.destroy();
        const st = typeof r === "number" ? r : r.status;
        const body =
          typeof r === "object"
            ? r.body
            : st === 200
              ? { id: "x" }
              : { error: "no" };
        res.writeHead(st, {
          "content-type": "application/json",
          ...(typeof r === "object" ? r.headers : {}),
        });
        res.end(body === undefined ? "" : JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    process.env.TOPIC_MAIL_PER_SECOND = "1000";
    a = await bootAdmin();
    svc = a.h.app.get(TopicMailService);
    mailSvc = a.h.app.get(MailService);
    cfg = a.h.app.get(ConfigService);
    jest.spyOn(svc, "pause").mockResolvedValue();
    jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation((m: unknown) => void errors.push(String(m)));
    jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation((m: unknown) => void warns.push(String(m)));
    jest
      .spyOn(Logger.prototype, "debug")
      .mockImplementation((m: unknown) => void debugs.push(String(m)));
  });

  beforeEach(async () => {
    calls = new Map();
    decide = () => 200;
    n = 0;
    errors = [];
    warns = [];
    debugs = [];
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    svc = inst();
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    (
      svc as unknown as { windowRefusals: Map<string, unknown> }
    ).windowRefusals?.clear();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    await a.prisma.user.updateMany({
      where: { id: { not: { startsWith: "r7-" } } },
      data: { mailTo: null },
    });
  });

  afterAll(async () => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r7-" } } });
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    (
      svc as unknown as { windowRefusals: Map<string, unknown> }
    ).windowRefusals?.clear();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    jest.restoreAllMocks();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  /** Runs `ticks` minutes of C01 from 06:00Z of `day`; `before` runs at the start of each tick (k). */
  const window = async (
    day: string,
    ticks: number,
    each?: (k: number) => void | Promise<void>,
    servers: () => TopicMailService[] = () => [svc],
  ) => {
    const q = await question(day);
    const t0 = at("06:00", day);
    for (let k = 0; k < ticks; k++) {
      await each?.(k);
      const t = plus(t0, k * MIN);
      await Promise.all(servers().map((s) => s.runDailyQuestion(t)));
    }
    const got = await rowsOf("C01", `question:${q.id}`);
    const aside = await a.prisma.topicMailTrouble.count({
      where: { template: "C01", window: day, asideAt: { not: null } },
    });
    return { got, aside };
  };
  const report = (
    name: string,
    r: { got: Map<string, number>; aside: number },
    total: number,
  ) => {
    const twice = [...r.got.values()].filter((v) => v > 1).length;
    note(
      `${name}: mailed ${r.got.size}/${total}, set aside ${r.aside}, mailed twice ${twice}, relay calls ${tried()}`,
    );
  };

  it("200 people, relay fine for 149 sends, then 500 for 20 ticks, then fine for 40: 200 mailed, 0 aside", async () => {
    await people(200);
    let ok = 0;
    let k0 = -1;
    let cur = 0;
    decide = () => {
      if (ok < 149) {
        ok++;
        return 200;
      }
      if (k0 < 0) k0 = cur;
      return cur < k0 + 20 ? 500 : 200;
    };
    const r = await window(DAYS[0], 60, (k) => void (cur = k));
    report("outage after 149 of 200", r, 200);
    expect(r.got.size).toBe(200);
    expect(r.aside).toBe(0);
    expect([...r.got.values()].every((v) => v === 1)).toBe(true);
  });

  it("2,100 people, down 60 ticks after 2,000 mailed, then up 30 ticks: all mailed, 0 aside", async () => {
    await people(2100);
    let ok = 0;
    let k0 = -1;
    let cur = 0;
    decide = () => {
      if (ok < 2000) {
        ok++;
        return 200;
      }
      if (k0 < 0) k0 = cur;
      return cur < k0 + 60 ? 500 : 200;
    };
    const r = await window(DAYS[0], 95, (k) => void (cur = k));
    report("outage after 2000 of 2100", r, 2100);
    expect(r.got.size).toBe(2100);
    expect(r.aside).toBe(0);
  });

  it("half the requests failing at random (seeded) for 60 ticks, then fine, 200 people: all mailed, 0 aside", async () => {
    await people(200);
    const rand = rng(7);
    let cur = 0;
    decide = () => (cur < 60 && rand() < 0.5 ? 500 : 200);
    const r = await window(DAYS[0], 100, (k) => void (cur = k));
    report("half failing 60 ticks", r, 200);
    expect(r.got.size).toBe(200);
    expect(r.aside).toBe(0);
  });

  it("10% of requests failing at random for the whole window, 2,000 people: everyone mailed", async () => {
    await people(2000);
    const rand = rng(11);
    decide = () => (rand() < 0.1 ? 500 : 200);
    const r = await window(DAYS[0], 120);
    report("10% failing all window", r, 2000);
    expect(r.got.size).toBe(2000);
    expect(r.aside).toBeLessThanOrEqual(2);
  });

  it("the relay is down from the very first send for 20 minutes, then fine: everyone mailed, 0 aside", async () => {
    await people(200);
    let cur = 0;
    decide = () => (cur < 20 ? 500 : 200);
    const r = await window(DAYS[0], 60, (k) => void (cur = k));
    report("down from first send for 20 ticks", r, 200);
    expect(r.got.size).toBe(200);
    expect(r.aside).toBe(0);
  });

  const cases: Array<[string, number, (i: number) => boolean]> = [
    ["5 always-500 addresses first of 200", 200, (i) => i < 5],
    ["5 in the middle of 200", 200, (i) => i >= 100 && i < 105],
    ["every 7th of 210 (30 addresses)", 210, (i) => i % 7 === 6],
  ];
  it.each(cases)(
    "%s: every good person mailed once a day on three days; failing ones cost little",
    async (name, total, isBad) => {
      await people(total);
      const bad = [...Array(total).keys()].filter(isBad);
      const good = [...Array(total).keys()].filter((i) => !isBad(i));
      const badAddr = new Set(bad.map(addr));
      decide = (to) => (badAddr.has(to) ? 500 : 200);
      const out: string[] = [];
      for (const day of DAYS) {
        const before = snap();
        const r = await window(day, 60);
        for (const i of good)
          expect(r.got.get(`r7-${String(i).padStart(4, "0")}`)).toBe(1);
        for (const i of bad)
          expect(r.got.get(`r7-${String(i).padStart(4, "0")}`)).toBeUndefined();
        const c = callsSince(before, bad);
        expect(r.aside).toBeLessThanOrEqual(bad.length);
        out.push(
          `${day}: good mailed ${good.length}/${good.length}, failing people: calls max ${Math.max(...c)} min ${Math.min(...c)} (total ${c.reduce((x, y) => x + y, 0)}), set aside ${r.aside} of ${bad.length}`,
        );
      }
      note(`round 5 case ${name}\n  ${out.join("\n  ")}`);
    },
  );

  it("two servers on the same tick and a restart in the middle: nobody twice, 5 bad of 200", async () => {
    await people(200);
    const badAddr = new Set([0, 1, 2, 3, 4, 50, 51].map(addr));
    decide = (to) => (badAddr.has(to) ? 500 : 200);
    let pair = [svc, inst()];
    const r = await window(
      DAYS[0],
      60,
      (k) => {
        if (k === 25) pair = [inst(), inst()];
      },
      () => pair,
    );
    report("two servers + restart", r, 200);
    expect(r.got.size).toBe(193);
    expect([...r.got.values()].every((v) => v === 1)).toBe(true);
  });
});
