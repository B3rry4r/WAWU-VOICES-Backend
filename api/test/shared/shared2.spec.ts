/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { MEDIA_STORE, TRANSCRIBER } from "../../src/media/object-store";
import { FLW_CLIENT } from "../../src/units/flutterwave.client";
import { UnitsConfig } from "../../src/units/units.config";
import {
  WeeklyDraftService,
  WEEKLY_DRAFTER,
} from "../../src/reach/weekly-draft";
import type { DraftInput, WeeklyDrafter } from "../../src/reach/weekly-draft";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { FakeFlutterwave } from "../units/helpers";
import {
  MemoryStore,
  idem,
  makePerson,
  makeQuestion,
  type Harness,
  type Person,
} from "../talk/harness";

/** A slow checkout, so parallel requests really overlap. A stand-in for Flutterwave: nothing here calls it. */
class SlowFlutterwave extends FakeFlutterwave {
  override async initCheckout(
    req: Parameters<FakeFlutterwave["initCheckout"]>[0],
  ) {
    await new Promise((r) => setTimeout(r, 150));
    return super.initCheckout(req);
  }
}

/** A local stand-in for Gemini: records what it was given, answers from a script. Gemini is never called. */
class FakeDrafter implements WeeklyDrafter {
  calls: DraftInput[] = [];
  draft(input: DraftInput) {
    this.calls.push(input);
    return Promise.resolve({
      headline: "Prices lead the week",
      mood: "Tired, still talking.",
      summary: "Most voices pointed at prices. Some pointed at pay.",
      themes: [
        {
          label: "Prices rise faster than pay",
          complaints: ["Food costs"],
          voices: [1, 2, 3],
        },
        { label: "One lone view", complaints: [], voices: [1] },
      ],
    });
  }
}

describe("SHARED-2: API gaps", () => {
  let h: Harness;
  let flw: SlowFlutterwave;
  let drafter: FakeDrafter;
  let store: MemoryStore;
  let prisma: PrismaService;
  let jwks: TestJwks;
  let http: () => ReturnType<typeof request>;
  let close: () => Promise<void>;
  let app: import("@nestjs/common").INestApplication;

  beforeAll(async () => {
    jwks = new TestJwks();
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    process.env.THROTTLE_LIMIT = "1000000";
    process.env.ME_SIGNUP_LIMIT = "100000";
    process.env.MEDIA_WORKER = "off";
    process.env.DMS_LIVE = "on"; // the table below walks every write route in the contract, the /dm ones included (the app's own default is off)
    process.env.APP_BASE_URL = "https://voices.test";
    const { AppModule } = await import("../../src/app.module.js");
    const { configureApp } = await import("../../src/app-config.js");
    store = new MemoryStore();
    flw = new SlowFlutterwave();
    drafter = new FakeDrafter();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORE)
      .useValue(store)
      .overrideProvider(TRANSCRIBER)
      .useValue(null)
      .overrideProvider(FLW_CLIENT)
      .useValue(flw)
      .overrideProvider(WEEKLY_DRAFTER)
      .useValue(null)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = () => request(app.getHttpServer() as App);
    close = async () => {
      await app.close();
      await jwks.stop();
    };
    h = { app, jwks, prisma, store, http, close } as unknown as Harness;
    await prisma.$executeRawUnsafe(
      `TRUNCATE "User","LedgerTransaction","UnitTier","ConfigEntry","Notification","Payment","Charge","Wallet","FreeAllowance","UsageCounter","ExtraVoiceToken","Topic","Question","IdempotencyRecord","StoredFile","ConfigChange","WeeklyReport" CASCADE`,
    );
    await app.get(UnitsConfig).seedDefaults();
  });
  afterAll(async () => {
    // Leave no config rows behind: the admin config list seeds every default, and other suites read the code defaults.
    await prisma.$executeRawUnsafe(
      `TRUNCATE "ConfigEntry","ConfigChange" CASCADE`,
    );
    await close();
  });

  const get = (path: string, p?: Person) => {
    const r = http().get(`/api/v1${path}`);
    return p ? r.set("Authorization", p.auth) : r;
  };
  const handleOf = async (p: Person) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: p.id } })).handle;

  // ------------------------------------------------------------------ 1
  describe("item 1: avatar upload confirmation", () => {
    it("PUT, complete, then PATCH /me/profile accepts avatarFileId", async () => {
      const me = await makePerson(h);
      const up = await http()
        .post("/api/v1/uploads")
        .set("Authorization", me.auth)
        .send({ kind: "AVATAR", mime: "image/png", sizeBytes: 1200 })
        .expect(201);
      const id = up.body.fileId as string;
      const patch = (fileId: string | null) =>
        http()
          .patch("/api/v1/me/profile")
          .set("Authorization", me.auth)
          .send({ avatarFileId: fileId });
      // Not confirmed yet: refused.
      expect((await patch(id)).status).toBe(422);
      // Not received yet: 409 UPLOAD_NOT_RECEIVED, and still unconfirmed.
      const early = await http()
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", me.auth)
        .expect(409);
      expect(early.body.error.code).toBe("UPLOAD_NOT_RECEIVED");
      const file = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
      expect(file.confirmedAt).toBeNull();
      // The wrong size is refused and never confirmed.
      store.objects.set(file.key, Buffer.alloc(900));
      await http()
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", me.auth)
        .expect(422);
      expect(
        (await prisma.storedFile.findUniqueOrThrow({ where: { id } }))
          .confirmedAt,
      ).toBeNull();
      // 401 without a token; 404 for someone else's file and for an unknown id.
      await http().post(`/api/v1/uploads/${id}/complete`).expect(401);
      const other = await makePerson(h);
      await http()
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", other.auth)
        .expect(404);
      await http()
        .post(`/api/v1/uploads/${randomUUID()}/complete`)
        .set("Authorization", me.auth)
        .expect(404);
      // The right size: confirmed, and a repeat answers the same.
      store.objects.set(file.key, Buffer.alloc(1200));
      const done = await http()
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", me.auth)
        .expect(200);
      expect(done.body).toMatchObject({ fileId: id, kind: "AVATAR" });
      const row = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
      expect(row.confirmedAt?.toISOString()).toBe(done.body.confirmedAt);
      const again = await http()
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", me.auth)
        .expect(200);
      expect(again.body.confirmedAt).toBe(done.body.confirmedAt);
      // Someone else cannot use my file; I can.
      expect(
        (
          await http()
            .patch("/api/v1/me/profile")
            .set("Authorization", other.auth)
            .send({ avatarFileId: id })
        ).status,
      ).toBe(422);
      expect((await patch(id)).status).toBe(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: me.id } }))
          .avatarFileId,
      ).toBe(id);
    });
  });

  // ------------------------------------------------------------------ 2
  describe("item 2: GET /people/by-handle/{handle}", () => {
    it("is the same answer as /people/{id}, matches without case, and 404s like it", async () => {
      const a = await makePerson(h);
      const viewer = await makePerson(h);
      const handle = await handleOf(a);
      const byId = await get(`/people/${a.id}`).expect(200);
      const byHandle = await get(`/people/by-handle/${handle}`).expect(200);
      expect(byHandle.body).toEqual(byId.body);
      const upper = await get(
        `/people/by-handle/${handle.toUpperCase()}`,
      ).expect(200);
      expect(upper.body).toEqual(byId.body);
      expect(
        (await get(`/people/by-handle/@${handle}`).expect(200)).body.profile.id,
      ).toBe(a.id);
      await get("/people/by-handle/nobody.here.x").expect(404);
      await get("/people/by-handle/!!").expect(404);
      await get(`/people/by-handle/${handle}`, viewer).expect(200);
      await get(`/people/by-handle/${handle}`)
        .set("Authorization", "Bearer bad.token.x")
        .expect(401);
      // A suspended-out (deleted) person is a 404 by handle too.
      const gone = await makePerson(h);
      const gh = await handleOf(gone);
      await prisma.user.update({
        where: { id: gone.id },
        data: { status: "DELETED" },
      });
      await get(`/people/by-handle/${gh}`).expect(404);
      await get(`/people/${gone.id}`).expect(404);
    });

    it("blocks apply: the blocker sees the minimal page, the blocked person gets 404", async () => {
      const blocker = await makePerson(h);
      const blocked = await makePerson(h);
      await http()
        .put(`/api/v1/me/blocks/${blocked.id}`)
        .set("Authorization", blocker.auth)
        .expect(204);
      const bh = await handleOf(blocked);
      const kh = await handleOf(blocker);
      const mine = await get(`/people/by-handle/${bh}`, blocker).expect(200);
      expect(mine.body.isBlockedByMe).toBe(true);
      expect(mine.body.recentAnswers).toEqual([]);
      expect(mine.body).toEqual(
        (await get(`/people/${blocked.id}`, blocker)).body,
      );
      await get(`/people/by-handle/${kh}`, blocked).expect(404);
    });
  });

  // ------------------------------------------------------------------ 3
  describe("item 3: one Idempotency-Key, many parallel callers", () => {
    const N = 30;

    it("POST /payments: every caller gets the first payment, never a 409, one row", async () => {
      const p = await makePerson(h);
      const tier = await prisma.unitTier.findFirstOrThrow({
        where: { active: true },
      });
      const key = randomUUID();
      flw.inits = [];
      const res = await Promise.all(
        Array.from({ length: N }, () =>
          http()
            .post("/api/v1/payments")
            .set("Authorization", p.auth)
            .set("Idempotency-Key", key)
            .send({ kind: "UNITS", tierId: tier.id }),
        ),
      );
      expect(res.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      const ids = new Set(res.map((r) => r.body.paymentId));
      expect(ids.size).toBe(1);
      expect(new Set(res.map((r) => r.body.checkoutUrl)).size).toBe(1);
      const rows = await prisma.payment.findMany({ where: { userId: p.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe([...ids][0]);
      expect(rows[0].idempotencyKey).toBe(key);
      expect(flw.inits).toHaveLength(1);
      // Another body with the same key is still refused.
      const bad = await http()
        .post("/api/v1/payments")
        .set("Authorization", p.auth)
        .set("Idempotency-Key", key)
        .send({ kind: "EXTRA_VOICE", tokenKind: "SECONDS_30" })
        .expect(409);
      expect(bad.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("POST /questions/{id}/answers (charge-backed): one answer, one charge, every caller gets it", async () => {
      const p = await makePerson(h, { freePosts: 5 });
      const q = await makeQuestion(h);
      const key = randomUUID();
      const res = await Promise.all(
        Array.from({ length: 20 }, () =>
          http()
            .post(`/api/v1/questions/${q.id}/answers`)
            .set("Authorization", p.auth)
            .set("Idempotency-Key", key)
            .send({ kind: "TEXT", body: "One voice, many taps." }),
        ),
      );
      expect(res.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      expect(new Set(res.map((r) => r.body.answer.id)).size).toBe(1);
      expect(await prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
      expect(await prisma.charge.count({ where: { userId: p.id } })).toBe(1);
      expect(
        (
          await prisma.freeAllowance.findUniqueOrThrow({
            where: { userId: p.id },
          })
        ).freePostsRemaining,
      ).toBe(4);
    });

    it("POST /admin/wallets/{id}/adjust: one adjustment, every caller gets the first answer", async () => {
      const admin = await makePerson(h, { roles: ["ADMIN"] });
      const target = await makePerson(h, { balanceMilli: 1000 });
      const key = randomUUID();
      const res = await Promise.all(
        Array.from({ length: N }, () =>
          http()
            .post(`/api/v1/admin/wallets/${target.id}/adjust`)
            .set("Authorization", admin.auth)
            .set("Idempotency-Key", key)
            .send({ deltaMilli: 500, reason: "goodwill" }),
        ),
      );
      expect(res.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      expect(
        (
          await prisma.wallet.findUniqueOrThrow({
            where: { userId: target.id },
          })
        ).balanceMilli,
      ).toBe(1500);
      expect(
        await prisma.ledgerTransaction.count({
          where: { idempotencyKey: `adjust:${target.id}:${key}` },
        }),
      ).toBe(1);
    });

    it("POST /polls/{id}/votes: one vote, every caller gets the first answer", async () => {
      const topic = await prisma.topic.create({
        data: {
          weekNumber: 91,
          title: "Vote race",
          startsOn: new Date("2026-12-01"),
          endsOn: new Date("2026-12-07"),
          status: "LIVE",
        },
      });
      const poll = await prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "Which?",
          status: "OPEN",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          options: {
            create: [
              { label: "A", sortOrder: 0 },
              { label: "B", sortOrder: 1 },
            ],
          },
        },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      const p = await makePerson(h);
      await prisma.user.update({
        where: { id: p.id },
        data: { phoneHash: `ph-${randomUUID()}` },
      });
      const key = randomUUID();
      const res = await Promise.all(
        Array.from({ length: N }, () =>
          http()
            .post(`/api/v1/polls/${poll.id}/votes`)
            .set("Authorization", p.auth)
            .set("Idempotency-Key", key)
            .send({ optionIds: [poll.options[0].id] }),
        ),
      );
      expect(res.map((r) => r.status).filter((s) => s >= 400)).toEqual([]);
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1);
      expect(
        await prisma.charge.count({ where: { userId: p.id, action: "VOTE" } }),
      ).toBe(1);
    });
  });

  // ------------------------------------------------------------------ 4
  describe("item 4: tag meanings are the board's words", () => {
    it("GET /news/tags", async () => {
      const res = await get("/news/tags").expect(200);
      const by = (t: string) =>
        res.body.items.find((i: { tag: string }) => i.tag === t).meaning;
      expect(by("VERIFIED_NEWS")).toBe(
        "Confirmed by WAWU’s editors against a named source. The source is linked.",
      );
      expect(by("UNVERIFIED_NEWS")).toBe(
        "A news claim WAWU has not confirmed. Treat it with care.",
      );
      expect(by("GOSSIP")).toBe(
        "Talk, rumour or opinion. Not presented as fact.",
      );
    });
  });

  // ------------------------------------------------------------------ 5
  describe("item 5: the weekly AI draft", () => {
    let week = 100;
    const draftSvc = () => app.get(WeeklyDraftService);
    const setDrafter = (d: WeeklyDrafter | null) => {
      (draftSvc() as unknown as { drafter: WeeklyDrafter | null }).drafter = d;
    };
    afterEach(() => setDrafter(null));

    /** A closed week: question, answers by four people (one voice answer in Pidgin), reactions, a weekly poll with votes. */
    async function closedWeek(closedMinutesAgo = 60) {
      week++;
      const topic = await prisma.topic.create({
        data: {
          weekNumber: week,
          title: `Week ${week}`,
          startsOn: new Date("2026-11-23"),
          endsOn: new Date("2026-11-29"),
          status: "LIVE",
        },
      });
      const question = await prisma.question.create({
        data: {
          topicId: topic.id,
          text: "How is the market?",
          status: "LIVE",
          slotIndex: 1,
        },
      });
      const people = [];
      for (let i = 0; i < 4; i++) people.push(await makePerson(h));
      const handles = await Promise.all(people.map(handleOf));
      const bodies = [
        `Prices are too high. Call me on 0803 123 4567 or @${handles[0]}`,
        "Pay does not move with prices.",
        "Fuel and transport eat the budget.",
      ];
      const answers = [];
      for (let i = 0; i < 3; i++)
        answers.push(
          await prisma.answer.create({
            data: {
              questionId: question.id,
              authorId: people[i].id,
              kind: "TEXT",
              body: bodies[i],
            },
          }),
        );
      const clip = await prisma.voiceClip.create({
        data: {
          ownerId: people[3].id,
          purpose: "ANSWER",
          status: "READY",
          rawKey: "raw/x",
          rawMime: "audio/webm",
          maxDurationMs: 10000,
          durationMs: 4000,
        },
      });
      await prisma.transcript.create({
        data: {
          clipId: clip.id,
          status: "READY",
          language: "pcm",
          text: "Market don dey hot",
        },
      });
      answers.push(
        await prisma.answer.create({
          data: {
            questionId: question.id,
            authorId: people[3].id,
            kind: "VOICE",
            clipId: clip.id,
          },
        }),
      );
      // Deleted and unpublished answers are not counted.
      await prisma.answer.create({
        data: {
          questionId: question.id,
          authorId: people[0].id,
          kind: "TEXT",
          body: "gone",
          status: "REMOVED",
        },
      });
      await prisma.reaction.createMany({
        data: [
          { answerId: answers[0].id, userId: people[1].id, kind: "SAD" },
          { answerId: answers[0].id, userId: people[2].id, kind: "SAD" },
          { answerId: answers[1].id, userId: people[0].id, kind: "EXACTLY" },
          { answerId: answers[1].id, userId: people[2].id, kind: "SAD" },
        ],
      });
      const poll = await prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "What first?",
          status: "CLOSED",
          startsAt: new Date(Date.now() - 7 * 86_400_000),
          endsAt: new Date(Date.now() - closedMinutesAgo * 60_000),
          options: {
            create: [
              { label: "A stable naira", sortOrder: 0 },
              { label: "Cheaper fuel", sortOrder: 1 },
            ],
          },
        },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      for (let i = 0; i < 4; i++)
        await prisma.vote.create({
          data: {
            pollId: poll.id,
            userId: people[i].id,
            phoneHash: `ph-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            choices: { create: [{ optionId: poll.options[i < 3 ? 0 : 1].id }] },
          },
        });
      return { topic, poll, people, handles, answers };
    }

    it("two closes in parallel make ONE draft; no key means empty text and real counts", async () => {
      setDrafter(null);
      const w = await closedWeek();
      const made = await Promise.all([
        draftSvc().draftDue(),
        draftSvc().draftDue(),
        draftSvc().draftDue(),
      ]);
      expect(made.reduce((a, b) => a + b, 0)).toBe(1);
      const reports = await prisma.weeklyReport.findMany({
        where: { topicId: w.topic.id },
      });
      expect(reports).toHaveLength(1);
      const r = reports[0];
      expect(r).toMatchObject({
        status: "DRAFT",
        headline: null,
        mood: null,
        summary: null,
        themes: null,
        basedOnVoices: 4,
        basedOnVotes: 4,
        languagesRead: ["Pidgin"],
        humanReviewed: false,
      });
      expect(r.pollSummary).toMatchObject({
        title: "What first?",
        totalVotes: 4,
        line: "75% A stable naira",
        options: [
          { label: "A stable naira", votes: 3, percent: 75 },
          { label: "Cheaper fuel", votes: 1, percent: 25 },
        ],
      });
      expect(r.sentiment).toMatchObject({
        reactionTotal: 4,
        reactions: [
          { kind: "SAD", count: 3, share: 75 },
          { kind: "EXACTLY", count: 1, share: 25 },
        ],
      });
      expect(
        await prisma.weeklyQuote.count({ where: { reportId: r.id } }),
      ).toBe(0);
      // Monday 18:00 Lagos (17:00 UTC), after the poll closed.
      expect(r.publishAt!.getUTCDay()).toBe(1);
      expect(r.publishAt!.getUTCHours()).toBe(17);
      expect(r.publishAt!.getUTCMinutes()).toBe(0);
      expect(r.publishAt!.getTime()).toBeGreaterThan(w.poll.endsAt.getTime());
      // A later run (a restart) makes nothing more.
      expect(await draftSvc().draftDue()).toBe(0);
      expect(
        await prisma.weeklyReport.count({ where: { topicId: w.topic.id } }),
      ).toBe(1);
      // The editor sees it: poll closed time, honest checks, no quotes.
      const ed = await makePerson(h, { roles: ["EDITOR"] });
      const view = await get(`/admin/weekly-reports/${r.id}`, ed).expect(200);
      expect(view.body.status).toBe("DRAFT");
      expect(view.body.pollClosedAt).toBe(w.poll.endsAt.toISOString());
      expect(view.body.languagesRead).toEqual(["Pidgin"]);
      const texts = view.body.checks.map((c: { text: string }) => c.text);
      expect(texts).toContain(
        "Quotes: none yet, a quote needs the speaker’s consent",
      );
      expect(texts).toContain("Languages read: Pidgin");
    });

    it("languages read also counts a spoken reply's transcript (WF-7)", async () => {
      setDrafter(null);
      const w = await closedWeek();
      const clip = await prisma.voiceClip.create({
        data: {
          ownerId: w.people[1].id,
          purpose: "REPLY",
          status: "READY",
          rawKey: "raw/r",
          rawMime: "audio/webm",
          maxDurationMs: 10000,
          durationMs: 4000,
        },
      });
      await prisma.transcript.create({
        data: {
          clipId: clip.id,
          status: "READY",
          language: "yo",
          text: "Mo gba",
        },
      });
      await prisma.reply.create({
        data: {
          answerId: w.answers[0].id,
          authorId: w.people[1].id,
          stance: "EXPERIENCE",
          kind: "VOICE",
          clipId: clip.id,
        },
      });
      await draftSvc().draftDue();
      const r = await prisma.weeklyReport.findUniqueOrThrow({
        where: { topicId: w.topic.id },
      });
      expect(r.languagesRead).toEqual(["Pidgin", "Yoruba"]);
    });

    it("waits for the poll window and the configured minutes", async () => {
      const open = await closedWeek(-60); // closes in an hour
      const fresh = await closedWeek(3); // closed 3 minutes ago, drafts after 10
      await draftSvc().draftDue();
      expect(
        await prisma.weeklyReport.count({
          where: { topicId: { in: [open.topic.id, fresh.topic.id] } },
        }),
      ).toBe(0);
      await draftSvc().draftDue(new Date(Date.now() + 8 * 60_000));
      expect(
        await prisma.weeklyReport.count({ where: { topicId: fresh.topic.id } }),
      ).toBe(1);
      expect(
        await prisma.weeklyReport.count({ where: { topicId: open.topic.id } }),
      ).toBe(0);
    });

    it("with a key: Gemini (a stand-in here) drafts the text once, from scrubbed voices; counts come from the voices cited; small groups are left out", async () => {
      await prisma.configEntry.upsert({
        where: { key: "weekly.min_group_size" },
        create: {
          key: "weekly.min_group_size",
          valueJson: 2,
          description: "x",
        } as never,
        update: { valueJson: 2 },
      });
      drafter.calls = [];
      setDrafter(drafter);
      const w = await closedWeek();
      const made = await Promise.all([
        draftSvc().draftDue(),
        draftSvc().draftDue(),
      ]);
      expect(made.reduce((a, b) => a + b, 0)).toBe(1);
      expect(drafter.calls).toHaveLength(1);
      const sent = JSON.stringify(drafter.calls[0]);
      expect(drafter.calls[0].voices).toHaveLength(4);
      expect(sent).not.toContain(`@${w.handles[0]}`);
      expect(sent).not.toContain("0803 123 4567");
      expect(sent).toContain("Market don dey hot");
      const r = await prisma.weeklyReport.findFirstOrThrow({
        where: { topicId: w.topic.id },
      });
      expect(r).toMatchObject({
        status: "DRAFT",
        headline: "Prices lead the week",
        mood: "Tired, still talking.",
        humanReviewed: false,
      });
      expect(r.themes).toEqual([
        {
          label: "Prices rise faster than pay",
          count: 3,
          complaints: ["Food costs"],
        },
      ]);
      await prisma.configEntry.update({
        where: { key: "weekly.min_group_size" },
        data: { valueJson: 20 },
      });
    });

    it("a failing drafter leaves the text empty and the counts in place", async () => {
      setDrafter({ draft: () => Promise.reject(new Error("gemini down")) });
      const w = await closedWeek();
      expect(await draftSvc().draftDue()).toBe(1);
      const r = await prisma.weeklyReport.findFirstOrThrow({
        where: { topicId: w.topic.id },
      });
      expect(r).toMatchObject({
        headline: null,
        summary: null,
        basedOnVoices: 4,
      });
    });

    it("a handle, a phone number or a name of someone who spoke in the summary fails the check and blocks approval", async () => {
      const w = await closedWeek();
      await draftSvc().draftDue();
      const r = await prisma.weeklyReport.findFirstOrThrow({
        where: { topicId: w.topic.id },
      });
      const ed = await makePerson(h, { roles: ["EDITOR"] });
      const edit = (summary: string) =>
        http()
          .patch(`/api/v1/admin/weekly-reports/${r.id}`)
          .set("Authorization", ed.auth)
          .send({ headline: "Prices", summary });
      const check = async () =>
        (await get(`/admin/weekly-reports/${r.id}`, ed)).body.checks[0] as {
          text: string;
          ok: boolean;
        };
      expect(
        (await edit("Most voices pointed at prices.").expect(200)).body
          .checks[0].ok,
      ).toBe(true);
      expect(
        (await edit("As @somebody.else said, prices.").expect(200)).body
          .checks[0].ok,
      ).toBe(false);
      expect(
        (await edit("Call 0803 123 4567 for more.").expect(200)).body.checks[0]
          .ok,
      ).toBe(false);
      // The bare handle of a person who answered this week.
      await edit(`Prices hurt, says ${w.handles[1]}.`).expect(200);
      expect((await check()).ok).toBe(false);
      const approve = await http()
        .post(`/api/v1/admin/weekly-reports/${r.id}/approve`)
        .set("Authorization", ed.auth)
        .send({ publishAt: new Date(Date.now() + 3_600_000).toISOString() })
        .expect(422);
      expect(approve.body.error.code).toBe("VALIDATION_FAILED");
      // A sweeping word is a warning.
      const sweep = (
        await edit("Everyone is angry about prices.").expect(200)
      ).body.checks.at(-1);
      expect(sweep.ok).toBe(false);
      expect(sweep.text).toContain("most voices");
      // Clean text passes and approves.
      await edit("Most voices pointed at prices.").expect(200);
      expect((await check()).ok).toBe(true);
      await http()
        .post(`/api/v1/admin/weekly-reports/${r.id}/approve`)
        .set("Authorization", ed.auth)
        .send({ publishAt: new Date(Date.now() + 3_600_000).toISOString() })
        .expect(200);
    });
  });

  // ------------------------------------------------------------------ 6
  describe("item 6: moderation rows carry the quoted question and the listen count", () => {
    it("GET /admin/moderation/items needs no per-row detail call", async () => {
      const q = await prisma.question.create({
        data: { text: "Which promise can you recite?", status: "LIVE" },
      });
      const author = await makePerson(h);
      const answer = await prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author.id,
          kind: "TEXT",
          body: "Words",
          listenCount: 220,
        },
      });
      const item = await prisma.moderationItem.create({
        data: {
          queue: "REPORTED",
          targetType: "ANSWER",
          targetId: answer.id,
          reasons: ["THREAT"],
          reportCount: 3,
        },
      });
      const mod = await makePerson(h, { roles: ["MODERATOR"] });
      const list = await get("/admin/moderation/items", mod).expect(200);
      const row = list.body.items.find((i: { id: string }) => i.id === item.id);
      expect(row.questionText).toBe("Which promise can you recite?");
      expect(row.listenCount).toBe(220);
      const detail = await get(
        `/admin/moderation/items/${item.id}`,
        mod,
      ).expect(200);
      expect(detail.body.item.questionText).toBe(
        "Which promise can you recite?",
      );
      expect(detail.body.item.listenCount).toBe(detail.body.listenCount);
      // A target with no question (a person) has none.
      const u = await prisma.moderationItem.create({
        data: {
          queue: "REPORTED",
          targetType: "USER",
          targetId: author.id,
          reasons: ["SPAM"],
          reportCount: 1,
        },
      });
      const again = await get("/admin/moderation/items", mod).expect(200);
      const urow = again.body.items.find((i: { id: string }) => i.id === u.id);
      expect(urow.questionText).toBeNull();
      expect(urow.listenCount).toBe(0);
    });
  });

  // ------------------------------------------------------------------ 7
  describe("item 7 (money): PUT /admin/config/units.tiers changes the packs people buy", () => {
    const putTiers = (p: Person, value: unknown) =>
      http()
        .put("/api/v1/admin/config/units.tiers")
        .set("Authorization", p.auth)
        .send({ value, reason: "Owner sets the real pack prices" });
    const packs = async () =>
      (
        await prisma.configEntry.findUniqueOrThrow({
          where: { key: "units.tiers" },
        })
      ).valueJson as Record<string, unknown>[];

    it("GET /units/tiers and a new purchase follow it; a payment started before credits the old amount; history and rollback; 422; 403", async () => {
      const admin = await makePerson(h, { roles: ["ADMIN"] });
      const editor = await makePerson(h, { roles: ["EDITOR"] });
      const buyer = await makePerson(h);
      // The config row exists with the defaults.
      await get("/admin/config", admin).expect(200);
      const before = (await get("/units/tiers").expect(200)).body.tiers.find(
        (t: { slug: string }) => t.slug === "entry",
      );
      expect(before.priceKobo).toBe(18300);

      // A payment started at the old price.
      const old = await http()
        .post("/api/v1/payments")
        .set("Authorization", buyer.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "UNITS", tierId: before.id })
        .expect(201);
      expect(old.body.amountKobo).toBe(18300);

      // Non-admin: 403. Zero, negative, fractional-naira price: 422. Nothing changed.
      const list = await packs();
      const withEntry = (over: Record<string, unknown>) =>
        list.map((t) => (t.slug === "entry" ? { ...t, ...over } : t));
      await putTiers(editor, withEntry({ priceKobo: 25000 })).expect(403);
      await putTiers(admin, withEntry({ priceKobo: 0 })).expect(422);
      await putTiers(admin, withEntry({ priceKobo: -500 })).expect(422);
      await putTiers(admin, withEntry({ priceKobo: 25050 })).expect(422);
      await putTiers(admin, withEntry({ unitsMilli: 0 })).expect(422);
      await putTiers(admin, withEntry({ bonusMilli: 99999999 })).expect(422);
      expect((await packs()).find((t) => t.slug === "entry")?.priceKobo).toBe(
        18300,
      );
      expect(
        (await prisma.unitTier.findUniqueOrThrow({ where: { slug: "entry" } }))
          .priceKobo,
      ).toBe(18300);

      // The owner sets the Entry pack: 25,000 kobo for 250 tokens.
      await putTiers(
        admin,
        withEntry({ priceKobo: 25000, unitsMilli: 250000 }),
      ).expect(200);
      const after = (await get("/units/tiers").expect(200)).body.tiers.find(
        (t: { slug: string }) => t.slug === "entry",
      );
      expect(after).toMatchObject({
        id: before.id,
        priceKobo: 25000,
        unitsMilli: 250000,
      });

      // A new purchase uses the new price and units.
      const fresh = await http()
        .post("/api/v1/payments")
        .set("Authorization", buyer.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "UNITS", tierId: after.id })
        .expect(201);
      expect(fresh.body).toMatchObject({
        amountKobo: 25000,
        unitsMilli: 250000,
      });
      // Flutterwave is asked for the total (price + VAT + payment charge); the price and the tokens stay as set.
      expect(flw.inits.at(-1)?.amountNaira).toBe(fresh.body.totalKobo / 100);

      // The payment started before the change still credits the old amount.
      flw.pay(old.body.txRef as string, old.body.totalKobo / 100);
      await http()
        .post(`/api/v1/payments/${old.body.paymentId}/verify`)
        .set("Authorization", buyer.auth)
        .set("Idempotency-Key", randomUUID())
        .send({})
        .expect(200);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } }))
          .balanceMilli,
      ).toBe(183000);
      expect(
        await prisma.payment.findUniqueOrThrow({
          where: { id: old.body.paymentId },
        }),
      ).toMatchObject({
        amountKobo: 18300,
        unitsMilli: 183000,
        status: "SUCCEEDED",
      });

      // The change is in the history, with a reason, and rolls back.
      const log = await get(
        "/admin/config/changes?key=units.tiers",
        admin,
      ).expect(200);
      expect(log.body.items).toHaveLength(1);
      expect(log.body.items[0].reason).toBe("Owner sets the real pack prices");
      await http()
        .post(`/api/v1/admin/config/changes/${log.body.items[0].id}/rollback`)
        .set("Authorization", admin.auth)
        .send({ reason: "Back to the launch price" })
        .expect(200);
      const back = (await get("/units/tiers").expect(200)).body.tiers.find(
        (t: { slug: string }) => t.slug === "entry",
      );
      expect(back).toMatchObject({ priceKobo: 18300, unitsMilli: 183000 });

      // Taking a pack out of the list switches it off; adding one makes it appear; nobody's payment row is touched.
      await putTiers(
        admin,
        list.filter((t) => t.slug !== "ultimate"),
      ).expect(200);
      const slugs = (await get("/units/tiers")).body.tiers.map(
        (t: { slug: string }) => t.slug,
      );
      expect(slugs).not.toContain("ultimate");
      expect(slugs).toHaveLength(6);
    });
  });

  // ------------------------------------------------------------------ 8
  describe("item 8 (identity): the WAWU ID status claim", () => {
    const tokenOf = (p: Person, status?: unknown) =>
      `Bearer ${jwks.sign({ sub: p.wawuId, ...(status === undefined ? {} : { status }) })}`;

    it("active (or no claim) can write; any other status reads but every write is 403 ACCOUNT_SUSPENDED, and nothing is created", async () => {
      const p = await makePerson(h, { freePosts: 5 });
      const q = await makeQuestion(h);
      const post = (auth: string) =>
        http()
          .post(`/api/v1/questions/${q.id}/answers`)
          .set("Authorization", auth)
          .set("Idempotency-Key", randomUUID())
          .send({ kind: "TEXT", body: "I can speak." });
      expect((await post(tokenOf(p, "active"))).status).toBe(201);
      expect((await post(tokenOf(p))).status).toBe(201); // older tokens have no claim
      const rows = await prisma.answer.count({ where: { authorId: p.id } });
      expect(rows).toBe(2);

      const topic = await prisma.topic.create({
        data: {
          weekNumber: 92,
          title: "Standing",
          startsOn: new Date("2026-12-08"),
          endsOn: new Date("2026-12-14"),
          status: "LIVE",
        },
      });
      const poll = await prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "Which?",
          status: "OPEN",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          options: {
            create: [
              { label: "A", sortOrder: 0 },
              { label: "B", sortOrder: 1 },
            ],
          },
        },
        include: { options: true },
      });
      const tier = await prisma.unitTier.findFirstOrThrow({
        where: { active: true },
      });
      await prisma.user.update({
        where: { id: p.id },
        data: { phoneHash: `ph-${randomUUID()}` },
      });
      const brandNew = `new-${randomUUID()}`;

      for (const status of [
        "suspended",
        "banned",
        "pending_deletion",
        "something_new",
        "ACTIVE_NOT",
      ]) {
        const auth = tokenOf(p, status);
        const refused = [
          await post(auth),
          await http()
            .post(`/api/v1/polls/${poll.id}/votes`)
            .set("Authorization", auth)
            .set("Idempotency-Key", randomUUID())
            .send({ optionIds: [poll.options[0].id] }),
          await http()
            .post("/api/v1/payments")
            .set("Authorization", auth)
            .set("Idempotency-Key", randomUUID())
            .send({ kind: "UNITS", tierId: tier.id }),
          await http()
            .post("/api/v1/me")
            .set(
              "Authorization",
              `Bearer ${jwks.sign({ sub: brandNew, status })}`,
            )
            .send({}),
        ];
        for (const r of refused) {
          expect(r.status).toBe(403);
          expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
          expect(r.body.error.message).toBe(
            "This account cannot post right now.",
          );
          expect(r.body.error.details.until).toBeNull();
        }
        // Reads still work as a signed-in person.
        await get("/me").set("Authorization", auth).expect(200);
        await get("/units/tiers").set("Authorization", auth).expect(200);
        await get(`/polls/${poll.id}`).set("Authorization", auth).expect(200);
      }
      expect(await prisma.answer.count({ where: { authorId: p.id } })).toBe(2);
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0);
      expect(await prisma.payment.count({ where: { userId: p.id } })).toBe(0);
      expect(await prisma.user.count({ where: { wawuId: brandNew } })).toBe(0);
    });
  });

  // ------------------------------------------------------------------ 9
  describe("item 9: a suspended person can appeal, and only appeal", () => {
    it("VOICES-suspended and WAWU-ID-suspended people appeal (201); every other write is 403", async () => {
      const p = await makePerson(h, { freePosts: 5 });
      const q = await makeQuestion(h);
      const mine = await prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "TEXT",
          body: "Removed one",
          status: "REMOVED",
        },
      });
      await prisma.user.update({
        where: { id: p.id },
        data: {
          status: "SUSPENDED",
          suspendedUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const appeal = (auth: string) =>
        http().post("/api/v1/appeals").set("Authorization", auth).send({
          targetType: "ANSWER",
          targetId: mine.id,
          note: "That was fair comment.",
        });
      const first = await appeal(p.auth);
      expect(first.status).toBe(201);
      expect(await prisma.appeal.count({ where: { userId: p.id } })).toBe(1);
      const second = await prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "TEXT",
          body: "Removed two",
          status: "REMOVED",
        },
      });
      const viaClaim = await http()
        .post("/api/v1/appeals")
        .set(
          "Authorization",
          `Bearer ${jwks.sign({ sub: p.wawuId, status: "suspended" })}`,
        )
        .send({
          targetType: "ANSWER",
          targetId: second.id,
          note: "Please look again.",
        });
      expect(viaClaim.status).toBe(201);
      // Everything else stays refused.
      for (const auth of [
        p.auth,
        `Bearer ${jwks.sign({ sub: p.wawuId, status: "suspended" })}`,
      ]) {
        const r = await http()
          .post(`/api/v1/questions/${q.id}/answers`)
          .set("Authorization", auth)
          .set("Idempotency-Key", randomUUID())
          .send({ kind: "TEXT", body: "Still posting" });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
      }
      expect(
        await prisma.answer.count({
          where: { authorId: p.id, status: "PUBLISHED" },
        }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------------ 10
  describe("item 10: PATCH /admin/questions/{id} keeps the stored kind", () => {
    it("a FLASH question edited without kind stays FLASH; AdminQuestion carries kind; create still needs it", async () => {
      const ed = await makePerson(h, { roles: ["EDITOR"] });
      const created = await http()
        .post("/api/v1/admin/questions")
        .set("Authorization", ed.auth)
        .send({ kind: "FLASH", text: "Is the queue moving at your station?" })
        .expect(201);
      expect(created.body.kind).toBe("FLASH");
      const edited = await http()
        .patch(`/api/v1/admin/questions/${created.body.id}`)
        .set("Authorization", ed.auth)
        .send({ text: "Is the queue moving at your petrol station?" })
        .expect(200);
      expect(edited.body.kind).toBe("FLASH");
      expect(
        (
          await prisma.question.findUniqueOrThrow({
            where: { id: created.body.id },
          })
        ).kind,
      ).toBe("FLASH");
      // An explicit kind still changes it.
      const changed = await http()
        .patch(`/api/v1/admin/questions/${created.body.id}`)
        .set("Authorization", ed.auth)
        .send({
          kind: "FOLLOW_UP",
          text: "Is the queue moving at your petrol station?",
        })
        .expect(200);
      expect(changed.body.kind).toBe("FOLLOW_UP");
      await http()
        .post("/api/v1/admin/questions")
        .set("Authorization", ed.auth)
        .send({ text: "No kind given here" })
        .expect(422);
    });
  });

  // ------------------------------------------------------------------ 11
  describe("item 11: advert checks are computed", () => {
    it("a betting brand, a loan word or a kept-away category fails its check and blocks approval; a clean advert passes", async () => {
      const am = await makePerson(h, { roles: ["AD_MANAGER"] as never });
      const politics = await prisma.category.create({
        data: {
          slug: `politics-${randomUUID().slice(0, 6)}`,
          name: "Politics",
        },
      });
      const money = await prisma.category.create({
        data: { slug: `money-${randomUUID().slice(0, 6)}`, name: "Money" },
      });
      const make = (over: Record<string, unknown>) =>
        http()
          .post("/api/v1/admin/ads")
          .set("Authorization", am.auth)
          .send({
            brand: "Mama Nkechi's Kitchen",
            kind: "FEED_CARD",
            headline: "Hear this week's soup of the day",
            linkUrl: "https://example.com/soup",
            startsOn: "2026-12-01",
            endsOn: "2026-12-07",
            ...over,
          })
          .expect(201);
      const decide = (id: string) =>
        http()
          .post(`/api/v1/admin/ads/${id}/decision`)
          .set("Authorization", am.auth)
          .send({ decision: "APPROVE" });
      const wordsOk = (ad: { checks: { text: string; ok: boolean }[] }) =>
        ad.checks.find((c) => c.text.startsWith("Not political"))?.ok;
      const placeOk = (ad: { checks: { text: string; ok: boolean }[] }) =>
        ad.checks.find((c) => c.text.startsWith("Not political"))?.ok;

      const bet = (
        await make({ brand: "Lucky Stake", headline: "Win big every weekend" })
      ).body;
      expect(wordsOk(bet)).toBe(false);
      const refused = await decide(bet.id).expect(422);
      expect(refused.body.error.details.fields[0].message).toContain("betting");
      expect(
        (await prisma.ad.findUniqueOrThrow({ where: { id: bet.id } })).status,
      ).toBe("AWAITING_APPROVAL");

      const loan = (await make({ headline: "Instant loan, no collateral" }))
        .body;
      expect(wordsOk(loan)).toBe(false);
      await decide(loan.id).expect(422);

      const aimed = (await make({ categoryIds: [politics.id] })).body;
      expect(placeOk(aimed)).toBe(false);
      const r = await decide(aimed.id).expect(422);
      expect(r.body.error.details.fields[0].message).toContain("Politics");

      const clean = (await make({ categoryIds: [money.id] })).body;
      expect(wordsOk(clean)).toBe(true);
      expect(placeOk(clean)).toBe(true);
      await decide(clean.id).expect(200);
      expect(
        (await prisma.ad.findUniqueOrThrow({ where: { id: clean.id } })).status,
      ).toBe("APPROVED");
    });
  });

  // ------------------------------------------------------------------ round 1
  describe("round 1", () => {
    it("item 8 table: every signed-in write route in the contract refuses a non-active status, the open ones do not", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require("js-yaml") as { load: (s: string) => any };
      const doc = yaml.load(
        readFileSync(
          join(__dirname, "../../../docs/contract/openapi.yaml"),
          "utf8",
        ),
      );
      const p = await makePerson(h);
      const auth = `Bearer ${jwks.sign({ sub: p.wawuId, status: "banned" })}`;
      const uuid = randomUUID();
      const open = /^\/(appeals|events|ads)(\/|$)/;
      const refused: string[] = [];
      const notRefused: string[] = [];
      for (const [path, ops] of Object.entries<any>(doc.paths)) {
        for (const [method, op] of Object.entries<any>(ops)) {
          if (!["post", "put", "patch", "delete"].includes(method)) continue;
          if (
            !JSON.stringify(op.security ?? [{ wawuId: [] }]).includes("wawuId")
          )
            continue;
          if (open.test(path)) continue;
          const url =
            "/api/v1" +
            path.replace(/\{(\w+)\}/g, (_m, n: string) =>
              ["slug", "code", "key", "handle"].includes(n) ? "x" : uuid,
            );
          const r = await http()
            [method as "post"](url)
            .set("Authorization", auth)
            .send({});
          (r.status === 403 && r.body?.error?.code === "ACCOUNT_SUSPENDED"
            ? refused
            : notRefused
          ).push(`${method} ${path} ${r.status}`);
        }
      }
      expect(notRefused).toEqual([]);
      expect(refused.length).toBeGreaterThan(40);
      // The open ones are not blocked by the claim (they may fail for other reasons, never ACCOUNT_SUSPENDED from the guard).
      const ev = await http()
        .post("/api/v1/events")
        .set("Authorization", auth)
        .send({ events: [{ name: "screen_view", props: {} }] });
      expect(ev.body?.error?.code).not.toBe("ACCOUNT_SUSPENDED");
    });

    it("item 1: an advert edited while paused goes back to approval, and RESUME re-runs the screens", async () => {
      const am = await makePerson(h, { roles: ["AD_MANAGER"] as never });
      const mk = (over: Record<string, unknown> = {}) =>
        http()
          .post("/api/v1/admin/ads")
          .set("Authorization", am.auth)
          .send({
            brand: "Mama Nkechi's Kitchen",
            kind: "FEED_CARD",
            headline: "Hear this week's soup of the day",
            linkUrl: "https://example.com/soup",
            startsOn: "2026-12-01",
            endsOn: "2026-12-07",
            ...over,
          })
          .expect(201);
      const decide = (id: string, decision: string) =>
        http()
          .post(`/api/v1/admin/ads/${id}/decision`)
          .set("Authorization", am.auth)
          .send({ decision, reason: "x" });
      const ad = (await mk()).body;
      await decide(ad.id, "APPROVE").expect(200);
      await decide(ad.id, "PAUSE").expect(200);
      // The attack: change the brand while paused, then resume.
      const edited = await http()
        .patch(`/api/v1/admin/ads/${ad.id}`)
        .set("Authorization", am.auth)
        .send({
          brand: "Lucky Stake",
          kind: "FEED_CARD",
          headline: "Hear this week's soup of the day",
        })
        .expect(200);
      expect(edited.body.status).toBe("AWAITING_APPROVAL");
      expect(edited.body.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
      await decide(ad.id, "RESUME").expect(409);
      await decide(ad.id, "APPROVE").expect(422);
      expect(
        (await prisma.ad.findUniqueOrThrow({ where: { id: ad.id } })).status,
      ).toBe("AWAITING_APPROVAL");
      // RESUME itself re-runs the screens, even if the row was changed behind the API.
      const ad2 = (await mk()).body;
      await decide(ad2.id, "APPROVE").expect(200);
      await decide(ad2.id, "PAUSE").expect(200);
      await prisma.ad.update({
        where: { id: ad2.id },
        data: { brand: "Betway" },
      });
      const resume = await decide(ad2.id, "RESUME").expect(422);
      expect(resume.body.error.details.fields[0].message).toContain("betting");
      expect(
        (await prisma.ad.findUniqueOrThrow({ where: { id: ad2.id } })).status,
      ).toBe("PAUSED");
      // A paused advert edited only in its dates stays paused.
      const ad3 = (await mk()).body;
      await decide(ad3.id, "APPROVE").expect(200);
      await decide(ad3.id, "PAUSE").expect(200);
      const dates = await http()
        .patch(`/api/v1/admin/ads/${ad3.id}`)
        .set("Authorization", am.auth)
        .send({
          brand: "Mama Nkechi's Kitchen",
          kind: "FEED_CARD",
          headline: "Hear this week's soup of the day",
          endsOn: "2026-12-20",
        });
      expect(dates.status).toBe(200);
    });

    it("item 2: Nigerian betting brands, loan apps and spaced letters are refused; party jollof and a bank savings advert pass", async () => {
      const am = await makePerson(h, { roles: ["AD_MANAGER"] as never });
      const post = (brand: string, headline: string, body?: string) =>
        http()
          .post("/api/v1/admin/ads")
          .set("Authorization", am.auth)
          .send({
            brand,
            kind: "FEED_CARD",
            headline,
            ...(body ? { body } : {}),
            linkUrl: "https://example.com",
            startsOn: "2026-12-01",
            endsOn: "2026-12-07",
          })
          .expect(201);
      const ok = (ad: { checks: { text: string; ok: boolean }[] }) =>
        ad.checks.find((c) => c.text.startsWith("Not political"))!.ok;
      const bad: [string, string][] = [
        ["Bet9ja", "Play today"],
        ["1xBet", "Play today"],
        ["Betway", "Play today"],
        ["Nairabet", "Play today"],
        ["SportyBet", "Play today"],
        ["BetKing", "Play today"],
        ["MSport", "Play today"],
        ["Merrybet", "Play today"],
        ["BangBet", "Play today"],
        ["Nice brand", "FastCash now, pay later"],
        ["Nice brand", "Instant loan app for you"],
        ["Nice brand", "g a m b l i n g made easy"],
        ["B e t 9 j a", "Play"],
        ["Nice brand", "Win at b3tting"],
      ];
      for (const [brand, headline] of bad)
        expect(ok((await post(brand, headline)).body)).toBe(false);
      expect(
        ok((await post("Mama Nkechi", "Party jollof for your weekend")).body),
      ).toBe(true);
      expect(
        ok(
          (
            await post(
              "Heritage Bank",
              "Open a savings account",
              "Earn interest every month. Ask us about a loan for your shop.",
            )
          ).body,
        ),
      ).toBe(true);
      const party = (await post("Mama Nkechi", "Party jollof for your weekend"))
        .body;
      await http()
        .post(`/api/v1/admin/ads/${party.id}/decision`)
        .set("Authorization", am.auth)
        .send({ decision: "APPROVE" })
        .expect(200);
    });

    it("item 3: a pack under the smallest purchase or with an unknown key is refused", async () => {
      const admin = await makePerson(h, { roles: ["ADMIN"] });
      await get("/admin/config", admin).expect(200);
      const list = (
        await prisma.configEntry.findUniqueOrThrow({
          where: { key: "units.tiers" },
        })
      ).valueJson as Record<string, unknown>[];
      const put = (value: unknown) =>
        http()
          .put("/api/v1/admin/config/units.tiers")
          .set("Authorization", admin.auth)
          .send({ value, reason: "test" });
      const low = await put(
        list.map((t, i) => (i === 0 ? { ...t, priceKobo: 10000 } : t)),
      ).expect(422);
      expect(low.body.error.details.fields[0].message).toContain(
        "smallest purchase",
      );
      await put(list.map((t, i) => (i === 0 ? { ...t, evil: 1 } : t))).expect(
        422,
      );
      await put(list).expect(200);
      expect(
        (
          await prisma.configEntry.findUniqueOrThrow({
            where: { key: "units.tiers" },
          })
        ).valueJson,
      ).toEqual(list);
    });

    it("item 4: moderation rows carry postKind", async () => {
      const mod = await makePerson(h, { roles: ["MODERATOR"] });
      const author = await makePerson(h);
      const q = await prisma.question.create({
        data: { text: "A question for kinds?", status: "LIVE" },
      });
      const clip = await prisma.voiceClip.create({
        data: {
          ownerId: author.id,
          purpose: "ANSWER",
          status: "READY",
          rawKey: "raw/k",
          rawMime: "audio/webm",
          maxDurationMs: 10000,
          durationMs: 3000,
        },
      });
      const voice = await prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author.id,
          kind: "VOICE",
          clipId: clip.id,
        },
      });
      const text = await prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author.id,
          kind: "TEXT",
          body: "t",
        },
      });
      const reply = await prisma.reply.create({
        data: {
          answerId: text.id,
          authorId: author.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "r",
        } as never,
      });
      const mkItem = (targetType: string, targetId: string) =>
        prisma.moderationItem.create({
          data: {
            queue: "REPORTED",
            targetType: targetType as never,
            targetId,
            reasons: ["SPAM"],
            reportCount: 1,
          },
        });
      const items = {
        VOICE: await mkItem("ANSWER", voice.id),
        TEXT: await mkItem("ANSWER", text.id),
        REPLY_TEXT: await mkItem("REPLY", reply.id),
        NONE: await mkItem("USER", author.id),
      };
      const list = (await get("/admin/moderation/items", mod).expect(200)).body
        .items as { id: string; postKind: string | null }[];
      const kind = (id: string) => list.find((i) => i.id === id)?.postKind;
      expect(kind(items.VOICE.id)).toBe("VOICE");
      expect(kind(items.TEXT.id)).toBe("TEXT");
      expect(kind(items.REPLY_TEXT.id)).toBe("REPLY_TEXT");
      expect(kind(items.NONE.id)).toBeNull();
    });
  });
});

void idem;
