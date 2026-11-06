/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { MemoryCardStore, mkTopic, pngSize, resetDb } from "./helpers";
import type { CardSize, CardSpec } from "../../src/reach/card-renderer";

jest.setTimeout(120000);

/** POLISH-C server: the story card, own-post report, report idempotency, the redraw race, LIKE escaping. */
const OUT = process.env.POLISH_OUT;

describe("polish-c", () => {
  let app: INestApplication;
  let jwks: TestJwks;
  let prisma: import("../../src/common/prisma/prisma.service").PrismaService;
  let cards: import("../../src/reach/share.service").ShareCardService;
  let shares: import("../../src/reach/share.service").ShareService;
  let deletion: import("../../src/me/deletion.service").DeletionService;
  let real: import("../../src/reach/card-renderer").ResvgCardRenderer;
  const store = new MemoryCardStore();
  let n = 0;

  beforeAll(async () => {
    jwks = new TestJwks();
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    process.env.THROTTLE_LIMIT = "1000000";
    process.env.MEDIA_WORKER = "off";
    process.env.NODE_ENV = "test";
    const { AppModule } = await import("../../src/app.module.js");
    const { configureApp } = await import("../../src/app-config.js");
    const { CARD_STORE } = await import("../../src/reach/card-store.js");
    const { CARD_RENDERER, ResvgCardRenderer } =
      await import("../../src/reach/card-renderer.js");
    const { PrismaService } =
      await import("../../src/common/prisma/prisma.service.js");
    const { ShareCardService, ShareService } =
      await import("../../src/reach/share.service.js");
    const { DeletionService } =
      await import("../../src/me/deletion.service.js");
    real = new ResvgCardRenderer();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CARD_STORE)
      .useValue(store)
      .overrideProvider(CARD_RENDERER)
      .useValue({
        render: (spec: CardSpec, size?: CardSize) => real.render(spec, size),
      })
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    cards = app.get(ShareCardService);
    shares = app.get(ShareService);
    deletion = app.get(DeletionService);
    await resetDb();
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await cards.idle();
    await app.close();
    await jwks.stop();
  });

  const http = () => request(app.getHttpServer() as App);
  async function person(handle?: string) {
    n++;
    const wawuId = `wawu-${randomUUID()}`;
    const u = await prisma.user.create({
      data: {
        wawuId,
        handle:
          handle ??
          `pc${Date.now().toString(36)}${n}${Math.floor(Math.random() * 1e3)}`.slice(
            0,
            20,
          ),
        referralCode: randomUUID().slice(0, 12),
        displayName: "Test Person",
        state: "Lagos",
      },
    });
    return { id: u.id, auth: `Bearer ${jwks.sign({ sub: wawuId })}` };
  }

  // ---- 1. the story card ----
  describe("story card", () => {
    const base: CardSpec = {
      kind: "question",
      label: "Nigeria · Today's question",
      headline:
        "When salary arrives, how many hours pass before it disappears?",
      args: [
        { text: "Gone in a day: rent and family first", voices: 6900 },
        { text: "It lasts if you budget early", voices: 3100 },
        { text: "Side hustle is the real salary", voices: 2480 },
      ],
      rows: [],
      pollOpen: false,
      quote: null,
      summary: "Most voices so far lean towards: gone within a day.",
      basedOnVoices: 12480,
      updated: "12 min ago",
      newsTag: null,
      fallback: false,
      url: "wawuafrica.com/voices",
    };
    const specs: Record<string, CardSpec> = {
      question: base,
      poll: {
        ...base,
        kind: "poll",
        pollOpen: true,
        args: [],
        rows: [
          { label: "Yes", pct: 62 },
          { label: "No", pct: 30 },
          { label: "Not sure", pct: 8 },
        ],
      },
      voice: {
        ...base,
        kind: "voice",
        args: [],
        headline: "@ngozi.e on salary day",
        quote:
          "By the 3rd I have paid rent, sent money home and the rest is gone. I plan every month and it still disappears.",
        newsTag: "verified",
      },
      weekly: {
        ...base,
        kind: "weekly",
        args: [],
        rows: [
          { label: "Lagos", pct: 40 },
          { label: "Abuja", pct: 35 },
        ],
      },
      fallback: { ...base, fallback: true, args: [], summary: null },
    };

    it("renders 1080x1920 for every kind, and the square card stays 1200x630", async () => {
      for (const [name, spec] of Object.entries(specs)) {
        const story = await real.render(spec, "story");
        const square = await real.render(spec);
        expect(pngSize(story)).toEqual({ w: 1080, h: 1920 });
        expect(pngSize(square)).toEqual({ w: 1200, h: 630 });
        if (OUT) {
          writeFileSync(`${OUT}/story-${name}.png`, story);
          writeFileSync(`${OUT}/square-${name}.png`, square);
        }
      }
    });

    it("GET /share/{code}/story serves it, 404 for unknown; ?size= on /card stays ignored", async () => {
      const topic = await mkTopic({ prisma } as never, 91);
      const category = await prisma.category.create({
        data: { slug: `c${n}${Date.now()}`, name: "Money" },
      });
      const q = await prisma.question.create({
        data: {
          topicId: topic.id,
          categoryId: category.id,
          status: "LIVE",
          text: "When salary arrives, how many hours pass before it disappears?",
        },
      });
      const v = await shares.createLink(null, {
        objectType: "QUESTION",
        objectId: q.id,
      });
      await cards.idle();
      const story = await http().get(`/api/v1/share/${v.code}/story`);
      expect(story.status).toBe(200);
      expect(story.headers["content-type"]).toBe("image/png");
      expect(pngSize(story.body)).toEqual({ w: 1080, h: 1920 });
      const sq = await http().get(`/api/v1/share/${v.code}/card?size=story`);
      expect(pngSize(sq.body)).toEqual({ w: 1200, h: 630 });
      expect((await http().get(`/api/v1/share/zzzzzzz/story`)).status).toBe(
        404,
      );
      expect((await http().get(`/api/v1/share/bad/story`)).status).toBe(404);
      // nothing stored for it: only the one card file exists
      expect(
        await prisma.storedFile.count({ where: { kind: "SHARE_CARD" } }),
      ).toBe(1);
    });
  });

  // ---- 2 and 3. reports ----
  describe("result post reports", () => {
    async function post(authorId: string) {
      const thread = await prisma.resultThread.create({
        data: {
          title: "t",
          heldOn: new Date("2027-01-16T00:00:00Z"),
          status: "OPEN",
          createdById: "seed",
        },
      });
      return prisma.resultPost.create({
        data: {
          threadId: thread.id,
          authorId,
          state: "Lagos",
          lga: "Ikeja",
          ward: "W1",
          pollingUnit: "PU1",
          accredited: 10,
          votesCast: 9,
          rejected: 1,
          idempotencyKey: randomUUID(),
        },
      });
    }
    const report = (auth: string, body: object) =>
      http().post("/api/v1/reports").set("Authorization", auth).send(body);

    it("your own result post: a plain 4xx with the exact message, no row", async () => {
      const me = await person();
      const p = await post(me.id);
      const r = await report(me.auth, {
        targetType: "RESULT_POST",
        targetId: p.id,
        reason: "SCAM_OR_SPAM",
      });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toBe("You cannot report your own post.");
      expect(await prisma.report.count({ where: { targetId: p.id } })).toBe(0);
    });

    it("20 parallel identical reports make 1 row and 1 moderation count", async () => {
      const author = await person();
      const me = await person();
      const p = await post(author.id);
      const body = {
        targetType: "RESULT_POST",
        targetId: p.id,
        reason: "OTHER",
        note: "Wrong numbers",
      };
      const rs = await Promise.all(
        Array.from({ length: 20 }, () => report(me.auth, body)),
      );
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(
        await prisma.report.count({
          where: { targetId: p.id, reporterId: me.id },
        }),
      ).toBe(1);
      const item = await prisma.moderationItem.findFirstOrThrow({
        where: { targetId: p.id, queue: "REPORTED" },
      });
      expect(item.reportCount).toBe(1);
    });
  });

  // ---- 4a. the redraw race ----
  describe("overlapping redraws", () => {
    const rename = (id: string, handle: string) =>
      prisma.user.update({ where: { id }, data: { handle } });
    const link = (id: string) =>
      shares.createLink(null, { objectType: "PROFILE", objectId: id });
    /** Live image rows under the code that the card does not name and that are not marked: the stale ones. */
    async function stale(code: string) {
      const l = await prisma.shortLink.findUniqueOrThrow({
        where: { code },
        include: { cards: true },
      });
      const linked = l.cards[0]?.storyFileId ?? null;
      const files = await prisma.storedFile.findMany({
        where: {
          kind: "SHARE_CARD",
          key: { startsWith: `share/${code}/` },
          purgedAt: null,
        },
      });
      return {
        linked,
        stale: files.filter((f) => f.id !== linked && !f.purgeRequestedAt),
        linkedMarked: files.some((f) => f.id === linked && f.purgeRequestedAt),
      };
    }

    it("the slower redraw (held before its transaction) cannot leave the faster one's image unmarked", async () => {
      for (let round = 0; round < 3; round++) {
        const p = await person();
        await rename(p.id, `ra${round}${Date.now().toString(36)}${n}`);
        const { code } = await link(p.id);
        await cards.idle();
        // slow request: reads the subject (handle B) and is held just before the card transaction
        await rename(p.id, `rb${round}${Date.now().toString(36)}${n}`);
        let release!: () => void;
        const hold = new Promise<void>((r) => (release = r));
        let entered!: () => void;
        const e = new Promise<void>((r) => (entered = r));
        const orig = cards.ownerOf.bind(cards);
        let armed = true;
        cards.ownerOf = async (...a) => {
          if (armed) {
            armed = false;
            entered();
            await hold;
          }
          return orig(...a);
        };
        const slow = link(p.id);
        await e;
        cards.ownerOf = orig;
        // fast request: handle C, redraws, READY
        await rename(p.id, `rc${round}${Date.now().toString(36)}${n}`);
        await link(p.id);
        await cards.idle();
        const mid = await stale(code);
        expect(mid.stale).toHaveLength(0);
        release();
        await slow;
        await cards.idle();
        const end = await stale(code);
        expect(end.stale).toHaveLength(0);
        expect(end.linked).not.toBeNull();
        expect(end.linkedMarked).toBe(false);
      }
    });

    it("a storm of renames and redraws leaves 0 stale objects and one live card", async () => {
      for (let r = 0; r < 4; r++) {
        const p = await person();
        const { code } = await link(p.id);
        await cards.idle();
        await Promise.all(
          Array.from({ length: 10 }, async (_, i) => {
            await new Promise((ok) => setTimeout(ok, Math.random() * 40));
            await rename(p.id, `s${r}x${i}${Date.now().toString(36)}${n}`);
            await link(p.id);
          }),
        );
        await cards.idle();
        await link(p.id);
        await cards.idle();
        const end = await stale(code);
        expect(end.stale).toHaveLength(0);
        expect(end.linked).not.toBeNull();
        expect(end.linkedMarked).toBe(false);
      }
    });
  });

  // ---- 4b. LIKE escaping on deletion ----
  describe("deletion marks only the person's own share files", () => {
    it("a code with _ or % marks only its own files", async () => {
      const mk = async (userId: string, code: string) => {
        const l = await prisma.shortLink.create({
          data: { code, objectType: "PROFILE", objectId: userId },
        });
        await prisma.shareCard.create({
          data: { linkId: l.id, topicLine: "t" },
        });
        await prisma.storedFile.create({
          data: {
            kind: "SHARE_CARD",
            key: `share/${code}/card-aaaaaaaaaaaa.png`,
            mime: "image/png",
            confirmedAt: new Date(),
          },
        });
      };
      const marked = async (base: string) =>
        (
          await prisma.storedFile.findMany({
            where: { key: { startsWith: `share/${base}` } },
          })
        )
          .filter((f) => f.purgeRequestedAt)
          .map((f) => f.key.split("/")[1])
          .sort();
      const retire = (id: string) =>
        prisma.user.update({
          where: { id },
          data: {
            status: "DELETION_PENDING",
            deletionRequestedAt: new Date(Date.now() - 20 * 86_400_000),
          },
        });
      const base = Math.random().toString(36).slice(2, 7);
      const underscore = { mine: `${base}_z`, other: `${base}qz` };
      const percent = { mine: `${base}%`, other: `${base}zz` };
      const xs = [await person(), await person()];
      const ys = [await person(), await person()];
      await mk(xs[0].id, underscore.mine);
      await mk(ys[0].id, underscore.other);
      await mk(xs[1].id, percent.mine);
      await mk(ys[1].id, percent.other);
      await retire(xs[0].id);
      await deletion.purge(xs[0].id);
      expect(await marked(base)).toEqual([underscore.mine]);
      await retire(xs[1].id);
      await deletion.purge(xs[1].id);
      expect(await marked(base)).toEqual(
        [underscore.mine, percent.mine].sort(),
      );
    });
  });
});
