/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { Harness, mkTopic, mkUser, resetDb, startHarness } from "./helpers";

describe("reach: ad slot and analytics events", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(resetDb);

  const GID = "11111111-2222-4333-8444-555555555555";
  const placement = (q = "", token?: string, guest?: string) => {
    let r = h.http().get(`/api/v1/ads/placement${q}`);
    if (token) r = r.set("Authorization", `Bearer ${token}`);
    if (guest) r = r.set("X-Guest-Id", guest);
    return r;
  };
  const adEvent = (
    id: string,
    body: object,
    guest?: string,
    token?: string,
  ) => {
    let r = h.http().post(`/api/v1/ads/${id}/events`).send(body);
    if (guest) r = r.set("X-Guest-Id", guest);
    if (token) r = r.set("Authorization", `Bearer ${token}`);
    return r;
  };

  async function ad(over: Record<string, unknown> = {}) {
    const admin = await mkUser(h);
    return h.prisma.ad.create({
      data: {
        brand: "Acme Bank",
        kind: "FEED_CARD",
        status: "APPROVED",
        headline: "Save for what matters",
        body: "Open an account.",
        linkUrl: "https://example.com",
        ctaLabel: "Learn more",
        approvedAt: new Date(),
        createdById: admin.id,
        ...over,
      },
    });
  }

  describe("GET /ads/placement", () => {
    it("gives a guest the approved ad, labelled, and nothing private", async () => {
      const a = await ad();
      await ad({ status: "DRAFT", headline: "draft" });
      await ad({ status: "PAUSED", headline: "paused" });
      const res = (await placement().expect(200)).body;
      expect(res).toEqual({
        ad: {
          id: a.id,
          kind: "FEED_CARD",
          brand: "Acme Bank",
          label: "Sponsored",
          headline: "Save for what matters",
          body: "Open an account.",
          imageUrl: null,
          audioClipId: null,
          linkUrl: "https://example.com",
          ctaLabel: "Learn more",
        },
      });
    });

    it("null when nothing is approved, outside its dates, or of another kind", async () => {
      expect((await placement().expect(200)).body).toEqual({ ad: null });
      await ad({ endsOn: new Date(Date.now() - 3 * 86400_000) });
      await ad({ startsOn: new Date(Date.now() + 3 * 86400_000) });
      expect((await placement().expect(200)).body).toEqual({ ad: null });
      await ad({ kind: "BANNER" });
      expect((await placement("?kind=FEED_CARD").expect(200)).body).toEqual({
        ad: null,
      });
      const b = (await placement("?kind=BANNER").expect(200)).body;
      expect(b.ad.label).toBe("Ad");
    });

    it("never beside a sensitive question or topic", async () => {
      await ad();
      const t = await mkTopic(h);
      const plain = await h.prisma.question.create({
        data: { topicId: t.id, text: "q", status: "LIVE" },
      });
      const sensitive = await h.prisma.question.create({
        data: { text: "politics", status: "LIVE", sensitive: true },
      });
      await h.prisma.topic.update({
        where: { id: t.id },
        data: { sensitive: true },
      });
      expect(
        (await placement(`?questionId=${sensitive.id}`).expect(200)).body.ad,
      ).toBeNull();
      expect(
        (await placement(`?questionId=${plain.id}`).expect(200)).body.ad,
      ).toBeNull(); // sensitive topic
      await h.prisma.topic.update({
        where: { id: t.id },
        data: { sensitive: false },
      });
      expect(
        (await placement(`?questionId=${plain.id}`).expect(200)).body.ad,
      ).not.toBeNull();
    });

    it("targets by category and state", async () => {
      const money = await h.prisma.category.create({
        data: { slug: "money", name: "Money" },
      });
      const other = await h.prisma.category.create({
        data: { slug: "food", name: "Food" },
      });
      await ad({ categoryIds: [money.id] });
      expect((await placement().expect(200)).body.ad).toBeNull();
      expect(
        (await placement(`?categoryId=${other.id}`).expect(200)).body.ad,
      ).toBeNull();
      expect(
        (await placement(`?categoryId=${money.id}`).expect(200)).body.ad,
      ).not.toBeNull();
      await resetDb();
      await ad({ states: ["Lagos"] });
      const lagos = await mkUser(h, { state: "Lagos" });
      const kano = await mkUser(h, { state: "Kano" });
      expect((await placement().expect(200)).body.ad).toBeNull();
      expect((await placement("", kano.token).expect(200)).body.ad).toBeNull();
      expect(
        (await placement("", lagos.token).expect(200)).body.ad,
      ).not.toBeNull();
    });

    it("stops at the daily cap for that person, not for others", async () => {
      const a = await ad({ frequencyCapPerDay: 2 });
      for (let i = 0; i < 2; i++)
        await adEvent(a.id, { kind: "IMPRESSION" }, GID).expect(204);
      expect(
        (await placement("", undefined, GID).expect(200)).body.ad,
      ).toBeNull();
      expect(
        (
          await placement(
            "",
            undefined,
            "99999999-2222-4333-8444-555555555555",
          ).expect(200)
        ).body.ad,
      ).not.toBeNull();
      const u = await mkUser(h);
      await adEvent(a.id, { kind: "TAP" }, undefined, u.token).expect(204); // a tap is not a view
      expect((await placement("", u.token).expect(200)).body.ad).not.toBeNull();
      await adEvent(a.id, { kind: "IMPRESSION" }, undefined, u.token).expect(
        204,
      );
      await adEvent(a.id, { kind: "IMPRESSION" }, undefined, u.token).expect(
        204,
      );
      expect((await placement("", u.token).expect(200)).body.ad).toBeNull();
    });

    it("rotates to the ad this person has seen least today", async () => {
      const a = await ad({ approvedAt: new Date(Date.now() - 5000) });
      const b = await ad();
      expect((await placement("", undefined, GID).expect(200)).body.ad.id).toBe(
        a.id,
      );
      await adEvent(a.id, { kind: "IMPRESSION" }, GID).expect(204);
      expect((await placement("", undefined, GID).expect(200)).body.ad.id).toBe(
        b.id,
      );
    });

    it("422 for a bad kind, id or guest id; 401 for a stale token", async () => {
      await placement("?kind=POSTER").expect(422);
      await placement("?questionId=abc").expect(422);
      await placement("?other=1").expect(422);
      await placement("", undefined, "nope").expect(422);
      await placement("", "bad.token.x").expect(401);
    });
  });

  describe("POST /ads/{adId}/events", () => {
    it("records views, taps and listens for a guest and a signed-in person", async () => {
      const a = await ad();
      const u = await mkUser(h);
      await adEvent(a.id, { kind: "IMPRESSION" }, GID).expect(204);
      await adEvent(a.id, { kind: "TAP" }, GID).expect(204);
      await adEvent(a.id, { kind: "LISTEN" }, GID, u.token).expect(204);
      const rows = await h.prisma.adEvent.findMany({
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => [r.kind, r.guestId, r.userId])).toEqual([
        ["IMPRESSION", GID, null],
        ["TAP", GID, null],
        ["LISTEN", null, u.id],
      ]);
    });

    it("404 for an unknown ad, an ad that is not approved, or a bad id; 422 for a bad body", async () => {
      const draft = await ad({ status: "DRAFT" });
      const live = await ad();
      await adEvent("3f1b1c34-0000-4000-8000-000000000000", {
        kind: "TAP",
      }).expect(404);
      await adEvent(draft.id, { kind: "TAP" }).expect(404);
      await adEvent("not-a-uuid", { kind: "TAP" }).expect(404);
      await adEvent(live.id, { kind: "CLICK" }).expect(422);
      await adEvent(live.id, {}).expect(422);
      await adEvent(live.id, { kind: "TAP", x: 1 }).expect(422);
      await adEvent(live.id, { kind: "TAP" }, "nope").expect(422);
      await adEvent(live.id, { kind: "TAP" }, undefined, "bad.token.x").expect(
        401,
      );
      expect(await h.prisma.adEvent.count()).toBe(0);
    });
  });

  describe("POST /events", () => {
    const post = (body: object, guest?: string, token?: string) => {
      let r = h.http().post("/api/v1/events").send(body);
      if (guest) r = r.set("X-Guest-Id", guest);
      if (token) r = r.set("Authorization", `Bearer ${token}`);
      return r;
    };
    const at = () => new Date().toISOString();

    it("stores a batch for a guest and for a signed-in person (204)", async () => {
      const u = await mkUser(h);
      await post(
        {
          events: [
            {
              name: "daily_question_view",
              at: at(),
              sessionId: "s1",
              props: { slot: 2 },
            },
            { name: "share.intent", at: at() },
          ],
        },
        GID,
      ).expect(204);
      await post(
        { events: [{ name: "answer_published", at: at() }] },
        GID,
        u.token,
      ).expect(204);
      const rows = await h.prisma.analyticsEvent.findMany({
        orderBy: { name: "asc" },
      });
      expect(rows.map((r) => [r.name, r.guestId, r.userId])).toEqual([
        ["answer_published", null, u.id],
        ["daily_question_view", GID, null],
        ["share.intent", GID, null],
      ]);
      expect(rows[1]).toMatchObject({ sessionId: "s1", props: { slot: 2 } });
    });

    it("stamps an event with a wild phone clock at server time", async () => {
      await post({
        events: [{ name: "x", at: "2001-01-01T00:00:00Z" }],
      }).expect(204);
      const row = await h.prisma.analyticsEvent.findFirstOrThrow();
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(
        60_000,
      );
    });

    it("422 for a bad name, date, size, extra field or guest id; 401 for a stale token; nothing is stored", async () => {
      const big = Array.from({ length: 51 }, () => ({ name: "x", at: at() }));
      for (const body of [
        {},
        { events: "x" },
        { events: [{ name: "Bad Name", at: at() }] },
        { events: [{ name: "x", at: "yesterday" }] },
        { events: [{ name: "x" }] },
        { events: [{ name: "x", at: at(), extra: 1 }] },
        { events: big },
        {
          events: [{ name: "x", at: at(), props: { blob: "y".repeat(3000) } }],
        },
        { events: [], more: 1 },
      ])
        expect((await post(body).expect(422)).body.error.code).toBe(
          "VALIDATION_FAILED",
        );
      await post({ events: [] }, "nope").expect(422);
      await post({ events: [] }, undefined, "bad.token.x").expect(401);
      expect(await h.prisma.analyticsEvent.count()).toBe(0);
    });

    it("accepts an empty batch", async () => {
      await post({ events: [] }).expect(204);
    });
  });
});
