/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  fixture,
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";
import { canSendDm } from "../../src/dm/dm-access";
import { RateLimitGuard } from "../../src/talk/shared/rate-limit";
import { ConfigReader } from "../../src/talk/shared/config-reader";
import { DmService } from "../../src/dm/dm.service";
import { DeletionService } from "../../src/me/deletion.service";
import { lagosDay } from "../../src/units/units.ledger";

/** V-DM: direct messages. Every provider is an in-memory stand-in (MemoryStore); nothing calls a live service. */
describe("direct messages (V-DM)", () => {
  let h: Harness;
  const DM_KEYS = [
    "dm.text_price_milli",
    "dm.voice_price_milli",
    "dm.voice_max_seconds",
    "dm.messages_per_day",
  ];
  const clearCfg = async (key: string | { in: string[] }) => {
    await h.prisma.configEntry.deleteMany({ where: { key } });
    h.app.get(ConfigReader).invalidate(); // the reader keeps a value for 5 seconds
  };
  const setCfg = async (key: string, valueJson: number) => {
    await h.prisma.configEntry.upsert({
      where: { key },
      create: { key, valueJson },
      update: { valueJson },
    });
    h.app.get(ConfigReader).invalidate();
  };
  /** The priced case: 5 tokens per 150 characters, 78 tokens a voice message. The default (free) case has its own describe. */
  const priced = async () => {
    await clearCfg({ in: DM_KEYS });
    await setCfg("dm.text_price_milli", 5000);
    await setCfg("dm.voice_price_milli", 78_000);
  };
  const unpriced = () => clearCfg({ in: DM_KEYS });
  beforeAll(async () => {
    h = await startHarness();
    await priced();
  });
  afterAll(async () => {
    await unpriced();
    await h.close();
  });

  const MILLI = 1000;
  const text = (chars: number) => "a".repeat(chars);

  /** Verified as V-46 says: the ID was approved and the plan runs on. `o` sets another state of the same two columns. */
  async function verify(
    p: Person,
    o: {
      status?: "APPROVED" | "PENDING" | "REJECTED" | "EXPIRED" | null;
      days?: number | null;
    } = {},
  ) {
    const days = o.days === undefined ? 90 : o.days;
    return h.prisma.user.update({
      where: { id: p.id },
      data: {
        verificationStatus: o.status === undefined ? "APPROVED" : o.status,
        verifiedUntil:
          days === null ? null : new Date(Date.now() + days * 86_400_000),
      },
    });
  }

  /** A verified sender with `tokens` tokens and the 10 free posts the app gives everyone. */
  async function sender(tokens = 1000, free = 10) {
    const p = await makePerson(h, {
      balanceMilli: tokens * MILLI,
      freePosts: free,
    });
    await verify(p);
    return p;
  }
  const member = () => makePerson(h);

  const send = (p: Person, body: object, key: string = randomUUID()) =>
    h
      .http()
      .post("/api/v1/dm/messages")
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body);
  const sendText = (p: Person, to: Person, body: string, key?: string) =>
    send(p, { toUserId: to.id, kind: "TEXT", body }, key);
  const get = (p: Person, url: string) =>
    h.http().get(`/api/v1${url}`).set("Authorization", p.auth);
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;
  const msgCount = (senderId: string) =>
    h.prisma.dmMessage.count({ where: { senderId } });
  const spendTxns = (p: Person) =>
    h.prisma.ledgerTransaction.count({
      where: { entries: { some: { walletUserId: p.id } }, kind: "SPEND_POST" },
    });

  /** A READY clip made with purpose DM through the normal clip flow, then set to the length under test. */
  async function readyClip(p: Person, durationMs: number, purpose = "DM") {
    const bytes = fixture("sample.webm");
    const c = await h
      .http()
      .post("/api/v1/voice-clips")
      .set("Authorization", p.auth)
      .send({
        purpose,
        mime: "audio/webm",
        sizeBytes: bytes.length,
        durationMs: 3200,
      })
      .expect(201);
    const id = c.body.clip.id as string;
    const row = await h.prisma.voiceClip.findUniqueOrThrow({ where: { id } });
    h.store.objects.set(row.rawKey, bytes);
    await h
      .http()
      .post(`/api/v1/voice-clips/${id}/complete`)
      .set("Authorization", p.auth)
      .expect(202);
    await h.app
      .get((await import("../../src/media/media-jobs.js")).MediaJobs)
      .idle();
    await h.prisma.voiceClip.update({ where: { id }, data: { durationMs } });
    return id;
  }

  describe("who may send", () => {
    it("a member with no subscription is refused: 403 verification_required, nothing stored or charged", async () => {
      const a = await makePerson(h, { balanceMilli: 100 * MILLI });
      const b = await member();
      const r = await sendText(a, b, "hello").expect(403);
      expect(r.body.error.code).toBe("verification_required");
      expect(r.body.error.message).toBe(
        "Subscribe and get verified to send messages.",
      );
      expect(await balance(a)).toBe(100 * MILLI);
      expect(await msgCount(a.id)).toBe(0);
      expect(await spendTxns(a)).toBe(0);
    });

    it("canSendDm: approved and running yes; a subscriber whose ID is not approved yet, a rejected or expired request, a lapsed plan, and nothing at all, no", async () => {
      const prisma = h.prisma;
      const ok = async (st: Parameters<typeof verify>[1]) => {
        const p = await member();
        await verify(p, st);
        return canSendDm(prisma, p.id);
      };
      expect(await ok({})).toBe(true);
      // paid for a plan, ID not yet looked at: no status
      expect(await ok({ status: null })).toBe(false);
      expect(await ok({ status: "PENDING" })).toBe(false);
      expect(await ok({ status: "REJECTED" })).toBe(false);
      expect(await ok({ status: "EXPIRED" })).toBe(false);
      // approved, but the plan lapsed
      expect(await ok({ days: -1 })).toBe(false);
      expect(await ok({ days: null })).toBe(false);
      const p = await member();
      expect(await canSendDm(prisma, p.id)).toBe(false);
    });

    it("a subscriber whose ID is not approved cannot send: 403 verification_required, nothing charged; once approved the same person can", async () => {
      const a = await makePerson(h, { balanceMilli: 100 * MILLI });
      const b = await member();
      await verify(a, { status: "PENDING" });
      const r = await sendText(a, b, "hello").expect(403);
      expect(r.body.error.code).toBe("verification_required");
      expect(await msgCount(a.id)).toBe(0);
      await verify(a);
      await sendText(a, b, "hello").expect(201);
    });

    it("receiving and reading are open to a member with no subscription", async () => {
      const a = await sender();
      const b = await member();
      await sendText(a, b, "hi there").expect(201);
      const list = await get(b, "/dm/conversations").expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].unread).toBe(1);
      await get(b, "/dm/unread").expect(200);
      // b cannot answer, though
      const r = await sendText(b, a, "reply").expect(403);
      expect(r.body.error.code).toBe("verification_required");
    });

    it("401 without a token; 403 PROFILE_REQUIRED without a profile", async () => {
      await h.http().get("/api/v1/dm/unread").expect(401);
      const ghost = `Bearer ${h.jwks.sign({ sub: "ghost-" + randomUUID() })}`;
      const r = await h
        .http()
        .get("/api/v1/dm/unread")
        .set("Authorization", ghost)
        .expect(403);
      expect(r.body.error.details.reason).toBe("PROFILE_REQUIRED");
    });

    it("no Idempotency-Key is 400", async () => {
      const a = await sender();
      const b = await member();
      const r = await h
        .http()
        .post("/api/v1/dm/messages")
        .set("Authorization", a.auth)
        .send({ toUserId: b.id, kind: "TEXT", body: "x" })
        .expect(400);
      expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("you cannot message yourself (422)", async () => {
      const a = await sender();
      const r = await sendText(a, a, "me").expect(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(await balance(a)).toBe(1000 * MILLI);
    });
  });

  describe("safety", () => {
    it("someone who blocked you: 403 blocked, neutral message, no charge, nothing stored", async () => {
      const a = await sender();
      const b = await member();
      await h
        .http()
        .put(`/api/v1/me/blocks/${a.id}`)
        .set("Authorization", b.auth)
        .expect(204);
      const r = await sendText(a, b, "hello").expect(403);
      expect(r.body.error.code).toBe("blocked");
      expect(r.body.error.message).toBe("You can't message this person.");
      expect(await balance(a)).toBe(1000 * MILLI);
      expect(await msgCount(a.id)).toBe(0);
    });

    it("someone you blocked: also 403 blocked", async () => {
      const a = await sender();
      const b = await member();
      await h
        .http()
        .put(`/api/v1/me/blocks/${b.id}`)
        .set("Authorization", a.auth)
        .expect(204);
      const r = await sendText(a, b, "hello").expect(403);
      expect(r.body.error.code).toBe("blocked");
    });

    it("a block made after a message hides the conversation both ways (404) and leaves it out of the unread total", async () => {
      const a = await sender();
      const b = await member();
      const sent = await sendText(a, b, "before the block").expect(201);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(1);
      await h
        .http()
        .put(`/api/v1/me/blocks/${a.id}`)
        .set("Authorization", b.auth)
        .expect(204);
      const conv = sent.body.message.conversationId;
      await get(b, `/dm/conversations/${conv}/messages`).expect(404);
      await get(a, `/dm/conversations/${conv}/messages`).expect(404);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(0);
      expect(
        (await get(b, "/dm/conversations").expect(200)).body.items,
      ).toHaveLength(0);
    });

    it("DMs off (dmOpen false): 403 dm_closed, no charge; on again works; the setting defaults to true", async () => {
      const a = await sender();
      const b = await member();
      const s = await get(b, "/me/settings").expect(200);
      expect(s.body.dmOpen).toBe(true);
      const off = await h
        .http()
        .patch("/api/v1/me/settings")
        .set("Authorization", b.auth)
        .send({ dmOpen: false })
        .expect(200);
      expect(off.body.dmOpen).toBe(false);
      const r = await sendText(a, b, "hello").expect(403);
      expect(r.body.error.code).toBe("dm_closed");
      expect(await balance(a)).toBe(1000 * MILLI);
      const w = await get(a, `/dm/with/${b.id}`).expect(200);
      expect(w.body.acceptsMessages).toBe(false);
      await h
        .http()
        .patch("/api/v1/me/settings")
        .set("Authorization", b.auth)
        .send({ dmOpen: true })
        .expect(200);
      await sendText(a, b, "hello").expect(201);
    });

    it("a suspended sender cannot send (403 ACCOUNT_SUSPENDED); a suspended or banned receiver cannot receive; nothing is charged", async () => {
      const a = await sender();
      const sus = await makePerson(h, {
        balanceMilli: 100 * MILLI,
        status: "SUSPENDED",
      });
      await verify(sus);
      const r1 = await sendText(sus, a, "hi").expect(403);
      expect(r1.body.error.code).toBe("ACCOUNT_SUSPENDED");
      expect(await balance(sus)).toBe(100 * MILLI);

      const rcvSus = await makePerson(h, { status: "SUSPENDED" });
      const r2 = await sendText(a, rcvSus, "hi").expect(403);
      expect(r2.body.error.code).toBe("recipient_unavailable");
      expect(r2.body.error.message).toBe("You can't message this person.");
      const banned = await member();
      await h.prisma.user.update({
        where: { id: banned.id },
        data: { status: "BANNED" },
      });
      const r3 = await sendText(a, banned, "hi").expect(403);
      expect(r3.body.error.code).toBe("recipient_unavailable");
      const gone = await member();
      await h.prisma.user.update({
        where: { id: gone.id },
        data: { status: "DELETED" },
      });
      await sendText(a, gone, "hi").expect(404);
      expect(await balance(a)).toBe(1000 * MILLI);
      expect(await msgCount(a.id)).toBe(0);
    });

    it("report: only the person it was sent to; it lands in the REPORTED moderation queue; a moderator sees the message and can remove it", async () => {
      const a = await sender();
      const b = await member();
      const c = await member();
      const sent = await sendText(a, b, "something rude").expect(201);
      const id = sent.body.message.id;
      const rep = (p: Person) =>
        h.http().post("/api/v1/reports").set("Authorization", p.auth).send({
          targetType: "DM_MESSAGE",
          targetId: id,
          reason: "HATE_OR_HARASSMENT",
        });
      await rep(a).expect(404); // the sender cannot report their own message
      await rep(c).expect(404); // a stranger cannot
      await rep(b).expect(201);
      await rep(b).expect(409); // once per person
      const item = await h.prisma.moderationItem.findFirstOrThrow({
        where: { targetType: "DM_MESSAGE", targetId: id },
      });
      expect(item.queue).toBe("REPORTED");
      expect(item.reportCount).toBe(1);

      const mod = await makePerson(h, { roles: ["MODERATOR"] });
      const detail = await get(
        mod,
        `/admin/moderation/items/${item.id}`,
      ).expect(200);
      expect(JSON.stringify(detail.body)).toContain("something rude");
      await h
        .http()
        .post(`/api/v1/admin/moderation/items/${item.id}/action`)
        .set("Authorization", mod.auth)
        .send({ action: "REMOVE", reason: "harassment" })
        .expect(200);
      const row = await h.prisma.dmMessage.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("REMOVED");
      const page = await get(
        b,
        `/dm/conversations/${sent.body.message.conversationId}/messages`,
      ).expect(200);
      expect(page.body.items[0].body).toBeNull();
      expect(page.body.items[0].status).toBe("REMOVED");
    });

    it("report with alsoBlock blocks the sender", async () => {
      const a = await sender();
      const b = await member();
      const sent = await sendText(a, b, "spam").expect(201);
      await h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", b.auth)
        .send({
          targetType: "DM_MESSAGE",
          targetId: sent.body.message.id,
          reason: "SCAM_OR_SPAM",
          alsoBlock: true,
        })
        .expect(201);
      const r = await sendText(a, b, "again").expect(403);
      expect(r.body.error.code).toBe("blocked");
    });
  });

  describe("price and charging (the priced case)", () => {
    it("text: 5 tokens per 150 characters in proportion (150 = 5, 500 = 16.67), free posts do not apply", async () => {
      const a = await sender(1000, 10);
      const b = await member();
      const r150 = await sendText(a, b, text(150)).expect(201);
      expect(r150.body.charge.costMilli).toBe(5000);
      expect(r150.body.message.costMilli).toBe(5000);
      expect(await balance(a)).toBe(995_000);
      const r500 = await sendText(a, b, text(500)).expect(201);
      expect(r500.body.charge.costMilli).toBe(16_670);
      expect(await balance(a)).toBe(995_000 - 16_670);
      expect(r500.body.charge.balanceMilli).toBe(995_000 - 16_670);
      // the free allowance is untouched
      const fa = await h.prisma.freeAllowance.findUnique({
        where: { userId: a.id },
      });
      expect(fa?.freePostsRemaining).toBe(10);
      expect(await spendTxns(a)).toBe(2);
    });

    it("a short message with free posts left is still charged; with no balance it is 402 INSUFFICIENT_UNITS (not free-post words)", async () => {
      const a = await sender(0, 10);
      const b = await member();
      const r = await sendText(a, b, "hi").expect(402);
      expect(r.body.error.code).toBe("INSUFFICIENT_UNITS");
      expect(await msgCount(a.id)).toBe(0);
      const fa = await h.prisma.freeAllowance.findUnique({
        where: { userId: a.id },
      });
      expect(fa?.freePostsRemaining).toBe(10);
    });

    it("5,000 characters is accepted and costs 166.67 tokens; 5,001 is 422 and costs nothing", async () => {
      const a = await sender(1000);
      const b = await member();
      const bad = await sendText(a, b, text(5001)).expect(422);
      expect(bad.body.error.code).toBe("VALIDATION_FAILED");
      expect(bad.body.error.details.fields[0].path).toBe("body");
      expect(await balance(a)).toBe(1000 * MILLI);
      const ok = await sendText(a, b, text(5000)).expect(201);
      expect(ok.body.charge.costMilli).toBe(166_670);
    });

    it("characters are counted as code points (an emoji is one)", async () => {
      const a = await sender(1000);
      const b = await member();
      const r = await sendText(a, b, "😀".repeat(150)).expect(201);
      expect(r.body.charge.costMilli).toBe(5000);
    });

    it("empty and whitespace text, a text with a clip, a voice with a body are 422", async () => {
      const a = await sender();
      const b = await member();
      await sendText(a, b, "   ").expect(422);
      await send(a, {
        toUserId: b.id,
        kind: "TEXT",
        body: "x",
        clipId: randomUUID(),
      }).expect(422);
      await send(a, { toUserId: b.id, kind: "VOICE", body: "x" }).expect(422);
      await send(a, { toUserId: b.id, kind: "VOICE" }).expect(422);
      expect(await balance(a)).toBe(1000 * MILLI);
    });

    it("voice: one price for any length up to the longest (78 tokens), 60 s is accepted, 61 s is 422 VOICE_TOO_LONG with no charge", async () => {
      const a = await sender(1000);
      const b = await member();
      const send1 = async (ms: number) => {
        const clipId = await readyClip(a, ms);
        return send(a, { toUserId: b.id, kind: "VOICE", clipId });
      };
      expect((await send1(9_000)).body.charge.costMilli).toBe(78_000);
      expect((await send1(45_000)).body.charge.costMilli).toBe(78_000);
      expect((await send1(60_000)).body.charge.costMilli).toBe(78_000);
      const before = await balance(a);
      const tooLong = await send1(61_000);
      expect(tooLong.status).toBe(422);
      expect(tooLong.body.error.code).toBe("VOICE_TOO_LONG");
      expect(await balance(a)).toBe(before);
      expect(await msgCount(a.id)).toBe(3);
    });

    it("a clip made for something else, or one already sent, is refused with no charge", async () => {
      const a = await sender();
      const b = await member();
      const wrong = await readyClip(a, 5000, "ANSWER");
      const r = await send(a, { toUserId: b.id, kind: "VOICE", clipId: wrong });
      expect(r.status).toBe(422);
      const ok = await readyClip(a, 5000);
      await send(a, { toUserId: b.id, kind: "VOICE", clipId: ok }).expect(201);
      const again = await send(a, {
        toUserId: b.id,
        kind: "VOICE",
        clipId: ok,
      });
      expect(again.status).toBe(409);
      expect(await balance(a)).toBe(1000 * MILLI - 78_000);
    });

    it("someone else's clip is 404 CLIP_NOT_FOUND", async () => {
      const a = await sender();
      const b = await member();
      const other = await member();
      const clipId = await readyClip(other, 5000);
      const r = await send(a, { toUserId: b.id, kind: "VOICE", clipId });
      expect(r.status).toBe(404);
    });

    it("voice playback: sender and recipient only", async () => {
      const a = await sender();
      const b = await member();
      const c = await member();
      const clipId = await readyClip(a, 8000);
      const sent = await send(a, { toUserId: b.id, kind: "VOICE", clipId });
      expect(sent.status).toBe(201);
      expect(sent.body.message.clip.id).toBe(clipId);
      await get(a, `/voice-clips/${clipId}/play`).expect(200);
      await get(b, `/voice-clips/${clipId}/play`).expect(200);
      await get(c, `/voice-clips/${clipId}/play`).expect(404);
      await h.http().get(`/api/v1/voice-clips/${clipId}/play`).expect(404);
      // the sender cannot delete a recording that is in a message
      await h
        .http()
        .delete(`/api/v1/voice-clips/${clipId}`)
        .set("Authorization", a.auth)
        .expect(409);
    });
  });

  describe("idempotency and races", () => {
    it("the same Idempotency-Key twice: the first result again, one message, charged once", async () => {
      const a = await sender();
      const b = await member();
      const key = randomUUID();
      const r1 = await sendText(a, b, text(150), key).expect(201);
      const r2 = await sendText(a, b, text(150), key).expect(201);
      expect(r2.headers["idempotent-replay"]).toBe("true");
      expect(r2.body.message.id).toBe(r1.body.message.id);
      expect(await msgCount(a.id)).toBe(1);
      expect(await balance(a)).toBe(1000 * MILLI - 5000);
      expect(await spendTxns(a)).toBe(1);
    });

    it("the same key sent in parallel: one message, one charge", async () => {
      const a = await sender();
      const b = await member();
      const key = randomUUID();
      const rs = await Promise.all(
        [1, 2, 3, 4].map(() => sendText(a, b, text(150), key)),
      );
      expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(rs.map((r) => r.body.message.id)).size).toBe(1);
      expect(await msgCount(a.id)).toBe(1);
      expect(await balance(a)).toBe(1000 * MILLI - 5000);
      expect(await spendTxns(a)).toBe(1);
    });

    it("the service alone also holds the line: a repeat of a stored key is the stored message even when idempotency records are gone", async () => {
      const a = await sender();
      const b = await member();
      const key = randomUUID();
      const r1 = await sendText(a, b, "once", key).expect(201);
      await h.prisma.idempotencyRecord.deleteMany({ where: { actorId: a.id } });
      const r2 = await sendText(a, b, "once", key).expect(201);
      expect(r2.body.message.id).toBe(r1.body.message.id);
      expect(await spendTxns(a)).toBe(1);
    });

    it("the same key with a different body is 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const a = await sender();
      const b = await member();
      const key = randomUUID();
      await sendText(a, b, "one", key).expect(201);
      const r = await sendText(a, b, "two", key).expect(409);
      expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await msgCount(a.id)).toBe(1);
    });

    it("two sends racing on a balance that covers only one: one 201, one 402, balance never below zero, one message", async () => {
      const a = await sender(0);
      await h.prisma.wallet.upsert({
        where: { userId: a.id },
        create: { userId: a.id, balanceMilli: 5000 },
        update: { balanceMilli: 5000 },
      });
      const b = await member();
      const rs = await Promise.all([
        sendText(a, b, text(150)),
        sendText(a, b, text(150)),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 402]);
      expect(rs.find((r) => r.status === 402)?.body.error.code).toBe(
        "INSUFFICIENT_UNITS",
      );
      expect(await balance(a)).toBe(0);
      expect(await msgCount(a.id)).toBe(1);
      expect(await spendTxns(a)).toBe(1);
    });

    it("a send that fails to store costs nothing: the charge is reversed and the day's count is given back", async () => {
      const a = await sender();
      const b = await member();
      const dm = h.app.get<unknown>(DmService) as {
        store: (...a: unknown[]) => Promise<unknown>;
      };
      const spy = jest
        .spyOn(dm, "store")
        .mockRejectedValueOnce(new Error("database went away"));
      const key = randomUUID();
      const r = await sendText(a, b, text(150), key);
      expect(r.status).toBe(500);
      spy.mockRestore();
      expect(await balance(a)).toBe(1000 * MILLI);
      expect(await msgCount(a.id)).toBe(0);
      const ch = await h.prisma.charge.findFirstOrThrow({
        where: { userId: a.id, idempotencyKey: key },
      });
      expect(ch.status).toBe("REVERSED");
      const rev = await h.prisma.ledgerTransaction.count({
        where: { kind: "REVERSAL", chargeId: ch.id },
      });
      expect(rev).toBe(1);
      const used = await h.prisma.usageCounter.findMany({
        where: { userId: a.id, day: lagosDay() },
      });
      expect(used.reduce((s, u) => s + u.used, 0)).toBe(0);
      // and a fresh key then works
      await sendText(a, b, text(150)).expect(201);
      expect(await balance(a)).toBe(1000 * MILLI - 5000);
    });

    it("a block that lands between the check and the write is caught in the write: no message, no charge", async () => {
      const a = await sender();
      const b = await member();
      const dm = h.app.get<unknown>(DmService) as {
        blockedEitherWay: (x: string, y: string) => Promise<boolean>;
      };
      const spy = jest
        .spyOn(dm, "blockedEitherWay")
        .mockImplementationOnce(async () => {
          await h.prisma.block.create({
            data: { blockerId: b.id, blockedId: a.id },
          });
          return false;
        });
      const r = await sendText(a, b, "racing a block");
      spy.mockRestore();
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("blocked");
      expect(await balance(a)).toBe(1000 * MILLI);
      expect(await msgCount(a.id)).toBe(0);
    });
  });

  describe("the daily limit (its own cap, not the 20 posts a day)", () => {
    it("the 101st message of the day is 429 DAILY_LIMIT_REACHED and costs nothing", async () => {
      const a = await sender(1000);
      const b = await member();
      await h.prisma.usageCounter.create({
        data: { userId: a.id, day: lagosDay(), action: "DM_TEXT", used: 99 },
      });
      await sendText(a, b, "number one hundred").expect(201);
      const before = await balance(a);
      const r = await sendText(a, b, "number one hundred and one").expect(429);
      expect(r.body.error.code).toBe("DAILY_LIMIT_REACHED");
      expect(r.body.error.details.limit).toBe(100);
      expect(await balance(a)).toBe(before);
      expect(await msgCount(a.id)).toBe(1);
    });

    it("the cap is config, text and voice both count, and a refused send is not counted", async () => {
      await setCfg("dm.messages_per_day", 3);
      try {
        const a = await sender(5000);
        const b = await member();
        const clipId = await readyClip(a, 3000);
        await send(a, { toUserId: b.id, kind: "VOICE", clipId }).expect(201);
        await sendText(a, b, "two").expect(201);
        await sendText(a, b, "three").expect(201);
        const r = await sendText(a, b, "four").expect(429);
        expect(r.body.error.code).toBe("DAILY_LIMIT_REACHED");
        expect(r.body.error.details.limit).toBe(3);
        expect(await msgCount(a.id)).toBe(3);
        const lim = await get(a, "/dm/limits").expect(200);
        expect(lim.body.messagesLeftToday).toBe(0);
      } finally {
        await clearCfg("dm.messages_per_day");
      }
    });

    it("direct messages do not use up the 20 posts a day, and 20 posts do not stop direct messages", async () => {
      const a = await sender(1000);
      const b = await member();
      for (let i = 0; i < 5; i++) await sendText(a, b, `m${i}`).expect(201);
      const posts = await h.prisma.usageCounter.findMany({
        where: { userId: a.id, action: { in: ["POST_TEXT", "POST_VOICE"] } },
      });
      expect(posts).toHaveLength(0);
      await h.prisma.usageCounter.create({
        data: { userId: a.id, day: lagosDay(), action: "POST_TEXT", used: 20 },
      });
      await sendText(a, b, "still allowed").expect(201);
    });
  });

  describe("the default: messages are free", () => {
    beforeAll(unpriced);
    afterAll(priced);

    it("with both prices at 0 a text and a voice message cost nothing, even with an empty wallet; a charge row of 0 is kept", async () => {
      const a = await sender(0);
      const b = await member();
      const t = await sendText(a, b, text(5000)).expect(201);
      expect(t.body.charge.costMilli).toBe(0);
      const clipId = await readyClip(a, 8000);
      const v = await send(a, { toUserId: b.id, kind: "VOICE", clipId });
      expect(v.status).toBe(201);
      expect(v.body.charge.costMilli).toBe(0);
      expect(await balance(a)).toBe(0);
      expect(await spendTxns(a)).toBe(0);
      expect(
        await h.prisma.charge.count({ where: { userId: a.id, costMilli: 0 } }),
      ).toBe(2);
    });

    it("GET /dm/limits says it: prices 0, longest voice 60 s, 100 a day", async () => {
      const a = await sender(0);
      const r = await get(a, "/dm/limits").expect(200);
      expect(r.body).toMatchObject({
        textPriceMilli: 0,
        voicePriceMilli: 0,
        voiceMaxSeconds: 60,
        messagesPerDay: 100,
        messagesLeftToday: 100,
        maxChars: 5000,
      });
    });

    it("the longest voice message is config: at 10 s, 10.5 s is accepted and 11 s is 422", async () => {
      await setCfg("dm.voice_max_seconds", 10);
      try {
        const a = await sender(0);
        const b = await member();
        const ok = await send(a, {
          toUserId: b.id,
          kind: "VOICE",
          clipId: await readyClip(a, 10_500),
        });
        expect(ok.status).toBe(201);
        const no = await send(a, {
          toUserId: b.id,
          kind: "VOICE",
          clipId: await readyClip(a, 11_000),
        });
        expect(no.status).toBe(422);
        expect(no.body.error.code).toBe("VOICE_TOO_LONG");
        expect(no.body.error.details.maxSeconds).toBe(10);
      } finally {
        await clearCfg("dm.voice_max_seconds");
      }
    });

    it("a price set to something other than 0 is charged again (and shown by /dm/limits)", async () => {
      await setCfg("dm.text_price_milli", 5000);
      try {
        const a = await sender(10);
        const b = await member();
        const lim = await get(a, "/dm/limits").expect(200);
        expect(lim.body.textPriceMilli).toBe(5000);
        const r = await sendText(a, b, text(150)).expect(201);
        expect(r.body.charge.costMilli).toBe(5000);
        expect(await balance(a)).toBe(5000);
      } finally {
        await clearCfg("dm.text_price_milli");
      }
    });
  });

  describe("mute", () => {
    it("a muted chat does not raise the unread total; unmuting brings it back; the other person is not told; others cannot mute it", async () => {
      const a = await sender();
      const b = await member();
      const c = await member();
      const sent = await sendText(a, b, "hello").expect(201);
      const conv = sent.body.message.conversationId;
      const put = (p: Person, m: "put" | "delete") =>
        h
          .http()
          [m](`/api/v1/dm/conversations/${conv}/mute`)
          .set("Authorization", p.auth);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(1);
      await put(b, "put").expect(204);
      await put(b, "put").expect(204);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(0);
      const inbox = await get(b, "/dm/conversations").expect(200);
      expect(inbox.body.items[0].muted).toBe(true);
      expect(inbox.body.items[0].unread).toBe(1);
      expect(
        (await get(a, "/dm/conversations").expect(200)).body.items[0].muted,
      ).toBe(false);
      await sendText(a, b, "again").expect(201);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(0);
      await put(c, "put").expect(404);
      await put(b, "delete").expect(204);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(2);
      expect(
        (await get(b, `/dm/conversations/${conv}/messages`).expect(200)).body
          .muted,
      ).toBe(false);
    });
  });

  describe("reading", () => {
    it("someone else's conversation is 404 for messages and for mark read; a non-uuid is 404 too", async () => {
      const a = await sender();
      const b = await member();
      const spy = await member();
      const sent = await sendText(a, b, "private").expect(201);
      const conv = sent.body.message.conversationId;
      await get(spy, `/dm/conversations/${conv}/messages`).expect(404);
      await h
        .http()
        .post(`/api/v1/dm/conversations/${conv}/read`)
        .set("Authorization", spy.auth)
        .expect(404);
      await get(spy, "/dm/conversations/not-a-uuid/messages").expect(404);
      await get(spy, `/dm/conversations/${randomUUID()}/messages`).expect(404);
      // the stranger's read did nothing
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(1);
      await get(a, `/dm/conversations/${conv}/messages`).expect(200);
      await get(b, `/dm/conversations/${conv}/messages`).expect(200);
    });

    it("inbox: newest first, last message preview, unread count, cursor pages; mark read clears; the sender sees readAt", async () => {
      const a = await sender();
      const b = await member();
      const c = await member();
      const d = await member();
      await sendText(a, b, "first to b").expect(201);
      await sendText(a, c, "to c").expect(201);
      await sendText(c, a, "x").expect(403); // c cannot send
      const second = await sendText(a, b, text(200)).expect(201);
      await sendText(a, d, "to d").expect(201);

      const inbox = await get(a, "/dm/conversations?limit=2").expect(200);
      expect(inbox.body.items).toHaveLength(2);
      expect(inbox.body.items[0].person.id).toBe(d.id);
      expect(inbox.body.items[1].person.id).toBe(b.id);
      expect(inbox.body.items[1].lastMessage.mine).toBe(true);
      expect(inbox.body.items[1].lastMessage.preview).toBe(text(80) + "...");
      expect(inbox.body.nextCursor).toBeTruthy();
      const next = await get(
        a,
        `/dm/conversations?limit=2&cursor=${inbox.body.nextCursor}`,
      ).expect(200);
      expect(
        next.body.items.map((i: { person: { id: string } }) => i.person.id),
      ).toEqual([c.id]);
      expect(next.body.nextCursor).toBeNull();

      const bInbox = await get(b, "/dm/conversations").expect(200);
      expect(bInbox.body.items).toHaveLength(1);
      expect(bInbox.body.items[0].unread).toBe(2);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(2);

      const conv = second.body.message.conversationId;
      const m = await get(
        b,
        `/dm/conversations/${conv}/messages?limit=1`,
      ).expect(200);
      expect(m.body.items).toHaveLength(1);
      expect(m.body.items[0].mine).toBe(false);
      expect(m.body.items[0].costMilli).toBeUndefined();
      expect(m.body.nextCursor).toBeTruthy();
      const m2 = await get(
        b,
        `/dm/conversations/${conv}/messages?limit=1&cursor=${m.body.nextCursor}`,
      ).expect(200);
      expect(m2.body.items[0].body).toBe("first to b");
      expect(m2.body.nextCursor).toBeNull();

      await h
        .http()
        .post(`/api/v1/dm/conversations/${conv}/read`)
        .set("Authorization", b.auth)
        .expect(204);
      expect((await get(b, "/dm/unread").expect(200)).body.unread).toBe(0);
      const seen = await get(a, `/dm/conversations/${conv}/messages`).expect(
        200,
      );
      expect(seen.body.items[0].readAt).toBeTruthy();
      expect(seen.body.items[0].costMilli).toBeGreaterThan(0);
      await get(a, "/dm/conversations?limit=0").expect(400);
    });

    it("GET /dm/with/{userId}: the person, the conversation id when there is one, acceptsMessages; 404 for myself", async () => {
      const a = await sender();
      const b = await member();
      const w1 = await get(a, `/dm/with/${b.id}`).expect(200);
      expect(w1.body.conversationId).toBeNull();
      expect(w1.body.acceptsMessages).toBe(true);
      const sent = await sendText(a, b, "hi").expect(201);
      const w2 = await get(b, `/dm/with/${a.id}`).expect(200);
      expect(w2.body.conversationId).toBe(sent.body.message.conversationId);
      await get(a, `/dm/with/${a.id}`).expect(404);
    });

    it("both people share one conversation, whoever sends first", async () => {
      const a = await sender();
      const b = await sender();
      const m1 = await sendText(a, b, "from a").expect(201);
      const m2 = await sendText(b, a, "from b").expect(201);
      expect(m2.body.message.conversationId).toBe(
        m1.body.message.conversationId,
      );
      expect(
        await h.prisma.dmConversation.count({
          where: { OR: [{ userAId: a.id }, { userBId: a.id }] },
        }),
      ).toBe(1);
    });
  });

  describe("account deletion", () => {
    it("the content of messages a person sent is deleted, the ledger rows stay", async () => {
      const a = await sender();
      const b = await member();
      const t = await sendText(a, b, "words that will go").expect(201);
      const clipId = await readyClip(a, 4000);
      const v = await send(a, { toUserId: b.id, kind: "VOICE", clipId });
      expect(v.status).toBe(201);
      await h.prisma.user.update({
        where: { id: a.id },
        data: {
          status: "DELETION_PENDING",
          deletionRequestedAt: new Date(Date.now() - 20 * 86_400_000),
        },
      });
      await h.app.get(DeletionService).purge(a.id);
      const rows = await h.prisma.dmMessage.findMany({
        where: { senderId: a.id },
      });
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.body).toBeNull();
        expect(r.status).toBe("DELETED_BY_AUTHOR");
      }
      expect(
        (await h.prisma.voiceClip.findUniqueOrThrow({ where: { id: clipId } }))
          .status,
      ).toBe("REMOVED");
      // the recipient sees tombstones, no words, and cannot play the clip
      const page = await get(
        b,
        `/dm/conversations/${t.body.message.conversationId}/messages`,
      ).expect(200);
      expect(JSON.stringify(page.body)).not.toContain("words that will go");
      expect(
        page.body.items.every((i: { clip: unknown }) => i.clip === null),
      ).toBe(true);
      await get(b, `/voice-clips/${clipId}/play`).expect(404);
      // the money records stay
      expect(await h.prisma.charge.count({ where: { userId: a.id } })).toBe(2);
      expect(
        await h.prisma.ledgerTransaction.count({
          where: {
            kind: "SPEND_POST",
            entries: { some: { walletUserId: a.id } },
          },
        }),
      ).toBe(2);
    });
  });

  it("a repeat of a stored send still returns it after verification has lapsed (the sender already paid)", async () => {
    const a = await makePerson(h, { balanceMilli: 100 * MILLI });
    await verify(a);
    const b = await member();
    const key = randomUUID();
    const r1 = await sendText(a, b, "paid for", key).expect(201);
    await verify(a, { days: -1 });
    await h.prisma.idempotencyRecord.deleteMany({ where: { actorId: a.id } });
    const r2 = await sendText(a, b, "paid for", key).expect(201);
    expect(r2.body.message.id).toBe(r1.body.message.id);
    await sendText(a, b, "new one").expect(403);
  });

  it("direct messages have their own rate bucket: a burst of them does not stop an answer, and the reverse", async () => {
    const a = await sender(1000);
    const b = await member();
    const guard = h.app.get(RateLimitGuard);
    guard.reset();
    await h.prisma.configEntry.upsert({
      where: { key: "ratelimit.dm_per_min" },
      create: { key: "ratelimit.dm_per_min", valueJson: 2 },
      update: { valueJson: 2 },
    });
    h.app.get(ConfigReader).invalidate();
    try {
      await sendText(a, b, "one").expect(201);
      await sendText(a, b, "two").expect(201);
      const r = await sendText(a, b, "three").expect(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
      // an answer is still allowed
      const q = await h.prisma.question.create({
        data: { text: "A question for the bucket test?", status: "LIVE" },
      });
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", a.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "TEXT", body: "an answer" })
        .expect(201);
      // and answers do not use up the DM bucket
      guard.reset();
      await sendText(a, b, "four").expect(201);
      for (let i = 0; i < 3; i++) {
        const q2 = await h.prisma.question.create({
          data: { text: `Another question ${i}?`, status: "LIVE" },
        });
        await h
          .http()
          .post(`/api/v1/questions/${q2.id}/answers`)
          .set("Authorization", a.auth)
          .set("Idempotency-Key", randomUUID())
          .send({ kind: "TEXT", body: "answer" })
          .expect(201);
      }
      await sendText(a, b, "five").expect(201);
    } finally {
      await clearCfg("ratelimit.dm_per_min");
    }
  });

  it("a person's own direct messages are in their data export: text, times and the other handle, no voice file", async () => {
    const a = await sender(1000);
    const b = await member();
    await sendText(a, b, "exported words").expect(201);
    const clipId = await readyClip(a, 4000);
    await send(a, { toUserId: b.id, kind: "VOICE", clipId }).expect(201);
    const { ExportService, ExportStore } =
      await import("../../src/me/export.service.js");
    const store = h.app.get(ExportStore);
    const put: Record<string, Buffer> = {};
    jest.spyOn(store, "isConfigured").mockReturnValue(true);
    jest.spyOn(store, "put").mockImplementation((k, buf) => {
      put[k] = buf;
      return Promise.resolve();
    });
    const ex = await h.prisma.dataExport.create({
      data: { userId: b.id, status: "PENDING" },
    });
    await h.app.get(ExportService).build(ex.id, b.id);
    jest.restoreAllMocks();
    const body = JSON.parse(Object.values(put)[0].toString("utf8")) as {
      directMessages: {
        direction: string;
        otherHandle: string;
        body: string | null;
        kind: string;
      }[];
    };
    expect(body.directMessages).toHaveLength(2);
    expect(body.directMessages[0]).toMatchObject({
      direction: "received",
      kind: "TEXT",
      body: "exported words",
    });
    expect(body.directMessages[1]).toMatchObject({ kind: "VOICE", body: null });
    const handleA = (
      await h.prisma.user.findUniqueOrThrow({ where: { id: a.id } })
    ).handle;
    expect(body.directMessages[0].otherHandle).toBe(handleA);
    expect(JSON.stringify(body)).not.toContain(clipId);
  });

  it("the approval mail E13 says a verified person can also message other people, in html and text, with no dash", async () => {
    const { renderMail } = await import("../../src/mail/mail-render.js");
    const { MAIL_TEMPLATES } = await import("../../src/mail/mail-templates.js");
    const out = renderMail("E13", MAIL_TEMPLATES.E13.subject, {
      first_name: "Ada",
      app_url: "https://usevoices.com",
      asset_base: "https://id.wawuafrica.com/assets/voices",
      until_date: "14 Feb 2027",
      verify_url: "https://usevoices.com/verify",
    });
    if (!out.ok) throw new Error(`E13 missing ${out.missing.join(",")}`);
    expect(out.html).toContain("message other people");
    expect(out.text).toContain("message other people");
    for (const t of [out.subject, out.html, out.text])
      expect(t).not.toMatch(/[\u2013\u2014]/);
  });
});
