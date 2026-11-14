/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";
import { TopicsAdminService } from "../../src/admin/topics.service";
import {
  isQuestionReadable,
  invalidateUnreadableQuestions,
  setDirectRuleOnly,
  setUnreadableListTtl,
  unreadableQuestionIds,
} from "../../src/feed/question-window";

/**
 * C2.1-COST. The six hot routes read the window through one cached list of unreadable questions that hold a post. This
 * spec proves (1) 300 random worlds give the same answer with the list as with the direct rule, (2) a stale list only ever
 * hides, never shows early, and shows it within 15 seconds, (3) the list is dropped at once by the writes that change a question.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const H = 3_600_000;
const POSITIONS = ["before", "inside", "past", "noStart", "noEnd", "none"];
const STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "CLOSED"] as const;

/** The body as text, with a cursor's issue time (iat, the clock of the call) left out. */
const same = (r: unknown): string =>
  JSON.stringify(r, (k, v: unknown) => {
    if (k !== "nextCursor" || typeof v !== "string") return v;
    const c = JSON.parse(Buffer.from(v, "base64url").toString()) as Record<
      string,
      unknown
    >;
    delete c.iat;
    return c;
  });

function windowOf(pos: string, now: number) {
  switch (pos) {
    case "before":
      return { startsAt: new Date(now + H), endsAt: new Date(now + 2 * H) };
    case "inside":
      return { startsAt: new Date(now - H), endsAt: new Date(now + H) };
    case "past":
      return { startsAt: new Date(now - 2 * H), endsAt: new Date(now - H) };
    case "noStart":
      return { startsAt: null, endsAt: new Date(now + H) };
    case "noEnd":
      return { startsAt: new Date(now - H), endsAt: null };
    default:
      return { startsAt: null, endsAt: null };
  }
}

describe("C2.1 the list of unreadable questions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    setDirectRuleOnly(false);
    setUnreadableListTtl(0);
    await h.close();
  });
  const wipe = () =>
    h.prisma.$executeRawUnsafe(
      `TRUNCATE "Question", "User" RESTART IDENTITY CASCADE`,
    );

  it("300 random worlds: the six routes answer the same with the list as with the direct rule", async () => {
    setUnreadableListTtl(0);
    const rand = rng(21_1114);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const chance = (p: number) => rand() < p;
    let addr = 1;
    let emptyWorlds = 0;
    let listedWorlds = 0;
    let routesCompared = 0;
    const diffs: string[] = [];
    for (let w = 0; w < 300; w++) {
      await wipe();
      const now = Date.now();
      const a = await makePerson(h);
      const b = await makePerson(h);
      const c = await makePerson(h);
      const people = [a, b, c];
      await h.prisma.user.updateMany({
        where: { id: { in: people.map((p) => p.id) } },
        data: {
          voiceCount: Math.floor(rand() * 6),
          replyCount: Math.floor(rand() * 6),
          reactionsReceived: Math.floor(rand() * 6),
        },
      });
      const nQ = Math.floor(rand() * 6);
      const answers: { id: string; qid: string; by: Person }[] = [];
      const replies: { id: string; qid: string; by: Person }[] = [];
      const proposals: { id: string; qid: string }[] = [];
      const questions: { id: string; hasPosts: boolean }[] = [];
      for (let i = 0; i < nQ; i++) {
        const q = await h.prisma.question.create({
          data: {
            text: `world ${w} question ${i}`,
            status: pick(STATUSES),
            ...windowOf(pick(POSITIONS), now),
          },
        });
        let hasPosts = false;
        const nA = chance(0.6) ? 1 + Math.floor(rand() * 3) : 0;
        for (let k = 0; k < nA; k++) {
          const by = pick(people);
          const voice = chance(0.4);
          const clip = voice
            ? await h.prisma.voiceClip.create({
                data: {
                  ownerId: by.id,
                  purpose: "ANSWER",
                  status: "READY",
                  rawKey: `raw/${w}-${i}-${k}`,
                  rawMime: "audio/mp4",
                  maxDurationMs: 30000,
                },
              })
            : null;
          const ans = await h.prisma.answer.create({
            data: {
              questionId: q.id,
              authorId: by.id,
              kind: voice ? "VOICE" : "TEXT",
              body: voice ? null : `answer ${w}-${i}-${k}`,
              clipId: clip?.id ?? null,
              anonymous: chance(0.25),
              status: pick(["PUBLISHED", "PUBLISHED", "PUBLISHED", "HELD"]),
            },
          });
          answers.push({ id: ans.id, qid: q.id, by });
          hasPosts = true;
          if (chance(0.5)) {
            const other = pick(people.filter((p) => p.id !== by.id));
            await h.prisma.reaction.create({
              data: { answerId: ans.id, userId: other.id, kind: "POWERFUL" },
            });
          }
          if (chance(0.5)) {
            const other = pick(people);
            const rep = await h.prisma.reply.create({
              data: {
                answerId: ans.id,
                authorId: other.id,
                stance: "AGREE",
                kind: "TEXT",
                body: "reply",
                status: pick(["PUBLISHED", "PUBLISHED", "REMOVED"]),
              },
            });
            replies.push({ id: rep.id, qid: q.id, by: other });
          }
        }
        if (chance(0.25)) {
          const by = pick(people);
          const p = await h.prisma.proposal.create({
            data: {
              questionId: q.id,
              authorId: by.id,
              kind: "TEXT",
              body: "proposal",
            },
          });
          proposals.push({ id: p.id, qid: q.id });
          hasPosts = true;
        }
        if (chance(0.5))
          await h.prisma.savedQuestion.create({
            data: { userId: a.id, questionId: q.id },
          });
        questions.push({ id: q.id, hasPosts });
      }
      // notices of A: about voices, replies, proposals and questions (some on questions with no post), plain ones
      let nn = 0;
      const notice = (d: {
        type: "REPLY" | "REACTIONS" | "POLL_CLOSED" | "UNITS_ADDED";
        targetType?: string;
        targetId?: string;
        groupKey?: string;
      }) =>
        h.prisma.notification.create({
          data: {
            userId: a.id,
            title: `notice ${nn++}`,
            body: chance(0.5) ? "words" : null,
            readAt: chance(0.3) ? new Date() : null,
            ...d,
          },
        });
      for (const x of answers) {
        if (chance(0.5))
          await notice({
            type: "REACTIONS",
            targetType: pick(["answer", "ANSWER"]),
            targetId: x.id,
            groupKey: `reactions:${x.id}`,
          });
        if (chance(0.3))
          await notice({
            type: "POLL_CLOSED",
            targetType: pick(["answer", "Answer"]),
            targetId: x.id,
          });
      }
      for (const r of replies) {
        const own = answers.find((x) => x.qid === r.qid);
        if (own && chance(0.6))
          await notice({
            type: "REPLY",
            targetType: "answer",
            targetId: own.id,
            groupKey: `reply:${r.id}`,
          });
        if (chance(0.3))
          await notice({
            type: "POLL_CLOSED",
            targetType: "reply",
            targetId: r.id,
          });
      }
      for (const p of proposals)
        if (chance(0.7))
          await notice({
            type: "POLL_CLOSED",
            targetType: pick(["proposal", "PROPOSAL"]),
            targetId: p.id,
          });
      for (const q of questions)
        if (chance(0.7))
          await notice({
            type: "POLL_CLOSED",
            targetType: pick(["question", "QUESTION"]),
            targetId: q.id,
          });
      if (chance(0.7)) await notice({ type: "UNITS_ADDED" });

      const handle = (
        await h.prisma.user.findUniqueOrThrow({ where: { id: a.id } })
      ).handle.slice(0, 8);
      const routes: [string, string, Person][] = [
        ["me", "/api/v1/me", a],
        ["person as b", `/api/v1/people/${a.id}`, b],
        ["person as a", `/api/v1/people/${a.id}`, a],
        ["me/answers", "/api/v1/me/answers", a],
        ["search people", `/api/v1/search?type=people&q=${handle}`, b],
        ["notifications", "/api/v1/notifications", a],
        ["notifications unread", "/api/v1/notifications?unreadOnly=true", a],
        ["unread-count", "/api/v1/notifications/unread-count", a],
      ];
      const run = async () => {
        const out: unknown[] = [];
        for (const [, url, who] of routes) {
          const res = await h
            .http()
            .get(url)
            .set("Authorization", who.auth)
            .set(
              "X-Forwarded-For",
              `10.${(addr >> 16) & 255}.${(addr >> 8) & 255}.${addr++ & 255}`,
            );
          out.push({ status: res.status, body: res.body });
        }
        return out;
      };
      setDirectRuleOnly(false);
      const listed = await unreadableQuestionIds(h.prisma);
      if (listed && listed.length > 0) listedWorlds++;
      else emptyWorlds++;
      // the list is exactly: not readable now (the one rule, in code) and holding a post
      const rows = await h.prisma.question.findMany({
        where: { id: { in: questions.map((q) => q.id) } },
      });
      const want = rows
        .filter(
          (q) =>
            questions.find((x) => x.id === q.id)?.hasPosts &&
            !isQuestionReadable(q, new Date()),
        )
        .map((q) => q.id)
        .sort();
      expect([...(listed ?? [])].sort()).toEqual(want);
      const withList = await run();
      setDirectRuleOnly(true);
      const direct = await run();
      setDirectRuleOnly(false);
      routes.forEach(([name], i) => {
        routesCompared++;
        expect((withList[i] as { status: number }).status).toBe(200);
        if (same(withList[i]) !== same(direct[i]))
          diffs.push(`world ${w} ${name}`);
      });
    }
    expect(diffs).toEqual([]);
    expect(routesCompared).toBe(300 * 8);
    // both paths were exercised: worlds with an empty list (no join) and with a list (NOT IN, or the direct filter)
    expect(emptyWorlds).toBeGreaterThan(10);
    expect(listedWorlds).toBeGreaterThan(100);
  }, 1_800_000);

  it("a stale list only hides: it never shows a question early, and shows it within 15 seconds of opening", async () => {
    await wipe();
    setUnreadableListTtl(15_000);
    const a = await makePerson(h);
    const t0 = new Date();
    const q = await h.prisma.question.create({
      data: {
        text: "opens in ten seconds",
        status: "SCHEDULED",
        startsAt: new Date(t0.getTime() + 10_000),
        endsAt: new Date(t0.getTime() + H),
      },
    });
    await h.prisma.answer.create({
      data: { questionId: q.id, authorId: a.id, kind: "TEXT", body: "early" },
    });
    invalidateUnreadableQuestions();
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const has = async (ms: number) =>
      (await unreadableQuestionIds(h.prisma, at(ms)))?.includes(q.id);
    // before it opens, at every moment the list holds it: nothing of it is visible early
    for (const ms of [0, 1, 2_500, 5_000, 9_999])
      expect(await has(ms)).toBe(true);
    // it opened at +10 s; the list made at +0 s is 12 s old: it still hides (the allowed direction)
    expect(await has(10_000)).toBe(true);
    expect(await has(12_000)).toBe(true);
    expect(await has(14_999)).toBe(true);
    // at 15 s the list is made again: the question is readable and gone from it
    expect(await has(15_000)).toBe(false);
    expect(await has(15_001)).toBe(false);
    // a clock that went back never trusts a list from its future
    expect(await has(0)).toBe(true);
    setUnreadableListTtl(0);
  });

  it("the same on the real route, on the real clock: hidden before it opens and while the old list lives, shown within 15 seconds", async () => {
    await wipe();
    setUnreadableListTtl(15_000);
    const a = await makePerson(h);
    const q = await h.prisma.question.create({
      data: {
        text: "opens in two seconds",
        status: "SCHEDULED",
        startsAt: new Date(Date.now() + 2_500),
        endsAt: new Date(Date.now() + H),
      },
    });
    await h.prisma.answer.create({
      data: { questionId: q.id, authorId: a.id, kind: "TEXT", body: "early" },
    });
    invalidateUnreadableQuestions();
    const mine = async () =>
      (
        await h
          .http()
          .get("/api/v1/me/answers")
          .set("Authorization", a.auth)
          .expect(200)
      ).body.items.length as number;
    const t0 = Date.now();
    expect(await mine()).toBe(0); // not open: nothing; this call makes the list
    await new Promise((r) => setTimeout(r, 3_000));
    expect(Date.now() - t0).toBeLessThan(14_000);
    expect(await mine()).toBe(0); // open now, the list is 3 s old: still hidden, never shown early
    await new Promise((r) => setTimeout(r, 15_000 - (Date.now() - t0) + 100));
    expect(await mine()).toBe(1); // within 15 seconds of the first call it is there
    setUnreadableListTtl(0);
  }, 40_000);

  it("a write that changes a question's status drops the list at once (both directions)", async () => {
    await wipe();
    setUnreadableListTtl(15_000);
    const topics = h.app.get(TopicsAdminService);
    const admin = await makePerson(h, { roles: ["ADMIN"] });
    const a = await makePerson(h);
    const open = {
      status: "SCHEDULED" as const,
      startsAt: new Date(Date.now() - H),
      endsAt: new Date(Date.now() + H),
    };
    const q = await h.prisma.question.create({
      data: { text: "an open question", kind: "DAILY", ...open },
    });
    await h.prisma.answer.create({
      data: { questionId: q.id, authorId: a.id, kind: "TEXT", body: "mine" },
    });
    invalidateUnreadableQuestions();
    const mine = async () =>
      (
        await h
          .http()
          .get("/api/v1/me/answers")
          .set("Authorization", a.auth)
          .expect(200)
      ).body.items.length as number;
    expect(await mine()).toBe(1); // list made: empty
    expect(await unreadableQuestionIds(h.prisma)).toEqual([]);
    // an editor takes it back to a draft: it must vanish at once, not when the list expires
    await topics.updateQuestion(admin.id, q.id, {
      kind: "DAILY",
      text: "an open question",
      status: "DRAFT",
    });
    expect(await mine()).toBe(0);
    expect(await unreadableQuestionIds(h.prisma)).toEqual([q.id]);
    // and publishes it again: it must come back at once
    await topics.updateQuestion(admin.id, q.id, {
      kind: "DAILY",
      text: "an open question",
      status: "LIVE",
    });
    expect(await mine()).toBe(1);
    setUnreadableListTtl(0);
  });

  it("every write that can change a question's dates or status drops the list (a scan of src)", () => {
    // Writers that only move a counter (answerCount, voiceCount) are not listed: they cannot change the window.
    const COUNTER_ONLY = new Set([
      "talk/posts.service.ts",
      "vote/poll.service.ts",
      "admin/trust/moderation.service.ts",
    ]);
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const root = join(__dirname, "..", "..", "src");
    const writers = walk(root)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
      .filter((f) => !f.includes(`${join(root, "generated")}`))
      .filter((f) =>
        /\.question\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => f.slice(root.length + 1))
      .filter((f) => !COUNTER_ONLY.has(f));
    expect(writers.sort()).toEqual([
      "admin/overrides.service.ts",
      "admin/pool.service.ts",
      "admin/topics.service.ts",
      "feed/launch-question.ts",
      "feed/launch-shift.ts",
      "feed/seed.ts",
    ]);
    for (const f of writers)
      expect(readFileSync(join(root, f), "utf8")).toMatch(
        /invalidateUnreadableQuestions\(\)/,
      );
  });
});
