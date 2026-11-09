/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  Harness,
  mkTopic,
  mkUser,
  pngSize,
  resetDb,
  startHarness,
} from "./helpers";

/** When CARD_OUT is set, the cards the tests draw are also written there (for the picture set). */
const OUT = process.env.CARD_OUT;

describe("reach: share links, pages and cards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.cards.idle(); // draws queued by the last test must finish before the tables are emptied
    await resetDb();
    h.store.objects.clear();
    h.store.failPuts = false;
    h.store.failGets = false;
    h.renders.count = 0;
  });

  const api = (path: string, token?: string) => {
    const r = h.http().get(`/api/v1${path}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };
  const link = (body: object, token?: string) => {
    const r = h.http().post("/api/v1/share/links").send(body);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };
  const savePng = (name: string, png: Buffer) =>
    OUT && writeFileSync(`${OUT}/${name}.png`, png);

  async function world() {
    const topic = await mkTopic(h, 1);
    const category = await h.prisma.category.create({
      data: { slug: "money", name: "Money" },
    });
    const q = await h.prisma.question.create({
      data: {
        topicId: topic.id,
        categoryId: category.id,
        status: "LIVE",
        text: "When salary arrives, how many hours pass before it disappears?",
        answerCount: 12480,
      },
    });
    const author = await mkUser(h, { handle: "ngozi.e", state: "Lagos" });
    const voice = await h.prisma.voiceClip.create({
      data: {
        ownerId: author.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: "voice/x.m4a",
        playMime: "audio/mp4",
        durationMs: 9000,
        maxDurationMs: 10000,
      },
    });
    await h.prisma.transcript.create({
      data: {
        clipId: voice.id,
        status: "READY",
        language: "en",
        text: "They said fuel would come down after the new refinery. My transport money is still double.",
      },
    });
    const answer = await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: author.id,
        kind: "VOICE",
        clipId: voice.id,
        rankScore: 9,
      },
    });
    const poll = await h.prisma.poll.create({
      data: {
        topicId: topic.id,
        kind: "WEEKLY",
        title: "What would make you feel truly fine again?",
        status: "OPEN",
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 86400_000),
        options: {
          create: [
            {
              label: "Stable power and affordable food",
              sortOrder: 1,
              voteCount: 41,
            },
            { label: "A job that pays properly", sortOrder: 2, voteCount: 27 },
            { label: "Safety and justice", sortOrder: 3, voteCount: 21 },
          ],
        },
      },
    });
    return { topic, q, answer, poll, author, category };
  }

  async function summarise(topicId: string, reviewed = true) {
    const reviewer = await mkUser(h);
    await h.prisma.editorialSummary.create({
      data: {
        topicId,
        mainView: "gone within a day",
        mainViewVoices: 6900,
        opposingView: "it lasts if you budget early",
        opposingViewVoices: 3100,
        pollLine: "41% so far",
        nextStepsLine: "n",
        basedOnVoices: 12500,
        basedOnVotes: 8800,
        reviewedById: reviewed ? reviewer.id : null,
        reviewedAt: reviewed ? new Date() : null,
      },
    });
  }

  async function ready(code: string) {
    await h.cards.idle();
    return api(`/share/${code}/card`);
  }

  describe("POST /share/links", () => {
    it("makes a 7-character link for a question, a guest may do it, and the card draws", async () => {
      const w = await world();
      const res = await link({
        objectType: "QUESTION",
        objectId: w.q.id,
      }).expect(201);
      expect(res.body.code).toMatch(/^[a-z0-9]{7}$/);
      expect(res.body.url).toBe(
        `https://usevoices.com/s/${res.body.code}`,
      );
      expect(["PENDING", "READY"]).toContain(res.body.cardStatus);
      expect(res.body.previewText).toContain(w.q.text);
      expect(res.body.previewText).not.toMatch(/[–—]/);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          "cardStatus",
          "code",
          "imageUrl",
          "previewText",
          "squareImageUrl",
          "storyImageUrl",
          "url",
        ].sort(),
      );
      await h.cards.idle();
      const again = await link({
        objectType: "QUESTION",
        objectId: w.q.id,
      }).expect(201);
      expect(again.body.code).toBe(res.body.code);
      expect(again.body.cardStatus).toBe("READY");
      expect(again.body.imageUrl).toBe(
        `https://usevoices.com/api/v1/share/${res.body.code}/card`,
      );
      // story card built in POLISH-C (lead ruling, 6 Nov); the square is not drawn (V-22).
      expect(again.body.storyImageUrl).toBe(
        `https://usevoices.com/api/v1/share/${res.body.code}/story`,
      );
      expect(again.body.squareImageUrl).toBeNull();
      expect(
        res.body.imageUrl === null || res.body.cardStatus === "READY",
      ).toBe(true);
    });

    it("carries the sharer's referral code, and each sharer gets their own link", async () => {
      const w = await world();
      const a = await mkUser(h);
      const b = await mkUser(h);
      const la = (
        await link(
          { objectType: "ANSWER", objectId: w.answer.id },
          a.token,
        ).expect(201)
      ).body;
      const lb = (
        await link(
          { objectType: "ANSWER", objectId: w.answer.id },
          b.token,
        ).expect(201)
      ).body;
      const lg = (
        await link({ objectType: "ANSWER", objectId: w.answer.id }).expect(201)
      ).body;
      expect(new Set([la.code, lb.code, lg.code]).size).toBe(3);
      const row = await h.prisma.shortLink.findUniqueOrThrow({
        where: { code: la.code },
      });
      expect(row).toMatchObject({
        sharerId: a.id,
        referralCode: a.referralCode,
      });
      expect(
        (
          await h.prisma.shortLink.findUniqueOrThrow({
            where: { code: lg.code },
          })
        ).referralCode,
      ).toBeNull();
      expect(
        (
          await link(
            { objectType: "ANSWER", objectId: w.answer.id },
            a.token,
          ).expect(201)
        ).body.code,
      ).toBe(la.code);
    });

    it("parallel calls for one thing make one link and one card", async () => {
      const w = await world();
      const out = await Promise.all(
        Array.from({ length: 5 }, () =>
          link({ objectType: "POLL_RESULT", objectId: w.poll.id }),
        ),
      );
      expect(out.map((o) => o.status)).toEqual([201, 201, 201, 201, 201]);
      await h.cards.idle();
      expect(await h.prisma.shortLink.count()).toBeLessThanOrEqual(5);
      const codes = new Set(out.map((o) => o.body.code));
      for (const code of codes) expect((await ready(code)).status).toBe(200);
    });

    it("works for every object type that exists, and is 404 for ones that do not or may not be shown", async () => {
      const w = await world();
      const topic2 = await mkTopic(h, 2);
      const wr = await h.prisma.weeklyReport.create({
        data: {
          topicId: topic2.id,
          status: "PUBLISHED",
          headline: "What Nigerians said this week",
          mood: "Angry, still counting.",
          basedOnVoices: 100,
          basedOnVotes: 50,
          publishedAt: new Date(),
          themes: [{ label: "Prices rise", count: 30 }],
        },
      });
      const thread = await h.prisma.resultThread.create({
        data: {
          title: "Election Week",
          heldOn: new Date(),
          status: "OPEN",
          createdById: w.author.id,
        },
      });
      const proposer = await mkUser(h);
      const wnq = await h.prisma.question.create({
        data: { topicId: w.topic.id, text: "What next?", status: "LIVE" },
      });
      await h.prisma.proposal.create({
        data: {
          questionId: wnq.id,
          authorId: proposer.id,
          body: "Publish a weekly power schedule.",
          supportCount: 312,
        },
      });
      const ok: [string, string][] = [
        ["QUESTION", w.q.id],
        ["ANSWER", w.answer.id],
        ["POLL_RESULT", w.poll.id],
        ["WEEKLY_REPORT", wr.id],
        ["PROFILE", w.author.id],
        ["CATEGORY", w.category.id],
        ["RESULT_THREAD", thread.id],
        ["WHAT_NEXT_SUMMARY", w.topic.id],
      ];
      for (const [objectType, objectId] of ok) {
        const r = await link({ objectType, objectId });
        expect({ objectType, status: r.status }).toEqual({
          objectType,
          status: 201,
        });
      }
      const draftQ = await h.prisma.question.create({
        data: { text: "Draft?", status: "DRAFT" },
      });
      const draftWr = await h.prisma.weeklyReport.create({
        data: { topicId: (await mkTopic(h, 3)).id, status: "DRAFT" },
      });
      const scheduledPoll = await h.prisma.poll.create({
        data: {
          kind: "FLASH",
          title: "t",
          status: "SCHEDULED",
          // B-H1 (lead ruling WF, 6 Nov): a poll is scheduled by its dates, so this one opens tomorrow.
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 2 * 86_400_000),
        },
      });
      const gone = await h.prisma.answer.create({
        data: {
          questionId: w.q.id,
          authorId: w.author.id,
          kind: "TEXT",
          body: "x",
          status: "REMOVED",
        },
      });
      const none = "3f1b1c34-0000-4000-8000-000000000000";
      for (const [objectType, objectId] of [
        ["QUESTION", none],
        ["QUESTION", draftQ.id],
        ["ANSWER", none],
        ["ANSWER", gone.id],
        ["POLL_RESULT", scheduledPoll.id],
        ["WEEKLY_REPORT", draftWr.id],
        ["WHAT_NEXT_SUMMARY", topic2.id],
        ["PROFILE", none],
      ])
        expect({
          objectType,
          status: (await link({ objectType, objectId })).status,
        }).toEqual({ objectType, status: 404 });
    });

    it("422 for a bad type, id or extra field; 401 for a stale token", async () => {
      for (const body of [
        {},
        {
          objectType: "NOPE",
          objectId: "3f1b1c34-0000-4000-8000-000000000000",
        },
        { objectType: "QUESTION", objectId: "x" },
        {
          objectType: "QUESTION",
          objectId: "3f1b1c34-0000-4000-8000-000000000000",
          extra: 1,
        },
        {
          objectType: "QUESTION",
          objectId: "3f1b1c34-0000-4000-8000-000000000000",
          language: "English please",
        },
      ])
        expect((await link(body).expect(422)).body.error.code).toBe(
          "VALIDATION_FAILED",
        );
      await link(
        {
          objectType: "QUESTION",
          objectId: "3f1b1c34-0000-4000-8000-000000000000",
        },
        "bad.token.x",
      ).expect(401);
    });

    it("does not draw twice for the same words, and draws again when the numbers move", async () => {
      const w = await world();
      const first = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      await h.cards.idle();
      expect(h.renders.count).toBe(1);
      await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
        201,
      );
      await h.cards.idle();
      expect(h.renders.count).toBe(1);
      const opt = await h.prisma.pollOption.findFirstOrThrow({
        where: { pollId: w.poll.id, sortOrder: 2 },
      });
      await h.prisma.pollOption.update({
        where: { id: opt.id },
        data: { voteCount: 60 },
      });
      const moved = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      expect(moved.code).toBe(first.code);
      expect(moved.cardStatus).toBe("PENDING");
      await h.cards.idle();
      expect(h.renders.count).toBe(2);
    });
  });

  describe("GET /share/{code}/card", () => {
    it("is the one 1200x630 PNG for every kind, cached, stored in the bucket; ?size= is ignored", async () => {
      const w = await world();
      await summarise(w.topic.id);
      const kinds: [string, string][] = [
        ["QUESTION", w.q.id],
        ["ANSWER", w.answer.id],
        ["POLL_RESULT", w.poll.id],
      ];
      for (const [objectType, objectId] of kinds) {
        const { code } = (await link({ objectType, objectId }).expect(201))
          .body;
        const card = await ready(code);
        expect(card.status).toBe(200);
        expect(card.headers["content-type"]).toBe("image/png");
        expect(card.headers["cache-control"]).toBe("public, max-age=3600");
        expect(pngSize(card.body)).toEqual({ w: 1200, h: 630 });
        for (const q of ["?size=story", "?size=square", "?size=huge"])
          expect(
            (await api(`/share/${code}/card${q}`).expect(200)).body.equals(
              card.body,
            ),
          ).toBe(true);
        savePng(objectType, card.body);
      }
      expect(
        [...h.store.objects.keys()].every((k) => k.startsWith("share/")),
      ).toBe(true);
      expect(h.store.objects.size).toBe(3);
      expect(
        await h.prisma.storedFile.count({ where: { kind: "SHARE_CARD" } }),
      ).toBe(3);
    });

    it("draws the weekly card", async () => {
      const topic = await mkTopic(h, 2);
      const wr = await h.prisma.weeklyReport.create({
        data: {
          topicId: topic.id,
          status: "PUBLISHED",
          headline: "What Nigerians said this week",
          mood: "Angry about prices, still counting every naira.",
          basedOnVoices: 11872,
          basedOnVotes: 9406,
          emotions: [
            { name: "Anger", share: 44, change: 6 },
            { name: "Anxiety", share: 27, change: -3 },
            { name: "Hope", share: 17, change: 1 },
          ],
          publishedAt: new Date(),
          themes: [
            { label: "Prices rise faster than pay", count: 3200 },
            { label: "Discounts that are not real", count: 2500 },
            { label: "Fuel and transport eat the budget", count: 1900 },
          ],
        },
      });
      const { code } = (
        await link({ objectType: "WEEKLY_REPORT", objectId: wr.id }).expect(201)
      ).body;
      const r = await ready(code);
      expect(r.status).toBe(200);
      expect(pngSize(r.body)).toEqual({ w: 1200, h: 630 });
      savePng("WEEKLY_REPORT", r.body);
    });

    it("202 while it is being made, 404 for an unknown or failed card, 503 when storage cannot be read", async () => {
      const w = await world();
      await h.prisma.shortLink.create({
        data: {
          code: "pend123",
          objectType: "QUESTION",
          objectId: w.q.id,
          cards: { create: { topicLine: "t", status: "PENDING" } },
        },
      });
      expect((await api("/share/pend123/card")).status).toBe(202);
      await h.cards.idle();
      expect((await api("/share/pend123/card")).status).toBe(200);
      expect(
        (await api("/share/nosuchc/card").expect(404)).body.error.code,
      ).toBe("NOT_FOUND");
      h.store.failGets = true;
      const down = await api("/share/pend123/card").expect(503);
      expect(down.body.error.code).toBe("UNAVAILABLE");
      h.store.failGets = false;
      h.store.failPuts = true;
      const { code } = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      await h.cards.idle();
      expect(
        (await api(`/share/${code}/card`).expect(404)).body.error.code,
      ).toBe("NOT_FOUND");
      expect(
        (
          await h.prisma.shareCard.findFirstOrThrow({
            where: { link: { code } },
          })
        ).status,
      ).toBe("FAILED");
      h.store.failPuts = false;
      const retry = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      expect(retry.cardStatus).toBe("PENDING");
      expect((await ready(code)).status).toBe(200);
    });

    it("draws again when the stored image has gone missing", async () => {
      const w = await world();
      const { code } = (
        await link({ objectType: "QUESTION", objectId: w.q.id }).expect(201)
      ).body;
      expect((await ready(code)).status).toBe(200);
      h.store.objects.clear();
      expect((await api(`/share/${code}/card`)).status).toBe(202);
      expect((await ready(code)).status).toBe(200);
    });

    it("text in a post can never act as a drawing command", async () => {
      const w = await world();
      const q = await h.prisma.question.create({
        data: {
          status: "LIVE",
          text: "100% of %w and \\n @/etc/passwd label:x -draw",
          topicId: w.topic.id,
        },
      });
      const { code } = (
        await link({ objectType: "QUESTION", objectId: q.id }).expect(201)
      ).body;
      const r = await ready(code);
      expect(r.status).toBe(200);
      pngSize(r.body);
    });
  });

  describe("GET /share/{code}", () => {
    it("is public and gives the question page: arguments, lean, poll, voice, proposals", async () => {
      const w = await world();
      await summarise(w.topic.id);
      const proposer = await mkUser(h, { handle: "ada.p" });
      await h.prisma.proposal.create({
        data: {
          questionId: w.q.id,
          authorId: proposer.id,
          body: "Publish a power schedule.",
          supportCount: 312,
          challengeCount: 41,
        },
      });
      await h.prisma.proposal.create({
        data: {
          questionId: w.q.id,
          authorId: proposer.id,
          body: "Hidden.",
          status: "REMOVED",
          supportCount: 999,
        },
      });
      const { code } = (
        await link({ objectType: "QUESTION", objectId: w.q.id }).expect(201)
      ).body;
      const res = await api(`/share/${code}`).expect(200);
      const p = res.body;
      expect(res.headers["cache-control"]).toBe("public, max-age=30");
      expect(p).toMatchObject({
        code,
        objectType: "QUESTION",
        topicLine: w.q.text,
        countryAndTheme: "Nigeria · Week 1: Are You Really Fine?",
        leanLine: "Most voices so far lean towards: gone within a day",
        basedOnVoices: 12500,
        summaryLabel: "AI summary, checked by an editor",
        cardFallback: false,
        ctaLabel: "Add your voice",
        proposalCount: 1,
        news: null,
        report: null,
      });
      expect(p.arguments).toEqual([
        { text: "gone within a day", voices: 6900 },
        { text: "it lasts if you budget early", voices: 3100 },
      ]);
      expect(p.poll.options).toHaveLength(3);
      expect(p.poll.options[0]).toMatchObject({
        label: "Stable power and affordable food",
        votes: 41,
        percent: 46.1,
      });
      expect(p.poll.myVote).toBeNull();
      expect(p.topProposal).toMatchObject({
        body: "Publish a power schedule.",
        label: "PROPOSED",
        supportCount: 312,
        isMine: false,
        myStance: null,
      });
      expect(p.featuredVoice.author.handle).toBe("ngozi.e");
      expect(p.featuredVoice.clip.transcript.text).toContain("transport money");
      expect(p.transcript).toContain("transport money");
      expect(p.openGraph).toEqual({
        title: w.q.text,
        description: "Most voices so far lean towards: gone within a day",
        imageUrl: `https://usevoices.com/api/v1/share/${code}/card`,
        url: `https://usevoices.com/s/${code}`,
      });
      expect(JSON.stringify(p)).not.toMatch(/[—]/);
    });

    it("never shows an unreviewed AI summary, and never claims a result", async () => {
      const w = await world();
      await summarise(w.topic.id, false);
      const { code } = (
        await link({ objectType: "QUESTION", objectId: w.q.id }).expect(201)
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p.arguments).toEqual([]);
      expect(p.leanLine).toBeNull();
      expect(p.summaryLabel).toBe("Based on the voices so far");
      expect(JSON.stringify(p)).not.toContain("gone within a day");
    });

    it("hides poll numbers on a live poll that shows no live results", async () => {
      const w = await world();
      await h.prisma.poll.update({
        where: { id: w.poll.id },
        data: { showLiveResults: false },
      });
      const { code } = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p.poll.totalVotes).toBe(0);
      expect(p.poll.options[0]).toEqual({
        id: expect.any(String),
        label: "Stable power and affordable food",
      });
      expect(p.poll.leadingOptionId).toBeNull();
      expect(p.leanLine).toBeNull();
    });

    it("poll page: lean wording says 'so far' and never 'agree'", async () => {
      const w = await world();
      const { code } = (
        await link({ objectType: "POLL_RESULT", objectId: w.poll.id }).expect(
          201,
        )
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p.topicLine).toBe("What would make you feel truly fine again?");
      expect(p.leanLine).toBe("People are split so far.");
      expect(p.basedOnVoices).toBe(89);
    });

    it("a flagged voice falls back to the topic and the call to action, on the page and the card", async () => {
      const w = await world();
      const reporter = await mkUser(h);
      await h.prisma.report.create({
        data: {
          reporterId: reporter.id,
          targetType: "ANSWER",
          targetId: w.answer.id,
          reason: "SCAM_OR_SPAM",
        },
      });
      const { code } = (
        await link({ objectType: "ANSWER", objectId: w.answer.id }).expect(201)
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p).toMatchObject({
        cardFallback: true,
        featuredVoice: null,
        transcript: null,
        news: null,
        leanLine: null,
        topicLine: w.q.text,
      });
      expect(p.arguments).toEqual([]);
      await h.cards.idle();
      const card = await h.prisma.shareCard.findFirstOrThrow({
        where: { link: { code } },
      });
      expect(card).toMatchObject({
        status: "FALLBACK",
        argumentChips: [],
        leanLine: null,
      });
      expect(card.storyFileId).not.toBeNull();
      const img = await api(`/share/${code}/card`).expect(200);
      savePng("FALLBACK", img.body);
      // held posts fall back too; removed posts vanish
      await h.prisma.answer.update({
        where: { id: w.answer.id },
        data: { status: "REMOVED" },
      });
      await api(`/share/${code}`).expect(404);
    });

    it("a news voice carries its tag; the page never shows a clip file", async () => {
      const w = await world();
      const a = await h.prisma.answer.create({
        data: {
          questionId: w.q.id,
          authorId: w.author.id,
          kind: "TEXT",
          body: "Fuel price up again at my station.",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        },
      });
      const { code } = (
        await link({ objectType: "ANSWER", objectId: a.id }).expect(201)
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p.news).toMatchObject({ tag: "UNVERIFIED_NEWS" });
      expect(p.featuredVoice.news.tag).toBe("UNVERIFIED_NEWS");
      expect(JSON.stringify(p)).not.toMatch(/playKey|rawKey|voice\/x\.m4a/);
      await ready(code);
      savePng("NEWS", (await api(`/share/${code}/card`).expect(200)).body);
    });

    it("an anonymous voice carries no author", async () => {
      const w = await world();
      const a = await h.prisma.answer.create({
        data: {
          questionId: w.q.id,
          authorId: w.author.id,
          kind: "TEXT",
          body: "Quiet voice.",
          anonymous: true,
        },
      });
      const { code } = (
        await link({ objectType: "ANSWER", objectId: a.id }).expect(201)
      ).body;
      const p = (await api(`/share/${code}`).expect(200)).body;
      expect(p.featuredVoice.author).toBeNull();
      expect(JSON.stringify(p)).not.toContain("ngozi.e");
    });

    it("404 for an unknown code, a malformed one, and one whose post is gone", async () => {
      await api("/share/abcdefg").expect(404);
      await api("/share/not-a-code!").expect(404);
      await api("/share/ABCDEFG").expect(404);
    });
  });

  describe("POST /share/{code}/events", () => {
    async function oneLink() {
      const w = await world();
      const { code } = (
        await link({ objectType: "ANSWER", objectId: w.answer.id }).expect(201)
      ).body;
      await h.cards.idle();
      return { w, code };
    }

    it("records a guest intent, a link open and an Add your voice tap (204)", async () => {
      const { w, code } = await oneLink();
      const gid = "11111111-2222-4333-8444-555555555555";
      const ev = (b: object, guest = true) => {
        const r = h.http().post(`/api/v1/share/${code}/events`).send(b);
        return guest ? r.set("X-Guest-Id", gid) : r;
      };
      await ev({ kind: "intent", target: "WHATSAPP" }).expect(204);
      await ev({ kind: "link_open" }).expect(204);
      await ev({ kind: "add_voice_tap" }, false).expect(204);
      const rows = await h.prisma.shareEvent.findMany({
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => [r.kind, r.target, r.guestId, r.userId])).toEqual([
        ["intent", "WHATSAPP", gid, null],
        ["link_open", null, gid, null],
        ["add_voice_tap", null, null, null],
      ]);
      expect(
        (
          await h.prisma.answer.findUniqueOrThrow({
            where: { id: w.answer.id },
          })
        ).shareCount,
      ).toBe(1);
    });

    it("records a signed-in person by account, not by guest id", async () => {
      const { code } = await oneLink();
      const u = await mkUser(h);
      await h
        .http()
        .post(`/api/v1/share/${code}/events`)
        .set("Authorization", `Bearer ${u.token}`)
        .set("X-Guest-Id", "11111111-2222-4333-8444-555555555555")
        .send({ kind: "published_from_link" })
        .expect(204);
      const row = await h.prisma.shareEvent.findFirstOrThrow();
      expect(row).toMatchObject({
        userId: u.id,
        guestId: null,
        kind: "published_from_link",
      });
    });

    it("404 for an unknown code; 422 for a bad kind, target, extra field or guest id; 401 for a stale token", async () => {
      const { code } = await oneLink();
      const post = (c: string, b: object) =>
        h.http().post(`/api/v1/share/${c}/events`).send(b);
      await post("abcdefg", { kind: "intent" }).expect(404);
      await post(code, { kind: "wat" }).expect(422);
      await post(code, { kind: "intent", target: "MYSPACE" }).expect(422);
      await post(code, { kind: "intent", extra: 1 }).expect(422);
      await post(code, {}).expect(422);
      await post(code, { kind: "intent" })
        .set("X-Guest-Id", "not-a-uuid")
        .expect(422);
      await post(code, { kind: "intent" })
        .set("Authorization", "Bearer bad.token.x")
        .expect(401);
      expect(
        await h.prisma.shareEvent.count({ where: { link: { code } } }),
      ).toBe(0);
    });
  });

  it("rate limit: 60 link makes a minute, 429 after", async () => {
    const h2 = await startHarness();
    try {
      let last = 0;
      for (let i = 0; i < 61; i++) {
        const r = await h2.http().post("/api/v1/share/links").send({});
        last = r.status;
        if (i < 60) expect(r.status).toBe(422);
      }
      expect(last).toBe(429);
    } finally {
      await h2.close();
    }
  }, 60000);
});
