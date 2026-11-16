/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { makePerson, startHarness, type Harness } from "../talk/harness";

/** V-REL-D2-FIX2 (L2, L3): with DMS_LIVE off the clip route does not hint that DM exists, and an old DM cannot be reported. */
describe("direct messages off: clip purposes and reports (L2, L3)", () => {
  const body = { mime: "audio/webm", sizeBytes: 1000, durationMs: 3000 };

  describe("off", () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startHarness({ dms: "off" });
    });
    afterAll(() => h.close());

    it("L2: the unknown-purpose error does not list DM, and DM gets the same answer as any other unknown purpose", async () => {
      const p = await makePerson(h, { verified: true });
      const post = (purpose: string) =>
        h
          .http()
          .post("/api/v1/voice-clips")
          .set("Authorization", p.auth)
          .send({ purpose, ...body });
      const bad = await post("NOPE");
      const dm = await post("DM");
      expect(bad.status).toBe(422);
      expect(dm.status).toBe(422);
      expect(JSON.stringify(bad.body)).not.toMatch(/\bDM\b/);
      expect(JSON.stringify(dm.body)).not.toMatch(/\bDM\b/);
      expect(dm.body.error.details).toEqual(bad.body.error.details);
    });

    it("L3: reporting an old DM answers 404 and creates no report and no moderation item", async () => {
      const a = await makePerson(h);
      const b = await makePerson(h);
      const [userAId, userBId] = [a.id, b.id].sort();
      const conv = await h.prisma.dmConversation.create({
        data: { userAId, userBId, lastMessageAt: new Date() },
      });
      const msg = await h.prisma.dmMessage.create({
        data: {
          conversationId: conv.id,
          senderId: a.id,
          recipientId: b.id,
          kind: "TEXT",
          body: "old message",
          idempotencyKey: randomUUID(),
        },
      });
      const rep = await h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", b.auth)
        .send({
          targetType: "DM_MESSAGE",
          targetId: msg.id,
          reason: "HATE_OR_HARASSMENT",
        });
      expect(rep.status).toBe(404);
      const unknown = await h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", b.auth)
        .send({
          targetType: "DM_MESSAGE",
          targetId: randomUUID(),
          reason: "HATE_OR_HARASSMENT",
        });
      expect(unknown.status).toBe(404);
      expect(rep.body.error.code).toBe(unknown.body.error.code);
      expect(rep.body.error.message).toBe(unknown.body.error.message);
      expect(await h.prisma.report.count({ where: { targetId: msg.id } })).toBe(
        0,
      );
      expect(
        await h.prisma.moderationItem.count({ where: { targetId: msg.id } }),
      ).toBe(0);
    });
  });

  describe("on", () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startHarness({ dms: "on" });
    });
    afterAll(() => h.close());

    it("the purpose list names DM again", async () => {
      const p = await makePerson(h, { verified: true });
      const bad = await h
        .http()
        .post("/api/v1/voice-clips")
        .set("Authorization", p.auth)
        .send({ purpose: "NOPE", ...body })
        .expect(422);
      expect(JSON.stringify(bad.body)).toMatch(/\bDM\b/);
    });
  });
});
