/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../../test/test-env";
import { TestJwks } from "../../test/test-jwks";
import { importQuestions, type SeedFile, type WeekCategory } from "./seed";
import { seedLaunchQuestion, LAUNCH_QUESTION } from "./launch-question";
import { applyShift } from "./launch-shift";

const root = join(__dirname, "../../../docs/seed");
const seed = JSON.parse(
  readFileSync(join(root, "questions.json"), "utf8"),
) as SeedFile;
const cats = JSON.parse(
  readFileSync(join(root, "week-categories.json"), "utf8"),
) as WeekCategory[];

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

const T1 = "2026-11-14T05:00:00Z"; // the measured moment: launch question still SCHEDULED
const T2 = "2026-11-14T23:00:00Z"; // midnight in Lagos: the launch question opens
const T3 = "2026-11-15T23:00:00Z"; // Monday 16 Nov in Lagos: week 1 starts, day 1 question opens
const T4 = "2026-11-17T00:00:00Z"; // the 17 Nov question (16 Nov 23:00 UTC) is open

/** V-PRELAUNCH: nothing under a question that has not opened is readable, on every read path, by anyone. */
describe("pre-launch: nothing from a question that has not opened (V-PRELAUNCH)", () => {
  const jwks = new TestJwks();
  let app: INestApplication;
  let db: import("../common/prisma/prisma.service").PrismaService;
  type J = Record<string, any>;
  const http = () => request(app.getHttpServer() as App);
  const get = (url: string, token?: string) => {
    const r = http().get(`/api/v1${url}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };
  let answerId: string;
  let replyId: string;
  let qId: string;
  let launchId: string;
  let weekTopicId: string;
  let authorHandle: string;
  let authorId: string;
  let otherId: string;
  let clipA: string;
  let clipR: string;
  let voiceAnswerId: string;

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
    await db.$executeRawUnsafe(
      'TRUNCATE "Topic","Category","User","AuditLog" CASCADE',
    );
    // exactly production: seed:questions, seed:launch, then the launch shift
    await importQuestions(db, seed, cats);
    await seedLaunchQuestion(db);
    const plan = await applyShift(db, seed);
    expect(plan.refusals).toEqual([]);

    const author = await db.user.create({
      data: {
        wawuId: "u-author",
        handle: "the.author",
        displayName: "The Author",
        referralCode: "AUTH01",
      },
    });
    const other = await db.user.create({
      data: {
        wawuId: "u-other",
        handle: "the.other",
        displayName: "Other One",
        referralCode: "OTHR01",
      },
    });
    authorId = author.id;
    otherId = other.id;
    authorHandle = author.handle;
    // the bank question dated 17 Nov (the owner's old answers sit like this: inserted directly)
    const q = await db.question.findFirstOrThrow({
      where: {
        seedKey: { not: null },
        isSpare: false,
        scheduledFor: new Date("2026-11-17T00:00:00Z"),
      },
    });
    qId = q.id;
    const a = await db.answer.create({
      data: {
        questionId: q.id,
        authorId,
        kind: "TEXT",
        body: "Zebra pelican answer.",
        rankScore: 99,
        isNews: true,
        newsTag: "VERIFIED_NEWS",
      },
    });
    answerId = a.id;
    const r = await db.reply.create({
      data: {
        answerId,
        authorId: otherId,
        stance: "AGREE",
        kind: "TEXT",
        body: "Zebra pelican reply.",
      },
    });
    replyId = r.id;
    await db.question.update({
      where: { id: q.id },
      data: { answerCount: 2 },
    });
    await db.answer.update({
      where: { id: answerId },
      data: { replyCount: 1, agreeCount: 1 },
    });
    // a voice answer and a voice reply on the same question, each with a clip and a transcript
    const mkClip = async (ownerId: string, text: string) => {
      const c = await db.voiceClip.create({
        data: {
          ownerId,
          purpose: "ANSWER",
          status: "READY",
          rawKey: `raw/${text}`,
          rawMime: "audio/webm",
          playKey: `play/${text}`,
          playMime: "audio/mp4",
          durationMs: 4000,
          maxDurationMs: 10000,
        },
      });
      await db.transcript.create({
        data: { clipId: c.id, status: "READY", language: "en", text },
      });
      return c.id;
    };
    clipA = await mkClip(authorId, "Quokka voice answer");
    const va = await db.answer.create({
      data: {
        questionId: q.id,
        authorId,
        kind: "VOICE",
        clipId: clipA,
        rankScore: 50,
      },
    });
    voiceAnswerId = va.id;
    clipR = await mkClip(otherId, "Quokka voice reply");
    await db.reply.create({
      data: {
        answerId,
        authorId: otherId,
        stance: "AGREE",
        kind: "VOICE",
        clipId: clipR,
      },
    });
    await db.save.create({ data: { userId: otherId, answerId } });
    await db.notification.create({
      data: {
        userId: authorId,
        type: "REPLY",
        title: "Someone replied to your voice",
        body: "Zebra",
        targetType: "answer",
        targetId: answerId,
        groupKey: `reply:${replyId}`,
      },
    });
    const launch = await db.question.findFirstOrThrow({
      where: { seedKey: LAUNCH_QUESTION.seedKey },
    });
    launchId = launch.id;
    weekTopicId = (
      await db.topic.findUniqueOrThrow({ where: { weekNumber: 1 } })
    ).id;
  });

  afterAll(async () => {
    jest.useRealTimers();
    await app?.close();
    await jwks.stop();
  });
  afterEach(() => jest.useRealTimers());

  /** Everything the three kinds of viewer can reach, as [name, status, whether the body names the answer or reply]. */
  async function sweep(who: "guest" | "other" | "author") {
    const token =
      who === "guest"
        ? undefined
        : jwks.sign({ sub: who === "other" ? "u-other" : "u-author" });
    const seen: Record<string, boolean> = {};
    const note = (name: string, res: request.Response) => {
      const text = JSON.stringify(res.body ?? {});
      seen[name] =
        res.status === 200 &&
        (text.includes(answerId) ||
          text.includes(voiceAnswerId) ||
          text.includes("Quokka") ||
          text.includes("Zebra pelican") ||
          text.includes(replyId));
    };
    note("answer by id", await get(`/answers/${answerId}`, token));
    note("replies", await get(`/answers/${answerId}/replies`, token));
    note("question answers", await get(`/questions/${qId}/answers`, token));
    note("home", await get("/home", token));
    note("feed trending", await get("/feed/trending?limit=50", token));
    note(
      "feed trending (news tag)",
      await get("/feed/trending?tag=VERIFIED_NEWS", token),
    );
    note("feed new", await get("/feed/new?limit=50", token));
    note("search answers", await get("/search?q=zebra", token));
    note("search by transcript", await get("/search?q=quokka", token));
    // a clip is readable to its own owner (who recorded it), to nobody else
    if (who !== "author") {
      note("clip of a voice answer", await get(`/voice-clips/${clipA}`, token));
      seen["clip play (answer)"] =
        (await get(`/voice-clips/${clipA}/play`, token)).status !== 404;
    }
    if (who !== "other") {
      note("clip of a voice reply", await get(`/voice-clips/${clipR}`, token));
      seen["clip play (reply)"] =
        (await get(`/voice-clips/${clipR}/play`, token)).status !== 404;
    }
    note("search people", await get("/search?q=author&type=people", token));
    note("news list", await get("/news", token));
    note("news item", await get(`/news/${answerId}`, token));
    note("people profile", await get(`/people/${authorId}`, token));
    note(
      "people by handle",
      await get(`/people/by-handle/${authorHandle}`, token),
    );
    note("people replies", await get(`/people/${otherId}/replies`, token));
    note("categories", await get("/categories", token));
    if (token) {
      note("my answers", await get("/me/answers", token));
      note("my saved", await get("/me/saved", token));
      note("notifications", await get("/notifications", token));
    }
    return seen;
  }

  const hiddenEverywhere = (seen: Record<string, boolean>) =>
    Object.entries(seen)
      .filter(([, v]) => v)
      .map(([k]) => k);

  it("T1, 14 Nov 05:00 UTC: the answer and the reply are hidden from a guest, another member and the author", async () => {
    at(T1);
    for (const who of ["guest", "other", "author"] as const)
      expect({ who, leaks: hiddenEverywhere(await sweep(who)) }).toEqual({
        who,
        leaks: [],
      });
    // the status codes, not only the bodies
    expect((await get(`/answers/${answerId}`)).status).toBe(404);
    expect((await get(`/answers/${answerId}/replies`)).status).toBe(404);
    expect((await get(`/questions/${qId}`)).status).toBe(404);
  });

  it("T1: Home shows the launch question as not open, no voices, and a topic that has not started", async () => {
    at(T1);
    const h = (await get("/home").expect(200)).body as J;
    expect(h.dailyQuestion.id).toBe(launchId);
    expect(h.dailyQuestion.status).toBe("SCHEDULED");
    expect(new Date(h.dailyQuestion.startsAt).toISOString()).toBe(
      "2026-11-14T23:00:00.000Z",
    );
    expect(h.trending).toEqual([]);
    expect(h.topicOfWeek.status).toBe("SCHEDULED");
    expect(h.topicOfWeek.startsOn).toBe("2026-11-16");
    expect(h.topicOfWeek.voiceCount).toBe(0);
    expect(h.topicOfWeek.voicesCount).toBe(0);
    expect(h.newConversations).toEqual([]);
    const cat = (await get("/categories").expect(200)).body as J;
    expect(cat.items.every((c: J) => c.voicesThisWeek === 0)).toBe(true);
  });

  it("T1: writes on a hidden bank question are 404 (V-27 stands); only the launch question answers 409 with its date", async () => {
    at(T1);
    const token = jwks.sign({ sub: "u-other" });
    const send = (method: "post" | "put", url: string, body: object = {}) =>
      http()
        [method](`/api/v1${url}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", `k-${url}-${Math.random()}`)
        .send(body);
    // the 17 Nov bank question is not shown as coming up: 404 everywhere, no date given away
    for (const res of [
      await send("post", `/questions/${qId}/answers`, {
        kind: "TEXT",
        body: "Early.",
      }),
      await send("post", `/answers/${answerId}/replies`, {
        stance: "AGREE",
        kind: "TEXT",
        body: "Early.",
      }),
      await send("put", `/answers/${answerId}/reaction`, { kind: "POWERFUL" }),
      await send("put", `/answers/${answerId}/like`),
      await send("put", `/answers/${answerId}/save`),
      await send("put", `/questions/${qId}/save`),
    ]) {
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("opens on");
    }
    // the launch question is shown as coming up: 409 QUESTION_NOT_OPEN with the Lagos date
    for (const res of [
      await send("post", `/questions/${launchId}/answers`, {
        kind: "TEXT",
        body: "Early bird.",
      }),
      await send("put", `/questions/${launchId}/save`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code ?? res.body.error?.code).toBe("QUESTION_NOT_OPEN");
      expect(JSON.stringify(res.body)).toContain(
        "This question opens on Sunday 15 November.",
      );
    }
    expect(await db.answer.count({ where: { questionId: launchId } })).toBe(0);
  });

  it("T1: the launch question can be shared as coming up; its page and card show that state; any other unopened question or voice is 404", async () => {
    at(T1);
    const token = jwks.sign({ sub: "u-author" });
    const mk = (objectType: string, objectId: string) =>
      http()
        .post("/api/v1/share/links")
        .set("Authorization", `Bearer ${token}`)
        .send({ objectType, objectId });
    expect((await mk("QUESTION", qId)).status).toBe(404);
    expect((await mk("ANSWER", answerId)).status).toBe(404);
    expect((await mk("ANSWER", voiceAnswerId)).status).toBe(404);
    const link = await mk("QUESTION", launchId);
    expect(link.status).toBe(201);
    const code = link.body.code as string;
    const page = (await get(`/share/${code}`).expect(200)).body as J;
    expect(page.topicLine).toBe("How do you feel about Nigeria right now?");
    expect(page.question.status).toBe("SCHEDULED");
    expect(new Date(page.question.startsAt).toISOString()).toBe(
      "2026-11-14T23:00:00.000Z",
    );
    expect(page.question.voicesCount).toBe(0);
    expect(page.question.voiceCount).toBe(0);
    expect(page.arguments).toEqual([]);
    expect(page.featuredVoice).toBeNull();
    expect(page.poll).toBeNull();
    expect(page.basedOnVoices).toBe(0);
    expect(page.openGraph.description).toBe("Opens Sunday 15 November");
    // the card (drawn from the same subject; the test has no card storage): label, headline, summary, no voices count
    const { loadSubject } = await import("../reach/share-subject.js");
    const { cardSpecFor } = await import("../reach/share.service.js");
    const subject = await loadSubject(db, "QUESTION", launchId);
    const spec = cardSpecFor("QUESTION", subject!);
    expect(spec.label).toBe("Nigeria · Coming up");
    expect(spec.headline).toBe("How do you feel about Nigeria right now?");
    expect(spec.summary).toBe("Opens Sunday 15 November");
    expect(spec.basedOnVoices).toBeNull();
    expect(spec.args).toEqual([]);
    // when it opens, the same link shows the live question
    at(T2);
    const live = (await get(`/share/${code}`).expect(200)).body as J;
    expect(live.topicLine).toBe(page.topicLine);
    expect(live.openGraph.description).not.toContain("Opens Sunday");
  });

  it("T2, 14 Nov 23:00 UTC: the launch question opens (Home returns to normal) and the 17 Nov voices stay hidden", async () => {
    at(T2);
    const h = (await get("/home").expect(200)).body as J;
    expect(h.dailyQuestion.id).toBe(launchId);
    expect(h.dailyQuestion.status).toBe("LIVE");
    expect(h.trending).toEqual([]);
    for (const who of ["guest", "other", "author"] as const)
      expect(hiddenEverywhere(await sweep(who))).toEqual([]);
  });

  it("T3, 15 Nov 23:00 UTC: week 1 has started; the 17 Nov question has not, so its voices stay hidden", async () => {
    at(T3);
    const h = (await get("/home").expect(200)).body as J;
    expect(h.topicOfWeek.status).toBe("LIVE");
    expect(h.topicOfWeek.voiceCount).toBe(0);
    expect(h.topicOfWeek.voicesCount).toBe(0);
    for (const who of ["guest", "other", "author"] as const)
      expect(hiddenEverywhere(await sweep(who))).toEqual([]);
    expect((await get(`/topics/${weekTopicId}`).expect(200)).body.status).toBe(
      "LIVE",
    );
  });

  it("T4, 17 Nov 00:00 UTC: the question is open, and the answer, the reply and the counts show again with no data change", async () => {
    at(T4);
    const guest = await sweep("guest");
    expect(guest).toMatchObject({
      "answer by id": true,
      replies: true,
      "question answers": true,
      "feed trending": true,
      "search answers": true,
      "news list": true,
      "news item": true,
      "people profile": true,
      "search by transcript": true,
      "clip of a voice answer": true,
      "clip play (answer)": true,
    });
    const other = await sweep("other");
    expect(other["my saved"]).toBe(true);
    const author = await sweep("author");
    expect(author["my answers"]).toBe(true);
    expect(author.notifications).toBe(true);
    const h = (await get("/home").expect(200)).body as J;
    expect(h.dailyQuestion.id).toBe(qId);
    expect(h.trending.map((a: J) => a.id)).toEqual([answerId, voiceAnswerId]);
    expect(h.topicOfWeek.voicesCount).toBe(2);
    const q = (await get(`/questions/${qId}`).expect(200)).body as J;
    expect(q.voicesCount).toBe(2);
    const person = (await get(`/people/${authorId}`).expect(200)).body as J;
    expect(person.profile.voicesCount).toBe(2);
    // and back before it opened: hidden again, nothing was deleted
    at(T3);
    expect(hiddenEverywhere(await sweep("guest"))).toEqual([]);
    expect(await db.answer.count({ where: { id: answerId } })).toBe(1);
  });

  it("T4: a share link made once the question is open stops resolving if the clock goes back (card and page rule)", async () => {
    at(T4);
    const token = jwks.sign({ sub: "u-author" });
    const link = await http()
      .post("/api/v1/share/links")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectType: "ANSWER", objectId: answerId });
    expect(link.status).toBeLessThan(300);
    const code = (link.body.code ?? link.body.url?.split("/").pop()) as string;
    expect((await get(`/share/${code}`)).status).toBe(200);
    at(T1);
    expect((await get(`/share/${code}`)).status).toBe(404);
    expect((await get(`/share/${code}/card`)).status).toBe(404);
  });
});
