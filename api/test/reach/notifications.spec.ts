/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { Harness, mkUser, resetDb, startHarness } from "./helpers";

describe("reach: notifications", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(resetDb);

  const get = (path: string, token?: string) => {
    const r = h.http().get(`/api/v1${path}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };
  const post = (path: string, token: string | undefined, body: object) => {
    const r = h.http().post(`/api/v1${path}`).send(body);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };

  async function seed(
    userId: string,
    count: number,
    type: "REPLY" | "REACTIONS" | "POLL_CLOSED" = "REPLY",
  ) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const r = await h.reach.notify({
        userId,
        type,
        title: `Event ${type} ${i}`,
        dedupeKey: `${type}:${i}`,
        targetType: "answer",
        targetId: undefined,
      });
      ids.push(r!.id);
      await new Promise((ok) => setTimeout(ok, 5));
    }
    return ids;
  }

  it("is 401 for guests on all three routes", async () => {
    await get("/notifications").expect(401);
    await get("/notifications/unread-count").expect(401);
    await post("/notifications/read", undefined, {}).expect(401);
  });

  it("is 403 PROFILE_REQUIRED for a token with no VOICES profile", async () => {
    const t = h.tokenFor("nobody-yet");
    for (const res of [
      await get("/notifications", t).expect(403),
      await get("/notifications/unread-count", t).expect(403),
      await post("/notifications/read", t, {}).expect(403),
    ])
      expect(res.body.error.details).toEqual({ reason: "PROFILE_REQUIRED" });
  });

  it("lists newest first, pages by cursor, and counts unread", async () => {
    const u = await mkUser(h);
    const ids = await seed(u.id, 5);
    const p1 = (await get("/notifications?limit=2", u.token).expect(200)).body;
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual([ids[4], ids[3]]);
    expect(p1.unread).toBe(5);
    expect(p1.nextCursor).toEqual(expect.any(String));
    expect(Object.keys(p1.items[0]).sort()).toEqual(
      [
        "actorCount",
        "body",
        "createdAt",
        "id",
        "read",
        "targetId",
        "targetType",
        "title",
        "type",
      ].sort(),
    );
    const p2 = (
      await get(
        `/notifications?limit=2&cursor=${p1.nextCursor}`,
        u.token,
      ).expect(200)
    ).body;
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]]);
    const p3 = (
      await get(
        `/notifications?limit=2&cursor=${p2.nextCursor}`,
        u.token,
      ).expect(200)
    ).body;
    expect(p3.items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
    expect(p3.nextCursor).toBeNull();
  });

  it("shows only my own rows", async () => {
    const a = await mkUser(h);
    const b = await mkUser(h);
    await seed(a.id, 2);
    const res = (await get("/notifications", b.token).expect(200)).body;
    expect(res.items).toEqual([]);
    expect(res.unread).toBe(0);
  });

  it("filters by type group and unreadOnly", async () => {
    const u = await mkUser(h);
    const replies = await seed(u.id, 2, "REPLY");
    await seed(u.id, 1, "REACTIONS");
    await seed(u.id, 1, "POLL_CLOSED");
    await h.reach.notify({
      userId: u.id,
      type: "FLASH_POLL",
      title: "Flash",
      dedupeKey: "f1",
    });
    const ids = async (q: string) =>
      (await get(`/notifications?${q}`, u.token).expect(200)).body.items.map(
        (i: { type: string }) => i.type,
      );
    expect((await ids("type=replies")).sort()).toEqual(["REPLY", "REPLY"]);
    expect(await ids("type=reactions")).toEqual(["REACTIONS"]);
    expect((await ids("type=polls")).sort()).toEqual([
      "FLASH_POLL",
      "POLL_CLOSED",
    ]);
    expect(await ids("type=all")).toHaveLength(5);
    await post("/notifications/read", u.token, { ids: [replies[0]] }).expect(
      200,
    );
    const unread = (
      await get("/notifications?unreadOnly=true&type=replies", u.token).expect(
        200,
      )
    ).body;
    expect(unread.items.map((i: { id: string }) => i.id)).toEqual([replies[1]]);
  });

  it("422 for a bad limit, type or unknown query field; 400 for a bad or expired cursor", async () => {
    const u = await mkUser(h);
    for (const q of [
      "limit=0",
      "limit=51",
      "limit=abc",
      "type=everything",
      "unreadOnly=maybe",
      "foo=1",
    ]) {
      const r = await get(`/notifications?${q}`, u.token).expect(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect(
      (await get("/notifications?cursor=garbage", u.token).expect(400)).body
        .error.code,
    ).toBe("BAD_REQUEST");
    const old = Buffer.from(
      JSON.stringify({
        t: new Date().toISOString(),
        id: "x",
        iat: Date.now() - 25 * 3600_000,
      }),
    ).toString("base64url");
    await get(`/notifications?cursor=${old}`, u.token).expect(400);
  });

  it("marks some as read, then all; returns the new unread count; ignores other people's ids", async () => {
    const u = await mkUser(h);
    const other = await mkUser(h);
    const ids = await seed(u.id, 4);
    const theirs = await seed(other.id, 1);
    expect(
      (
        await post("/notifications/read", u.token, {
          ids: [ids[0], ids[1]],
        }).expect(200)
      ).body,
    ).toEqual({ unread: 2 });
    expect(
      (
        await post("/notifications/read", u.token, { ids: [theirs[0]] }).expect(
          200,
        )
      ).body,
    ).toEqual({ unread: 2 });
    expect(
      (await get("/notifications/unread-count", other.token).expect(200)).body,
    ).toEqual({ unread: 1 });
    expect(
      (await post("/notifications/read", u.token, {}).expect(200)).body,
    ).toEqual({ unread: 0 });
    expect(
      (await post("/notifications/read", u.token, { ids: [] }).expect(200))
        .body,
    ).toEqual({ unread: 0 });
    const list = (await get("/notifications", u.token).expect(200)).body;
    expect(list.items.every((i: { read: boolean }) => i.read)).toBe(true);
    expect(
      (await get("/notifications/unread-count", other.token).expect(200)).body,
    ).toEqual({ unread: 1 });
  });

  it("422 when ids are not UUIDs or the body has other fields", async () => {
    const u = await mkUser(h);
    await post("/notifications/read", u.token, { ids: ["nope"] }).expect(422);
    await post("/notifications/read", u.token, { all: true }).expect(422);
  });

  describe("ReachService.notify", () => {
    it("is safe to call twice with the same dedupe key: one row", async () => {
      const u = await mkUser(h);
      const input = {
        userId: u.id,
        type: "REPLY" as const,
        title: "Ada replied to you",
        dedupeKey: "reply:1",
      };
      const a = await h.reach.notify(input);
      const b = await h.reach.notify(input);
      expect(a).toMatchObject({ created: true });
      expect(b).toEqual({ id: a!.id, created: false });
      expect(
        await h.prisma.notification.count({ where: { userId: u.id } }),
      ).toBe(1);
    });

    it("is safe under parallel calls with one key", async () => {
      const u = await mkUser(h);
      const input = {
        userId: u.id,
        type: "UNITS_ADDED" as const,
        title: "Units added",
        dedupeKey: "payment:9",
      };
      const out = await Promise.all(
        Array.from({ length: 8 }, () => h.reach.notify(input)),
      );
      expect(new Set(out.map((o) => o!.id)).size).toBe(1);
      expect(out.filter((o) => o!.created)).toHaveLength(1);
      expect(
        await h.prisma.notification.count({ where: { userId: u.id } }),
      ).toBe(1);
    });

    it("keeps one key per person: another person gets their own row", async () => {
      const a = await mkUser(h);
      const b = await mkUser(h);
      await h.reach.notify({
        userId: a.id,
        type: "REPLY",
        title: "x",
        dedupeKey: "k",
      });
      await h.reach.notify({
        userId: b.id,
        type: "REPLY",
        title: "x",
        dedupeKey: "k",
      });
      expect(await h.prisma.notification.count()).toBe(2);
    });

    it("folds reactions on one answer into one row and lifts it back to unread", async () => {
      const u = await mkUser(h);
      const k = {
        userId: u.id,
        type: "REACTIONS" as const,
        title: "Reactions on your voice",
        dedupeKey: "reactions:answer-1",
        fold: true,
      };
      const first = await h.reach.notify(k);
      await h
        .http()
        .post("/api/v1/notifications/read")
        .set("Authorization", `Bearer ${u.token}`)
        .send({})
        .expect(200);
      await Promise.all([
        h.reach.notify(k),
        h.reach.notify(k),
        h.reach.notify(k),
      ]);
      const rows = await h.prisma.notification.findMany({
        where: { userId: u.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first!.id,
        actorCount: 4,
        readAt: null,
      });
    });

    it("never writes a dash into text people read, and refuses empty input", async () => {
      const u = await mkUser(h);
      await h.reach.notify({
        userId: u.id,
        type: "REPLY",
        title: "Ada — replied",
        body: "to you – now",
        dedupeKey: "d",
      });
      const row = await h.prisma.notification.findFirstOrThrow({
        where: { userId: u.id },
      });
      expect(row.title).toBe("Ada - replied");
      expect(row.body).toBe("to you - now");
      await expect(
        h.reach.notify({
          userId: u.id,
          type: "REPLY",
          title: "  ",
          dedupeKey: "e",
        }),
      ).rejects.toThrow();
      await expect(
        h.reach.notify({
          userId: u.id,
          type: "REPLY",
          title: "ok",
          dedupeKey: "",
        }),
      ).rejects.toThrow();
    });

    it("skips a kind the person switched off, but never the money or moderation kinds", async () => {
      const u = await mkUser(h);
      await h.prisma.userSettings.create({
        data: { userId: u.id, notifyReplies: false, notifyReactions: false },
      });
      expect(
        await h.reach.notify({
          userId: u.id,
          type: "REPLY",
          title: "r",
          dedupeKey: "r",
        }),
      ).toBeNull();
      expect(
        await h.reach.notify({
          userId: u.id,
          type: "UNITS_ADDED",
          title: "u",
          dedupeKey: "u",
        }),
      ).not.toBeNull();
      expect(
        await h.reach.notify({
          userId: u.id,
          type: "MODERATION_NOTICE",
          title: "m",
          dedupeKey: "m",
        }),
      ).not.toBeNull();
      expect(
        await h.prisma.notification.count({ where: { userId: u.id } }),
      ).toBe(2);
    });
  });

  it("rate limit: 300 reads a minute on the list", async () => {
    // A fresh app so the counter starts at zero.
    const h2 = await startHarness();
    try {
      const u = await h2.prisma.user.create({
        data: { wawuId: "rl-user", handle: "rluser", referralCode: "RLREF" },
      });
      const t = h2.tokenFor(u.wawuId);
      let last = 0;
      for (let i = 0; i < 301; i++) {
        const r = await h2
          .http()
          .get("/api/v1/notifications/unread-count")
          .set("Authorization", `Bearer ${t}`);
        last = r.status;
        if (i < 300) expect(r.status).toBe(200);
      }
      expect(last).toBe(429);
    } finally {
      await h2.close();
    }
  }, 60000);
});
