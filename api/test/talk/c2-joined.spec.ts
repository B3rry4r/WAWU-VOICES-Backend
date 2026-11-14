/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  guestAuth,
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { ChargeSweeperService } from "../../src/talk/charge-sweeper.service";
import { ReachService } from "../../src/reach/reach.service";
import { TokensService } from "../../src/units/units.tokens";

/**
 * BATCH-C2: both rules at once.
 *  - V-PRELAUNCH: before a question's window opens nothing on it can be read, played, counted or notified; a write
 *    before it answers 404 (V-27), a refused early write gives its try back.
 *  - V-HOTFIX-1: a post made without a name never gives its writer away through blocks; an expired retry record never
 *    lets a request run twice; the sweeper gives back a charge that paid for nothing.
 * Where the two meet: a nameless answer on a question that has not opened is unreadable for everyone (a stranger, the
 * person who blocked the writer and the person the writer blocked alike), and the instant it opens it is readable by all
 * three, whatever blocks exist. "Not yet open" is made by moving the question's window, the way the launch shift does.
 */
describe("batch C2: nothing before it opens, and no block names a nameless writer", () => {
  let h: Harness;
  let q: { id: string };
  let qNamed: { id: string };
  let w: Person; // writes the nameless answer
  let v: Person; // will block W
  let x: Person; // a stranger
  let bd: Person; // W will block them
  let rp: Person; // replies
  let anonId: string;
  let namedId: string;
  let voiceId: string;
  let clipId: string;
  let shareCode = "none";
  const word = `okapi${Date.now().toString(36).replace(/[0-9]/g, "q")}`;
  const replyText = `${word} reply text`;
  let hop = 0;
  const guest = guestAuth();
  const as = (p: Person | null) => ({
    ...(p ? { Authorization: p.auth } : guest),
    "X-Forwarded-For": `10.${(hop >> 16) & 255}.${(hop >> 8) & 255}.${++hop & 255}`,
  });

  const H = 3_600_000;
  const window = (id: string, state: "open" | "notYet" | "closed") =>
    h.prisma.question.update({
      where: { id },
      data:
        state === "open"
          ? {
              status: "LIVE",
              startsAt: new Date(Date.now() - H),
              endsAt: new Date(Date.now() + 24 * H),
            }
          : state === "notYet"
            ? {
                status: "SCHEDULED",
                startsAt: new Date(Date.now() + 2 * H),
                endsAt: new Date(Date.now() + 26 * H),
              }
            : {
                status: "LIVE",
                startsAt: new Date(Date.now() - 48 * H),
                endsAt: new Date(Date.now() - H),
              },
    });

  const put = (by: Person, t: Person) =>
    h
      .http()
      .put(`/api/v1/me/blocks/${t.id}`)
      .set("Authorization", by.auth)
      .expect(204);
  const del = (by: Person, t: Person) =>
    h
      .http()
      .delete(`/api/v1/me/blocks/${t.id}`)
      .set("Authorization", by.auth)
      .expect(204);

  const post = async (p: Person, qid: string, body: object) =>
    (
      await h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send(body)
        .expect(201)
    ).body.answer.id as string;

  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    qNamed = await makeQuestion(h);
    await window(q.id, "open");
    await window(qNamed.id, "open");
    w = await makePerson(h, { freePosts: 50 });
    v = await makePerson(h);
    x = await makePerson(h);
    bd = await makePerson(h);
    rp = await makePerson(h);
    anonId = await post(w, q.id, {
      kind: "TEXT",
      body: `${word} nameless thought`,
      anonymous: true,
    });
    namedId = await post(w, qNamed.id, { kind: "TEXT", body: "a named one" });
    await h
      .http()
      .post(`/api/v1/answers/${anonId}/replies`)
      .set("Authorization", rp.auth)
      .set(idem())
      .send({ kind: "TEXT", body: replyText, stance: "AGREE" })
      .expect(201);
    for (const p of [v, x]) {
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/save`)
        .set("Authorization", p.auth);
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/like`)
        .set("Authorization", p.auth);
    }
    // a nameless voice answer with a stored clip, to cover the clip routes
    const key = `voice/${randomUUID()}.m4a`;
    h.store.objects.set(key, Buffer.from("audio"));
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: w.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: key,
        playMime: "audio/mp4",
        maxDurationMs: 60000,
        durationMs: 9000,
      },
    });
    clipId = clip.id;
    voiceId = (
      await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: w.id,
          kind: "VOICE",
          clipId,
          anonymous: true,
        },
      })
    ).id;
    const link = await h
      .http()
      .post("/api/v1/share/links")
      .set("Authorization", v.auth)
      .send({ objectType: "ANSWER", objectId: anonId });
    shareCode = (link.body.code ?? "none") as string;
    await h.prisma.answer.updateMany({
      where: { id: { in: [anonId, namedId] } },
      data: { rankScore: 5 },
    });
  }, 120_000);
  afterAll(() => h.close());

  const routes = () => [
    "/api/v1/me/answers",
    "/api/v1/me/saved",
    `/api/v1/people/${rp.id}/replies`,
    `/api/v1/people/${rp.id}`,
    `/api/v1/people/${w.id}`,
    `/api/v1/people/${w.id}/replies`,
    "/api/v1/home",
    "/api/v1/questions/today",
    "/api/v1/questions",
    `/api/v1/questions/${q.id}`,
    "/api/v1/feed/trending",
    "/api/v1/feed/trending-questions",
    "/api/v1/feed/new",
    `/api/v1/questions/${q.id}/answers`,
    `/api/v1/questions/${q.id}/answers?sort=TOP`,
    `/api/v1/questions/${q.id}/answers?sort=DEBATED`,
    `/api/v1/questions/${q.id}/answers?sort=NEW`,
    `/api/v1/questions/${q.id}/moods`,
    `/api/v1/questions/${q.id}/polls`,
    `/api/v1/questions/${q.id}/what-next`,
    `/api/v1/answers/${anonId}/where-you-sit`,
    `/api/v1/answers/${anonId}`,
    `/api/v1/answers/${anonId}/card`,
    `/api/v1/answers/${anonId}/videos`,
    `/api/v1/answers/${anonId}/replies`,
    `/api/v1/answers/${anonId}/replies?stance=AGREE`,
    `/api/v1/answers/${voiceId}`,
    `/api/v1/voice-clips/${clipId}`,
    `/api/v1/voice-clips/${clipId}/play`,
    "/api/v1/news",
    `/api/v1/news/${anonId}`,
    `/api/v1/search?q=${word}`,
    `/api/v1/search?q=${word}&type=answers`,
    "/api/v1/notifications",
    "/api/v1/notifications/unread-count",
    `/api/v1/share/${shareCode}`,
    "/api/v1/me/friends",
    "/api/v1/me/invite",
    "/api/v1/me",
    "/api/v1/weekly-reports/latest",
  ];
  const strip = (text: string) =>
    text
      .replace(/"requestId":"[^"]*"/g, '"requestId":"-"')
      .replace(/"(serverTime|now|generatedAt|expiresAt)":"[^"]*"/g, '"$1":"-"')
      .replace(/"nextCursor":"[^"]*"/g, '"nextCursor":"<cursor>"')
      // signed addresses carry a clock reading
      .replace(/sig=[a-z]+/g, "sig=-");
  /** Drop every object that belongs to the named answer (and its question): a named post follows blocks, so only the nameless one is compared. */
  const refersNamed = (i: unknown): boolean => {
    const s = JSON.stringify(i);
    return !!s && (s.includes(namedId) || s.includes(qNamed.id));
  };
  /** The shared test database holds other specs' posts, and a global list refills its page when a named post leaves it; only what refers to this spec's own rows is compared. */
  const mine = (i: unknown): boolean => {
    const s = JSON.stringify(i);
    return [anonId, voiceId, clipId, q.id, w.id, v.id, x.id, bd.id, rp.id].some(
      (id) => s.includes(id),
    );
  };
  const dropNamed = (v: unknown): unknown => {
    if (Array.isArray(v))
      return v
        .filter(
          (i) =>
            !refersNamed(i) && (typeof i !== "object" || i === null || mine(i)),
        )
        .map((i) => dropNamed(i));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, dropNamed(val)]),
      );
    return v;
  };
  const get = async (viewer: Person | null, url: string) => {
    const res = await h.http().get(url).set(as(viewer));
    let body: unknown = null;
    try {
      body = JSON.parse(strip(JSON.stringify(res.body)));
    } catch {
      body = null;
    }
    return { status: res.status, body: dropNamed(body) };
  };
  const viewers = () =>
    [
      ["W (writer)", w],
      ["V (will block W)", v],
      ["X (stranger)", x],
      ["Bd (W blocks them)", bd],
      ["RP (replier)", rp],
      ["guest", null],
    ] as const;
  const snapshot = async () => {
    const all: Record<string, Record<string, unknown>> = {};
    for (const [name, p] of viewers()) {
      const one: Record<string, unknown> = {};
      for (const u of routes()) one[u] = await get(p, u);
      all[name] = one;
    }
    return all;
  };
  /** Block states, both directions, and between the writer and every kind of viewer. */
  const states = (): [string, [Person, Person][]][] => [
    ["V blocks W", [[v, w]]],
    ["W blocks V", [[w, v]]],
    ["W blocks Bd", [[w, bd]]],
    ["Bd blocks W", [[bd, w]]],
    [
      "X blocks W and W blocks X",
      [
        [x, w],
        [w, x],
      ],
    ],
    [
      "every pair, both ways",
      [
        [v, w],
        [w, v],
        [bd, w],
        [w, bd],
        [x, w],
        [w, x],
      ],
    ],
  ];
  const underStates = async (check: (name: string) => Promise<void>) => {
    for (const [name, pairs] of states()) {
      for (const [by, t] of pairs) await put(by, t);
      await check(name);
      for (const [by, t] of pairs) await del(by, t);
    }
    await check("cleared");
  };

  // everything about the nameless post that must not appear before it opens
  const secrets = () => [anonId, voiceId, clipId, word, replyText];
  const leaks = (snap: Record<string, Record<string, unknown>>) => {
    const found: string[] = [];
    for (const [name, byUrl] of Object.entries(snap))
      for (const [u, res] of Object.entries(byUrl)) {
        const s = JSON.stringify(res);
        for (const secret of secrets())
          // the id and the word are in the URL the viewer asked for; look at what came back
          if (
            s.includes(secret) &&
            // the owner of a recording may always read their own clip (V-PRELAUNCH round 1, clips.service visible())
            !(name.startsWith("W") && u.includes("/voice-clips/"))
          )
            found.push(`${name} ${u} -> ${secret}`);
      }
    return found;
  };

  it("not yet open: the nameless answer and everything on it are unreadable by a stranger, a blocker and a blocked person alike; open: readable by all three", async () => {
    await window(q.id, "notYet");
    for (const [name, p] of [
      ["stranger", x],
      ["blocker", v],
      ["blocked", bd],
    ] as const) {
      // the three, with the blocks the names say
      if (name === "blocker") await put(v, w);
      if (name === "blocked") await put(w, bd);
      for (const u of [
        `/api/v1/answers/${anonId}`,
        `/api/v1/answers/${anonId}/replies`,
        `/api/v1/answers/${voiceId}`,
        `/api/v1/voice-clips/${clipId}`,
        `/api/v1/voice-clips/${clipId}/play`,
        `/api/v1/news/${anonId}`,
        `/api/v1/share/${shareCode}`,
      ]) {
        const res = await get(p, u);
        expect({ name, u, status: res.status }).toEqual({
          name,
          u,
          status: 404,
        });
      }
      for (const u of [
        `/api/v1/questions/${q.id}/answers`,
        "/api/v1/feed/trending",
        "/api/v1/news",
        `/api/v1/search?q=${word}&type=answers`,
        "/api/v1/me/saved",
        `/api/v1/people/${rp.id}/replies`,
      ]) {
        const s = JSON.stringify((await get(p, u)).body);
        for (const secret of secrets())
          expect({ name, u, leaks: s.includes(secret) }).toEqual({
            name,
            u,
            leaks: false,
          });
      }
      if (name === "blocker") await del(v, w);
      if (name === "blocked") await del(w, bd);
    }
    // the instant it opens: all three read it, with and without their blocks
    await window(q.id, "open");
    await put(v, w);
    await put(w, bd);
    for (const p of [x, v, bd]) {
      expect((await get(p, `/api/v1/answers/${anonId}`)).status).toBe(200);
      expect(
        JSON.stringify(
          (await get(p, `/api/v1/questions/${q.id}/answers`)).body,
        ),
      ).toContain(anonId);
      expect(
        JSON.stringify(
          (await get(p, `/api/v1/search?q=${word}&type=answers`)).body,
        ),
      ).toContain(anonId);
      expect(
        (await get(p, `/api/v1/answers/${anonId}/replies`)).body,
      ).toBeTruthy();
      expect((await get(p, `/api/v1/voice-clips/${clipId}/play`)).status).toBe(
        200,
      );
    }
    await del(v, w);
    await del(w, bd);
    // a named post by the same writer still follows the blocks, open or not
    await put(v, w);
    expect((await get(v, `/api/v1/answers/${namedId}`)).status).toBe(404);
    expect((await get(x, `/api/v1/answers/${namedId}`)).status).toBe(200);
    await window(qNamed.id, "notYet");
    expect((await get(x, `/api/v1/answers/${namedId}`)).status).toBe(404);
    await window(qNamed.id, "open");
    await del(v, w);
  }, 120_000);

  it("the crawl, run twice: question not yet open (nothing leaks, no block moves anything), then open (a block moves nothing about the nameless post)", async () => {
    // 1. not yet open
    await window(q.id, "notYet");
    const baseClosed = await snapshot();
    expect(leaks(baseClosed)).toEqual([]);
    await underStates(async (state) => {
      const now = await snapshot();
      expect({ state, leaks: leaks(now) }).toEqual({ state, leaks: [] });
      for (const name of Object.keys(baseClosed))
        for (const u of Object.keys(baseClosed[name])) {
          if (u.includes("/me/blocks")) continue;
          // a person's own page is about the person: blocking changes whether a blocked pair sees it, never what posts it holds
          if (
            u === `/api/v1/people/${w.id}` ||
            u === `/api/v1/people/${w.id}/replies`
          ) {
            expect(JSON.stringify(now[name][u])).not.toContain(anonId);
            continue;
          }
          expect({ state, name, u, got: now[name][u] }).toEqual({
            state,
            name,
            u,
            got: baseClosed[name][u],
          });
        }
    });
    // 2. open
    await window(q.id, "open");
    const baseOpen = await snapshot();
    expect(
      JSON.stringify(
        baseOpen["V (will block W)"][`/api/v1/questions/${q.id}/answers`],
      ),
    ).toContain(anonId);
    expect(
      JSON.stringify(baseOpen["X (stranger)"]["/api/v1/feed/trending"]),
    ).toContain(anonId);
    expect(
      JSON.stringify(baseOpen["X (stranger)"]["/api/v1/me/saved"]),
    ).toContain(anonId);
    await underStates(async (state) => {
      const now = await snapshot();
      for (const name of Object.keys(baseOpen))
        for (const u of Object.keys(baseOpen[name])) {
          if (u.includes("/me/blocks")) continue;
          // a person's own page and their replies list follow blocks as on main (named person, named replies), but
          // must never carry the nameless post whichever way
          if (
            u === `/api/v1/people/${w.id}` ||
            u === `/api/v1/people/${w.id}/replies`
          ) {
            expect(JSON.stringify(now[name][u])).not.toContain(anonId);
            continue;
          }
          expect({ state, name, u, got: now[name][u] }).toEqual({
            state,
            name,
            u,
            got: baseOpen[name][u],
          });
        }
    });
  }, 900_000);

  it("a notice for a reply by a blocked person on a question that has not opened is not served; once open it is, by the same rule as before", async () => {
    const qn = await makeQuestion(h);
    await window(qn.id, "open");
    const a = await post(w, qn.id, {
      kind: "TEXT",
      body: "nameless, for the notice",
      anonymous: true,
    });
    await h
      .http()
      .post(`/api/v1/answers/${a}/replies`)
      .set("Authorization", bd.auth)
      .set(idem())
      .send({
        kind: "TEXT",
        body: "a reply by someone W will block",
        stance: "AGREE",
      })
      .expect(201);
    // the notice the reply made (sent while W had not blocked them yet), and now W blocks the replier
    await put(w, bd);
    const mine = async () =>
      (await h.http().get("/api/v1/notifications").set(as(w)).expect(200)).body
        .items as any[];
    const unread = async () =>
      (
        await h
          .http()
          .get("/api/v1/notifications/unread-count")
          .set(as(w))
          .expect(200)
      ).body.unread ??
      (await h.http().get("/api/v1/notifications/unread-count").set(as(w))).body
        .count;
    const about = (items: any[]) => items.filter((i) => i.targetId === a);
    const open = about(await mine());
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Someone replied to your voice"); // a blocked replier is not named, the notice stays
    const unreadOpen = await unread();
    await window(qn.id, "notYet");
    expect(about(await mine())).toHaveLength(0);
    expect(await unread()).toBe(unreadOpen - 1);
    // and the blocker's direction: W is blocked by the replier
    await del(w, bd);
    await put(bd, w);
    expect(about(await mine())).toHaveLength(0);
    await window(qn.id, "open");
    const back = about(await mine());
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe("Someone replied to your voice");
    expect(await unread()).toBe(unreadOpen);
    await del(bd, w);
    // a reply made by W's blocked person after the block sends W no notice at all (hotfix r3)
    await put(w, bd);
    const before = (await mine()).length;
    await h
      .http()
      .post(`/api/v1/answers/${a}/replies`)
      .set("Authorization", bd.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "another one", stance: "DISAGREE" })
      .expect(201);
    expect((await mine()).length).toBe(before);
    await del(w, bd);
    // a notice written straight to the writer about this nameless answer is also held back before it opens
    await h.app.get(ReachService).notifySafe({
      userId: w.id,
      type: "REPLY",
      title: "x replied to your voice",
      body: "hi",
      targetType: "answer",
      targetId: a,
      dedupeKey: `reply:${randomUUID()}`,
    });
    await window(qn.id, "notYet");
    expect(about(await mine())).toHaveLength(0);
    await window(qn.id, "open");
  }, 120_000);

  it("the idempotent replay of a post on a question that has since closed: the record expired, nothing runs twice", async () => {
    const qc = await makeQuestion(h);
    await window(qc.id, "open");
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const body = { kind: "TEXT", body: "a paid post", anonymous: true };
    const first = await h
      .http()
      .post(`/api/v1/questions/${qc.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const balance = async () =>
      (await h.prisma.wallet.findUniqueOrThrow({ where: { userId: p.id } }))
        .balanceMilli;
    const after = await balance();
    expect(after).toBeLessThan(500_000);
    const counts = async () => ({
      answers: await h.prisma.answer.count({ where: { authorId: p.id } }),
      charges: await h.prisma.charge.count({ where: { userId: p.id } }),
      reversals: await h.prisma.ledgerTransaction.count({
        where: {
          kind: "REVERSAL",
          chargeId: {
            in: (
              await h.prisma.charge.findMany({
                where: { userId: p.id },
                select: { id: true },
              })
            ).map((c) => c.id),
          },
        },
      }),
    });
    const base = await counts();
    expect(base).toEqual({ answers: 1, charges: 1, reversals: 0 });
    await h.prisma.idempotencyRecord.updateMany({
      where: { actorId: p.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // the question closes, then the same key is sent again
    await window(qc.id, "closed");
    const replay = await h
      .http()
      .post(`/api/v1/questions/${qc.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body);
    expect(replay.status).toBe(409);
    expect(replay.body.code ?? replay.body.error?.code).toBe("QUESTION_CLOSED");
    expect(await counts()).toEqual(base);
    expect(await balance()).toBe(after);
    // and the same after the question is moved back before its start
    await window(qc.id, "notYet");
    const early = await h
      .http()
      .post(`/api/v1/questions/${qc.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body);
    expect(early.status).toBe(404);
    expect(await counts()).toEqual(base);
    expect(await balance()).toBe(after);
    // the stored post is the one the first request made, and it is not readable while the question has not opened
    expect(
      (await get(x, `/api/v1/answers/${first.body.answer.id}`)).status,
    ).toBe(404);
    await window(qc.id, "open");
    expect(
      (await get(x, `/api/v1/answers/${first.body.answer.id}`)).status,
    ).toBe(200);
  }, 60_000);

  it("a refused early write gives its try back, does not keep its retry key, and is not a charge", async () => {
    const qe = await makeQuestion(h);
    await window(qe.id, "notYet");
    const p = await makePerson(h, { freePosts: 5 });
    // C22 (fixture): the try is given back only for the 409, so the question is shown as coming up (a live override).
    const ov = await h.prisma.override.create({
      data: {
        questionId: qe.id,
        contentKind: "TEXT",
        body: "x",
        startsAt: new Date(Date.now() - H),
        endsAt: new Date(Date.now() + 24 * H),
        status: "SCHEDULED",
        createdById: p.id,
      },
    });
    const key = randomUUID();
    const send = (k: string) =>
      h
        .http()
        .post(`/api/v1/questions/${qe.id}/answers`)
        .set("Authorization", p.auth)
        .set("Idempotency-Key", k)
        .send({ kind: "TEXT", body: "too early" });
    try {
      expect((await send(key)).status).toBe(409);
      // 30 refused tries never reach the 20 per 10 minutes
      for (let i = 0; i < 30; i++)
        expect((await send(randomUUID())).status).toBe(409);
      expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(0);
      await window(qe.id, "open");
      // the same key that was refused early is a fresh request now
      expect((await send(key)).status).toBe(201);
      expect((await send(randomUUID())).status).toBe(201);
    } finally {
      await h.prisma.override.delete({ where: { id: ov.id } });
    }
  }, 60_000);

  it("the sweeper leaves a charge whose post exists, and reverses one whose write was refused as not open: the try and the token come back, once", async () => {
    const sweeper = h.app.get(ChargeSweeperService);
    // BATCH-C2 round 3 (fixture only): the sweeper reads charges made after its start time and older than 30 minutes.
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    const qs = await makeQuestion(h);
    await window(qs.id, "open");
    const age = (p: Person, minutes: number) =>
      h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { createdAt: new Date(Date.now() - minutes * 60_000) },
      });
    const send = (p: Person, key: string, body: object) =>
      h
        .http()
        .post(`/api/v1/questions/${qs.id}/answers`)
        .set("Authorization", p.auth)
        .set("Idempotency-Key", key)
        .send(body);
    // A: the post exists: left alone
    const a = await makePerson(h, { freePosts: 3 });
    await send(a, randomUUID(), { kind: "TEXT", body: "kept" }).expect(201);
    await age(a, 31);
    await sweeper.sweep();
    expect(
      (await h.prisma.charge.findFirstOrThrow({ where: { userId: a.id } }))
        .status,
    ).toBe("COMMITTED");
    // B: the request died after the charge; the same key is sent again once the question has not opened (refused 404)
    const b = await makePerson(h, { freePosts: 3, balanceMilli: 400_000 });
    const key = randomUUID();
    const first = await send(b, key, { kind: "TEXT", body: "lost" }).expect(
      201,
    );
    await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
    await h.prisma.idempotencyRecord.deleteMany({
      where: { actorId: b.id, key },
    });
    await h.prisma.charge.updateMany({
      where: { userId: b.id },
      data: { refType: "answer", refId: null },
    });
    const allowance = async () =>
      (
        await h.prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: b.id },
        })
      ).freePostsRemaining;
    const spent = await allowance();
    await window(qs.id, "notYet");
    expect((await send(b, key, { kind: "TEXT", body: "lost" })).status).toBe(
      404,
    );
    // the refused replay neither reversed the charge nor wrote a post
    expect(
      (await h.prisma.charge.findFirstOrThrow({ where: { userId: b.id } }))
        .status,
    ).toBe("COMMITTED");
    await age(b, 31);
    await age(a, 31);
    await sweeper.sweep();
    const reversed = await h.prisma.charge.findFirstOrThrow({
      where: { userId: b.id },
    });
    expect(reversed.status).toBe("REVERSED");
    expect(await allowance()).toBe(spent + 1); // the free try is back, once
    await sweeper.sweep();
    expect(await allowance()).toBe(spent + 1);
    expect(
      await h.prisma.charge.count({
        where: { userId: b.id, status: "REVERSED" },
      }),
    ).toBe(1);
    // D: paid with money, same story: the balance comes back, one reversal, a second pass changes nothing
    const d = await makePerson(h, { freePosts: 0, balanceMilli: 400_000 });
    await window(qs.id, "open");
    const dkey = randomUUID();
    const firstD = await send(d, dkey, {
      kind: "TEXT",
      body: "paid, then lost",
    }).expect(201);
    const paid = async () =>
      (await h.prisma.wallet.findUniqueOrThrow({ where: { userId: d.id } }))
        .balanceMilli;
    expect(await paid()).toBeLessThan(400_000);
    await h.prisma.answer.deleteMany({ where: { id: firstD.body.answer.id } });
    await h.prisma.idempotencyRecord.deleteMany({
      where: { actorId: d.id, key: dkey },
    });
    await h.prisma.charge.updateMany({
      where: { userId: d.id },
      data: { refType: "answer", refId: null },
    });
    await window(qs.id, "notYet");
    expect(
      (await send(d, dkey, { kind: "TEXT", body: "paid, then lost" })).status,
    ).toBe(404);
    await age(d, 31);
    await sweeper.sweep();
    await sweeper.sweep();
    expect(await paid()).toBe(400_000);
    const dc = await h.prisma.charge.findFirstOrThrow({
      where: { userId: d.id },
    });
    expect(dc.status).toBe("REVERSED");
    expect(
      await h.prisma.ledgerTransaction.count({
        where: { kind: "REVERSAL", chargeId: dc.id },
      }),
    ).toBe(1);
    // A is still untouched
    expect(
      (await h.prisma.charge.findFirstOrThrow({ where: { userId: a.id } }))
        .status,
    ).toBe("COMMITTED");
    // C: a voice post paid by an extra voice token; the request died before the token was used, and the retry is refused
    const c = await makePerson(h, { freePosts: 0, balanceMilli: 400_000 });
    await window(qs.id, "open");
    const pay = await h.prisma.payment.create({
      data: {
        userId: c.id,
        kind: "EXTRA_VOICE",
        tokenKind: "SECONDS_30",
        amountKobo: 15000,
        status: "SUCCEEDED",
        txRef: "voices-" + randomUUID(),
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 1e6),
      },
    });
    const token = await h.prisma.extraVoiceToken.create({
      data: {
        userId: c.id,
        paymentId: pay.id,
        kind: "SECONDS_30",
        maxSeconds: 30,
      },
    });
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: c.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        playMime: "audio/mp4",
        maxDurationMs: 30000,
        durationMs: 20000,
        extraTokenId: token.id,
      },
    });
    await h.prisma.extraVoiceToken.update({
      where: { id: token.id },
      data: {
        status: "RESERVED",
        usedOnClipId: clip.id,
        reservedAt: new Date(),
      },
    });
    const ckey = randomUUID();
    const firstC = await send(c, ckey, {
      kind: "VOICE",
      clipId: clip.id,
    }).expect(201);
    expect(
      (
        await h.prisma.extraVoiceToken.findUniqueOrThrow({
          where: { id: token.id },
        })
      ).status,
    ).toBe("USED");
    // the request that "died": no post, no record, no link, the token still only held
    await h.prisma.answer.deleteMany({ where: { id: firstC.body.answer.id } });
    await h.prisma.idempotencyRecord.deleteMany({
      where: { actorId: c.id, key: ckey },
    });
    await h.prisma.charge.updateMany({
      where: { userId: c.id },
      data: { refType: "answer", refId: null },
    });
    await h.prisma.extraVoiceToken.update({
      where: { id: token.id },
      data: { status: "RESERVED", usedAt: null },
    });
    await window(qs.id, "notYet");
    expect(
      (await send(c, ckey, { kind: "VOICE", clipId: clip.id })).status,
    ).toBe(404);
    await age(c, 31);
    await sweeper.sweep();
    expect(
      (await h.prisma.charge.findFirstOrThrow({ where: { userId: c.id } }))
        .status,
    ).toBe("REVERSED");
    // the token was never used up by the refused write; the stale-hold job gives it back, once
    const tokens = h.app.get(TokensService);
    await tokens.releaseStale(new Date(Date.now() + 7 * 86_400_000));
    expect(
      (
        await h.prisma.extraVoiceToken.findUniqueOrThrow({
          where: { id: token.id },
        })
      ).status,
    ).toBe("AVAILABLE");
    await sweeper.sweep();
    expect(
      await h.prisma.charge.count({
        where: { userId: c.id, status: "REVERSED" },
      }),
    ).toBe(1);
  }, 60_000);
});
