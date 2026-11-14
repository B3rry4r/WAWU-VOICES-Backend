/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { makePerson, startHarness, type Harness } from "../talk/harness";

/** Owner order, 14 Nov 2026: direct messages are OFF (DMS_LIVE unset or not "on"). The work and the rows are kept. */
describe("direct messages are off (DMS_LIVE)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ dms: "off" });
  });
  afterAll(async () => {
    await h.close();
  });

  const counts = async () => [
    await h.prisma.dmMessage.count(),
    await h.prisma.dmConversation.count(),
    await h.prisma.dmMute.count(),
  ];

  it("every /dm route answers the unknown-route 404 for a guest, a member and a verified person", async () => {
    const member = await makePerson(h);
    const verified = await makePerson(h, { verified: true });
    const other = await makePerson(h);
    const unknown = await h.http().get("/api/v1/nope-dm").expect(404);
    const id = randomUUID();
    const routes: [string, string][] = [
      ["post", "/dm/messages"],
      ["get", "/dm/conversations"],
      ["get", `/dm/conversations/${id}/messages`],
      ["post", `/dm/conversations/${id}/read`],
      ["put", `/dm/conversations/${id}/mute`],
      ["delete", `/dm/conversations/${id}/mute`],
      ["get", "/dm/limits"],
      ["get", "/dm/unread"],
      ["get", `/dm/with/${other.id}`],
    ];
    const before = await counts();
    for (const who of [null, member, verified]) {
      for (const [method, path] of routes) {
        let r = (
          h.http() as unknown as Record<
            string,
            (u: string) => import("supertest").Test
          >
        )[method]("/api/v1" + path);
        if (who) r = r.set("Authorization", who.auth);
        if (method === "post")
          r = r
            .set("Idempotency-Key", randomUUID())
            .send({ toUserId: other.id, kind: "TEXT", body: "hello" });
        const res = await r;
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe(unknown.body.error.code);
        expect(res.body.error.message).toBe(unknown.body.error.message);
      }
    }
    expect(await counts()).toEqual(before);
  });

  it("a clip with purpose DM is refused like an unknown purpose, and no clip row is made", async () => {
    const p = await makePerson(h, { verified: true });
    const body = { mime: "audio/webm", sizeBytes: 1000, durationMs: 3000 };
    const bad = await h
      .http()
      .post("/api/v1/voice-clips")
      .set("Authorization", p.auth)
      .send({ purpose: "NOPE", ...body })
      .expect(422);
    const dm = await h
      .http()
      .post("/api/v1/voice-clips")
      .set("Authorization", p.auth)
      .send({ purpose: "DM", ...body })
      .expect(422);
    expect(dm.body.error.code).toBe(bad.body.error.code);
    expect(dm.body.error.code).toBe("VALIDATION_FAILED");
    expect(await h.prisma.voiceClip.count({ where: { purpose: "DM" } })).toBe(
      0,
    );
  });

  it("the public config says dmsLive false and carries no DM price; /me shows no DM count", async () => {
    const cfg = (await h.http().get("/api/v1/config/public").expect(200)).body;
    expect(cfg.dmsLive).toBe(false);
    expect(JSON.stringify(cfg)).not.toMatch(/dm\./i);
    const p = await makePerson(h);
    const me = (
      await h.http().get("/api/v1/me").set("Authorization", p.auth).expect(200)
    ).body;
    expect(Object.keys(me).filter((k) => /dm|unreadMessages/i.test(k))).toEqual(
      [],
    );
    expect(me.unreadNotifications).toBe(0);
  });
});
