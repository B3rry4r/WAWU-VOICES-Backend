/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";
import { MailService } from "../../src/mail/mail.service";
import { renderMail } from "../../src/mail/mail-render";
import { MAIL_TEMPLATES } from "../../src/mail/mail-templates";
import { ExportService, ExportStore } from "../../src/me/export.service";
import { DeletionService } from "../../src/me/deletion.service";
import { VerificationService } from "../../src/verify/verification.service";
import { isVerifiedNow, requireVerified } from "../../src/verify/verified";
import { sniffDocument } from "../../src/verify/sniff";
import { endOfPlan } from "../../src/verify/verification.dates";
import {
  REJECT_REASONS,
  reasonText,
} from "../../src/verify/verification.reasons";
import type { Person } from "../talk/harness";
import {
  HEIC,
  JPEG,
  PDF,
  PNG,
  WEBP,
  boot,
  dayPlus,
  giveSubscription,
  type World,
} from "./harness";

const DAY = 86_400_000;
const idem = () => ({ "Idempotency-Key": randomUUID() });

describe("V-46 verification", () => {
  let w: World;
  let svc: VerificationService;
  let mails: {
    template: string;
    userId: string;
    vars: Record<string, unknown>;
  }[];
  let admin: Person;
  let admin2: Person;

  beforeAll(async () => {
    w = await boot();
    svc = w.app.get(VerificationService);
    const mail = w.app.get(MailService);
    mails = [];
    jest.spyOn(mail, "notify").mockImplementation((job: unknown) => {
      mails.push(job as never);
    });
    admin = await w.person({ roles: ["ADMIN"] });
    admin2 = await w.person({ roles: ["ADMIN"] });
  });
  afterAll(() => w.close());
  beforeEach(() => {
    mails.length = 0;
    w.store.failDelete = false;
  });

  // ------------------------------------------------------------------ helpers
  const put = (p: Person, kind: string, body: Buffer, type = "image/jpeg") =>
    w
      .http()
      .put(`/api/v1/me/verification/documents/${kind}`)
      .set("Authorization", p.auth)
      .set("Content-Type", type)
      .send(body);
  const state = (p: Person) =>
    w.http().get("/api/v1/me/verification").set("Authorization", p.auth);
  const submit = (p: Person) =>
    w
      .http()
      .post("/api/v1/me/verification/submit")
      .set("Authorization", p.auth);
  const adminGet = (p: Person | null, path: string) => {
    const r = w.http().get(`/api/v1/admin/verification${path}`);
    return p ? r.set("Authorization", p.auth) : r;
  };
  const adminPost = (p: Person | null, path: string, body: object = {}) => {
    const r = w.http().post(`/api/v1/admin/verification${path}`).send(body);
    return p ? r.set("Authorization", p.auth) : r;
  };
  /** A subscribed person who has sent both documents. */
  async function pending(o: { endDay?: string } = {}) {
    const p = await w.person();
    const sub = await giveSubscription(w.prisma, p.id, { endDay: o.endDay });
    await put(p, "id", JPEG).expect(200);
    await put(p, "bill", PDF, "application/pdf").expect(200);
    await submit(p).expect(200);
    const req = await w.prisma.verificationRequest.findFirstOrThrow({
      where: { userId: p.id },
    });
    return { p, sub, req };
  }
  const verifiedPerson = async () => {
    const x = await pending();
    await adminPost(admin, `/${x.req.id}/approve`).expect(200);
    return x;
  };

  // ------------------------------------------------------------------ the helper everyone shares
  describe("isVerifiedNow and requireVerified", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    it("is true only while verifiedUntil is in the future", () => {
      expect(isVerifiedNow({ verifiedUntil: null }, now)).toBe(false);
      expect(
        isVerifiedNow({ verifiedUntil: new Date(now.getTime() - 1) }, now),
      ).toBe(false);
      expect(
        isVerifiedNow({ verifiedUntil: new Date(now.getTime()) }, now),
      ).toBe(false);
      expect(
        isVerifiedNow({ verifiedUntil: new Date(now.getTime() + 1) }, now),
      ).toBe(true);
    });
    it("when a status is given it must be APPROVED; left out, only the date counts", () => {
      const future = new Date(now.getTime() + DAY);
      expect(isVerifiedNow({ verifiedUntil: future }, now)).toBe(true);
      for (const s of ["PENDING", "REJECTED", "DRAFT", null])
        expect(
          isVerifiedNow({ verifiedUntil: future, verificationStatus: s }, now),
        ).toBe(false);
      expect(
        isVerifiedNow(
          { verifiedUntil: future, verificationStatus: "APPROVED" },
          now,
        ),
      ).toBe(true);
    });
    it("requireVerified throws 403 verification_required with the words of the route", () => {
      let err: any;
      try {
        requireVerified({ verifiedUntil: null }, { now });
      } catch (e) {
        err = e;
      }
      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toEqual({
        code: "verification_required",
        message: "Subscribe and get verified to suggest ideas.",
      });
      try {
        requireVerified({ verifiedUntil: null }, { message: "DM words" });
      } catch (e) {
        err = e;
      }
      expect(err.getResponse().message).toBe("DM words");
      expect(() =>
        requireVerified({ verifiedUntil: new Date(Date.now() + DAY) }),
      ).not.toThrow();
    });
  });

  describe("the real type of a file", () => {
    it("reads jpeg, png, webp, heic and pdf from the bytes, and nothing else", () => {
      expect(sniffDocument(JPEG)).toBe("image/jpeg");
      expect(sniffDocument(PNG)).toBe("image/png");
      expect(sniffDocument(WEBP)).toBe("image/webp");
      expect(sniffDocument(HEIC)).toBe("image/heic");
      expect(sniffDocument(PDF)).toBe("application/pdf");
      expect(
        sniffDocument(Buffer.from("hello, this is not an image")),
      ).toBeNull();
      expect(sniffDocument(Buffer.from("MZ" + "\0".repeat(40)))).toBeNull();
      expect(
        sniffDocument(Buffer.from("<svg xmlns=''></svg><script>")),
      ).toBeNull();
      expect(sniffDocument(Buffer.alloc(3, 0xff))).toBeNull();
      // an mp4 is an ftyp box too, but not a photo brand
      expect(
        sniffDocument(
          Buffer.concat([
            Buffer.from([0, 0, 0, 0x18]),
            Buffer.from("ftypisom"),
            Buffer.alloc(20),
          ]),
        ),
      ).toBeNull();
    });
  });

  // ------------------------------------------------------------------ uploading
  describe("uploading", () => {
    it("without a subscription: 403 subscription_required, and nothing is stored", async () => {
      const p = await w.person();
      const before = w.store.objects.size;
      const r = await put(p, "id", JPEG).expect(403);
      expect(r.body.error.code).toBe("subscription_required");
      expect(r.body.error.message).toBe("Subscribe to get verified.");
      await submit(p).expect(403);
      expect(w.store.objects.size).toBe(before);
      expect(
        await w.prisma.verificationRequest.count({ where: { userId: p.id } }),
      ).toBe(0);
      const s = await state(p).expect(200);
      expect(s.body.state).toBe("NOT_SUBSCRIBED");
      expect(s.body.canUpload).toBe(false);
    });

    it("an ended or queued-only plan is no subscription", async () => {
      const ended = await w.person();
      await giveSubscription(w.prisma, ended.id, {
        startDay: dayPlus(-100),
        endDay: dayPlus(-1),
        status: "ENDED",
      });
      await put(ended, "id", JPEG).expect(403);
      const future = await w.person();
      await giveSubscription(w.prisma, future.id, {
        startDay: dayPlus(5),
        endDay: dayPlus(95),
        status: "QUEUED",
      });
      await put(future, "id", JPEG).expect(403);
      // an ACTIVE row whose end day has passed (the monthly job has not run yet) is not current either
      const lagging = await w.person();
      await giveSubscription(w.prisma, lagging.id, {
        startDay: dayPlus(-100),
        endDay: dayPlus(0),
      });
      await put(lagging, "id", JPEG).expect(403);
    });

    it("a guest and a bad token get 401", async () => {
      await w
        .http()
        .put("/api/v1/me/verification/documents/id")
        .send(JPEG)
        .expect(401);
      await w.http().get("/api/v1/me/verification").expect(401);
    });

    it("stores both documents privately under verification/ and never shows a key or link to the person", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      const a = await put(p, "id", JPEG).expect(200);
      expect(a.body.state).toBe("READY");
      expect(a.body.documents).toEqual({ id: true, bill: false });
      expect(a.body.canSubmit).toBe(false);
      const b = await put(p, "bill", PDF, "application/pdf").expect(200);
      expect(b.body.documents).toEqual({ id: true, bill: true });
      expect(b.body.canSubmit).toBe(true);
      const row = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: p.id },
      });
      expect(row.idDocKey).toMatch(/^verification\//);
      expect(row.billDocKey).toMatch(/^verification\//);
      expect(row.idDocMime).toBe("image/jpeg");
      expect(row.billDocMime).toBe("application/pdf");
      const text =
        JSON.stringify(b.body) + JSON.stringify((await state(p)).body);
      expect(text).not.toContain("verification/");
      expect(text).not.toContain(row.idDocKey as string);
      expect(text).not.toContain("signed.test");
    });

    it("heic, png and webp are accepted as photos", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      await put(p, "id", HEIC, "image/heic").expect(200);
      await put(p, "bill", PNG, "image/png").expect(200);
      await put(p, "id", WEBP, "image/webp").expect(200);
    });

    it("a wrong file with a .jpg name or an image content type is 415 and stores nothing", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      const before = w.store.objects.size;
      const text = Buffer.from(
        "this is a text file pretending to be photo.jpg ".repeat(5),
      );
      const r = await put(p, "id", text, "image/jpeg").expect(415);
      expect(r.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      await put(
        p,
        "id",
        Buffer.from("MZ" + "\0".repeat(100)),
        "image/jpeg",
      ).expect(415);
      await put(
        p,
        "bill",
        Buffer.from("<html><script>alert(1)</script></html>"),
        "application/pdf",
      ).expect(415);
      await w
        .http()
        .put("/api/v1/me/verification/documents/id?name=photo.jpg")
        .set("Authorization", p.auth)
        .set("Content-Disposition", 'attachment; filename="id.jpg"')
        .set("Content-Type", "image/jpeg")
        .send(text)
        .expect(415);
      expect(w.store.objects.size).toBe(before);
    });

    it("a real jpeg sent as application/octet-stream is fine: the bytes decide, not the header", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      await put(p, "id", JPEG, "application/octet-stream").expect(200);
    });

    it("more than 10 MB is 413, an empty body is 422, a JSON body is 415, an unknown kind is 422", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
      await put(p, "id", big).expect(413);
      await put(p, "id", Buffer.alloc(0)).expect(422);
      await w
        .http()
        .put("/api/v1/me/verification/documents/id")
        .set("Authorization", p.auth)
        .send({ file: "x" })
        .expect(415);
      await put(p, "passport", JPEG).expect(422);
      // exactly 10 MB is allowed
      const exact = Buffer.concat([
        JPEG,
        Buffer.alloc(10 * 1024 * 1024 - JPEG.length),
      ]);
      expect(exact.length).toBe(10 * 1024 * 1024);
      await put(p, "id", exact).expect(200);
    });

    it("sending a document again replaces it and deletes the old file", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      await put(p, "id", JPEG).expect(200);
      const first = (
        await w.prisma.verificationRequest.findFirstOrThrow({
          where: { userId: p.id },
        })
      ).idDocKey as string;
      await put(p, "id", PNG, "image/png").expect(200);
      const row = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: p.id },
      });
      expect(row.idDocKey).not.toBe(first);
      expect(w.store.objects.has(first)).toBe(false);
      expect(w.store.objects.has(row.idDocKey as string)).toBe(true);
    });

    it("two uploads at once leave one draft", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      const r = await Promise.all([
        put(p, "id", JPEG),
        put(p, "bill", PNG, "image/png"),
      ]);
      expect(r.map((x) => x.status)).toEqual([200, 200]);
      expect(
        await w.prisma.verificationRequest.count({ where: { userId: p.id } }),
      ).toBe(1);
      expect((await state(p)).body.documents).toEqual({ id: true, bill: true });
    });

    it("submit needs both documents (422 naming the missing one), then the request is with the team", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      const none = await submit(p).expect(422);
      expect(
        none.body.error.details.fields.map((f: any) => f.path).sort(),
      ).toEqual(["bill", "id"]);
      await put(p, "id", JPEG).expect(200);
      const one = await submit(p).expect(422);
      expect(one.body.error.details.fields).toEqual([
        { path: "bill", message: "Add your utility bill." },
      ]);
      await put(p, "bill", PDF, "application/pdf").expect(200);
      const ok = await submit(p).expect(200);
      expect(ok.body.state).toBe("UNDER_REVIEW");
      expect(ok.body.canUpload).toBe(false);
      // the documents cannot be changed while the team looks at them, and sending twice is refused
      await put(p, "id", PNG, "image/png").expect(409);
      await submit(p).expect(409);
      expect(
        (await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .verificationStatus,
      ).toBe("PENDING");
    });
  });

  // ------------------------------------------------------------------ the admin queue
  describe("the admin queue", () => {
    it("a guest is 401; a person, a moderator and an editor are 403 on every admin route", async () => {
      const { req } = await pending();
      const plain = await w.person();
      const mod = await w.person({ roles: ["MODERATOR"] });
      await adminGet(null, "").expect(401);
      await adminPost(null, `/${req.id}/approve`).expect(401);
      for (const who of [plain, mod]) {
        await adminGet(who, "").expect(403);
        await adminGet(who, `/${req.id}`).expect(403);
        const a = await adminPost(who, `/${req.id}/approve`).expect(403);
        expect(a.body.error.code).toBe("ROLE_REQUIRED");
        await adminPost(who, `/${req.id}/reject`, {
          reasonCode: "ID_EXPIRED",
        }).expect(403);
      }
      expect(
        (
          await w.prisma.verificationRequest.findUniqueOrThrow({
            where: { id: req.id },
          })
        ).status,
      ).toBe("PENDING");
      expect(w.store.links.filter((l) => l.key === req.idDocKey)).toHaveLength(
        0,
      );
    });

    it("lists pending first, oldest first, with the person and the plan", async () => {
      await w.prisma.$executeRawUnsafe(
        `UPDATE "VerificationRequest" SET status = 'REJECTED', "decidedAt" = now() WHERE status = 'PENDING'`,
      );
      const a = await pending();
      const b = await pending();
      const c = await pending();
      await w.prisma.verificationRequest.update({
        where: { id: a.req.id },
        data: { submittedAt: new Date(Date.now() - 3000) },
      });
      await w.prisma.verificationRequest.update({
        where: { id: b.req.id },
        data: { submittedAt: new Date(Date.now() - 9000) },
      });
      const r = await adminGet(admin, "").expect(200);
      expect(r.body.items.map((i: any) => i.id)).toEqual([
        b.req.id,
        a.req.id,
        c.req.id,
      ]);
      const first = r.body.items[0];
      expect(first.person.handle).toBe(
        (await w.prisma.user.findUniqueOrThrow({ where: { id: b.p.id } }))
          .handle,
      );
      expect(first.subscription.planName).toBeTruthy();
      expect(first.subscription.endDay).toBe(b.sub.endDay);
      expect(JSON.stringify(r.body)).not.toContain("verification/");
      expect(JSON.stringify(r.body)).not.toContain("signed.test");
      // a page of two, then the rest
      const p1 = await adminGet(admin, "?limit=2").expect(200);
      expect(p1.body.items).toHaveLength(2);
      const p2 = await adminGet(
        admin,
        `?limit=2&cursor=${p1.body.nextCursor}`,
      ).expect(200);
      expect(p2.body.items.map((i: any) => i.id)).toEqual([c.req.id]);
      expect(p2.body.nextCursor).toBeNull();
    });

    it("the detail has no links; each document is opened on its own, lives 5 minutes, and only that look is audited (no links in the log)", async () => {
      const { req } = await pending();
      const d = await w
        .http()
        .get(`/api/v1/admin/verification/${req.id}`)
        .set("Authorization", admin.auth)
        .expect(200);
      expect(d.headers["cache-control"]).toContain("no-store");
      expect(d.body.idDocument).toEqual({ mime: "image/jpeg" });
      expect(d.body.billDocument).toEqual({ mime: "application/pdf" });
      expect(JSON.stringify(d.body)).not.toContain("signed.test");
      const links = w.store.links.length;
      expect(
        await w.prisma.auditLog.count({
          where: { action: "verification.view", targetId: req.id },
        }),
      ).toBe(0);
      await adminGet(admin, `/${req.id}`).expect(200);
      await adminGet(admin, "").expect(200);
      expect(w.store.links.length).toBe(links);
      for (const kind of ["id", "bill"]) {
        const r = await adminGet(admin, `/${req.id}/documents/${kind}`).expect(
          200,
        );
        expect(r.headers["cache-control"]).toContain("no-store");
        const ms = new Date(r.body.expiresAt).getTime() - Date.now();
        expect(ms).toBeGreaterThan(240_000);
        expect(ms).toBeLessThanOrEqual(300_500);
        expect(r.body.url).toContain("signed.test/verification/");
      }
      expect(w.store.links.length).toBe(links + 2);
      const audit = await w.prisma.auditLog.findMany({
        where: { action: "verification.view", targetId: req.id },
      });
      expect(audit).toHaveLength(2);
      expect(audit.every((a) => a.actorId === admin.id)).toBe(true);
      expect(JSON.stringify(audit)).not.toContain("signed.test");
      expect(JSON.stringify(audit)).not.toContain("verification/");
      await adminGet(admin, `/${req.id}/documents/passport`).expect(404);
      const plain = await w.person();
      await adminGet(plain, `/${req.id}/documents/id`).expect(403);
      await adminGet(null, `/${req.id}/documents/id`).expect(401);
      await adminGet(admin, `/${randomUUID()}`).expect(404);
      await adminGet(admin, `/not-a-uuid`).expect(404);
    });

    it("a draft is not in the queue and has no detail", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      await put(p, "id", JPEG).expect(200);
      const d = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: p.id },
      });
      await adminGet(admin, `/${d.id}`).expect(404);
      await adminPost(admin, `/${d.id}/approve`).expect(404);
    });
  });

  // ------------------------------------------------------------------ deciding
  describe("deciding", () => {
    it("approve: verified until the plan ends, an audit row, a mail, and the tick shows on the profile and the answers", async () => {
      const { p, sub, req } = await pending();
      const r = await adminPost(admin, `/${req.id}/approve`).expect(200);
      expect(r.body.status).toBe("APPROVED");
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } });
      expect(u.verificationStatus).toBe("APPROVED");
      expect(u.verifiedUntil?.toISOString()).toBe(
        endOfPlan(sub.endDay).toISOString(),
      );
      const row = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: req.id },
      });
      expect(row).toMatchObject({ status: "APPROVED", decidedById: admin.id });
      expect(row.decidedAt).toBeTruthy();
      const log = await w.prisma.auditLog.findFirstOrThrow({
        where: { action: "verification.approve", targetId: req.id },
      });
      expect(log.actorId).toBe(admin.id);
      expect(mails).toEqual([
        expect.objectContaining({
          template: "E13",
          userId: p.id,
          eventKey: `verification:${req.id}`,
        }),
      ]);
      const s = (await state(p)).body;
      expect(s.state).toBe("VERIFIED");
      expect(s.verified).toBe(true);
      expect(new Date(s.verifiedUntil).toISOString()).toBe(
        endOfPlan(sub.endDay).toISOString(),
      );
      // the tick: public profile and the author of an answer
      const q = await w.prisma.question.create({
        data: { text: "Q?", status: "LIVE" },
      });
      await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "TEXT",
          body: "my answer",
        },
      });
      const prof = await w.http().get(`/api/v1/people/${p.id}`).expect(200);
      expect(prof.body.profile.verified).toBe(true);
      expect(prof.body.recentAnswers[0].author.verified).toBe(true);
      const plain = await w.person();
      await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: plain.id,
          kind: "TEXT",
          body: "plain answer",
        },
      });
      const prof2 = await w
        .http()
        .get(`/api/v1/people/${plain.id}`)
        .expect(200);
      expect(prof2.body.profile.verified).toBe(false);
      expect(prof2.body.recentAnswers[0].author.verified).toBe(false);
      const list = await w.http().get(`/api/v1/questions/${q.id}/answers`);
      if (list.status === 200) {
        const mine = list.body.items.find((a: any) => a.author?.id === p.id);
        if (mine) expect(mine.author.verified).toBe(true);
      }
    });

    it("a second decision on the same request is 409, whatever it is, and nothing changes", async () => {
      const { p, req } = await pending();
      await adminPost(admin, `/${req.id}/approve`).expect(200);
      const again = await adminPost(admin2, `/${req.id}/approve`).expect(409);
      expect(again.body.error.code).toBe("CONFLICT");
      await adminPost(admin2, `/${req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
      }).expect(409);
      expect(
        (await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .verificationStatus,
      ).toBe("APPROVED");
      expect(
        await w.prisma.auditLog.count({
          where: {
            targetId: req.id,
            action: { in: ["verification.approve", "verification.reject"] },
          },
        }),
      ).toBe(1);
      expect(mails).toHaveLength(1);
    });

    it("two admins deciding at the same moment: exactly one wins, the other gets 409", async () => {
      for (let i = 0; i < 4; i++) {
        const { p, req } = await pending();
        mails.length = 0;
        const [a, b] = await Promise.all([
          adminPost(admin, `/${req.id}/approve`),
          adminPost(admin2, `/${req.id}/reject`, {
            reasonCode: "ID_UNREADABLE",
          }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const row = await w.prisma.verificationRequest.findUniqueOrThrow({
          where: { id: req.id },
        });
        const u = await w.prisma.user.findUniqueOrThrow({
          where: { id: p.id },
        });
        expect(u.verificationStatus).toBe(row.status);
        expect(
          await w.prisma.auditLog.count({
            where: {
              targetId: req.id,
              action: { in: ["verification.approve", "verification.reject"] },
            },
          }),
        ).toBe(1);
        expect(mails).toHaveLength(1);
      }
    });

    it("an admin cannot decide their own request", async () => {
      const me = admin2;
      await giveSubscription(w.prisma, me.id);
      await put(me, "id", JPEG).expect(200);
      await put(me, "bill", PNG, "image/png").expect(200);
      await submit(me).expect(200);
      const req = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: me.id, status: "PENDING" },
      });
      await adminPost(me, `/${req.id}/approve`).expect(403);
      await adminPost(me, `/${req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
      }).expect(403);
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "OTHER",
        note: "Test over",
      }).expect(200);
    });

    it("approving someone whose subscription already ended is 409 and leaves the request open", async () => {
      const { p, sub, req } = await pending();
      await w.prisma.subscription.update({
        where: { id: sub.id },
        data: { endDay: dayPlus(-1), status: "ENDED" },
      });
      const r = await adminPost(admin, `/${req.id}/approve`).expect(409);
      expect(r.body.error.message).toMatch(/no current subscription/);
      expect(
        (
          await w.prisma.verificationRequest.findUniqueOrThrow({
            where: { id: req.id },
          })
        ).status,
      ).toBe("PENDING");
      expect((await state(p)).body.state).toBe("UNDER_REVIEW");
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "SUBSCRIPTION_ENDED",
      }).expect(200);
    });

    it("reject: a code is required, OTHER needs a note, dashes become hyphens, the person reads plain words", async () => {
      const { p, req } = await pending();
      await adminPost(admin, `/${req.id}/reject`, {}).expect(422);
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "BECAUSE",
      }).expect(422);
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "OTHER",
      }).expect(422);
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "OTHER",
        note: "   ",
      }).expect(422);
      expect(
        (
          await w.prisma.verificationRequest.findUniqueOrThrow({
            where: { id: req.id },
          })
        ).status,
      ).toBe("PENDING");
      const r = await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "BILL_TOO_OLD",
        note: "The bill is from March — please send this month’s.",
      }).expect(200);
      expect(r.body.status).toBe("REJECTED");
      const s = (await state(p)).body;
      expect(s.state).toBe("REJECTED");
      expect(s.verified).toBe(false);
      expect(s.canUpload).toBe(true);
      expect(s.request.reason).toBe(
        `${REJECT_REASONS.BILL_TOO_OLD} The bill is from March - please send this month’s.`,
      );
      expect(s.request.reason).not.toMatch(/[–—]/);
      const log = await w.prisma.auditLog.findFirstOrThrow({
        where: { action: "verification.reject", targetId: req.id },
      });
      expect(log.actorId).toBe(admin.id);
      expect(log.reason).toBe(s.request.reason);
      expect(mails[0]).toMatchObject({ template: "E14", userId: p.id });
      expect(mails[0].vars.reason).toBe(s.request.reason);
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } });
      expect(u).toMatchObject({
        verificationStatus: "REJECTED",
        verifiedUntil: null,
      });
    });

    it("every reject reason reads as plain words with no em-dash", () => {
      for (const [code, text] of Object.entries(REJECT_REASONS)) {
        expect(text).not.toMatch(/[–—]/);
        expect(reasonText(code, null)).toBe(text);
      }
      expect(reasonText(null, "x")).toContain("x");
    });

    it("a rejected person uploads again, the old files go, and a new approval verifies them", async () => {
      const { p, req } = await pending();
      const oldKeys = [req.idDocKey, req.billDocKey] as string[];
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "ID_UNREADABLE",
      }).expect(200);
      expect(oldKeys.every((k) => w.store.objects.has(k))).toBe(true); // kept for 90 days unless replaced
      const up = await put(p, "id", PNG, "image/png").expect(200);
      expect(up.body.state).toBe("READY");
      expect(up.body.documents).toEqual({ id: true, bill: false });
      expect(oldKeys.some((k) => w.store.objects.has(k))).toBe(false);
      const old = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: req.id },
      });
      expect(old).toMatchObject({
        status: "REJECTED",
        idDocKey: null,
        billDocKey: null,
      });
      expect(old.docsPurgedAt).toBeTruthy();
      expect(old.decidedById).toBe(admin.id);
      await put(p, "bill", PDF, "application/pdf").expect(200);
      await submit(p).expect(200);
      expect(
        await w.prisma.verificationRequest.count({ where: { userId: p.id } }),
      ).toBe(2);
      const second = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: p.id, status: "PENDING" },
      });
      await adminPost(admin2, `/${second.id}/approve`).expect(200);
      expect((await state(p)).body.verified).toBe(true);
    });

    it("someone already verified cannot send documents again", async () => {
      const { p } = await verifiedPerson();
      const r = await put(p, "id", JPEG).expect(409);
      expect(r.body.error.message).toBe("You are already verified.");
      await submit(p).expect(409);
    });
  });

  // ------------------------------------------------------------------ the unlock
  describe("suggesting an idea needs a verified person", () => {
    const suggest = (qid: string, p: Person, body = "Fix the roads first") =>
      w
        .http()
        .post(`/api/v1/questions/${qid}/proposals`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "TEXT", body });
    let qid: string;
    beforeAll(async () => {
      qid = (
        await w.prisma.question.create({
          data: { text: "What next?", status: "LIVE" },
        })
      ).id;
    });

    it("an unverified person gets 403 verification_required with the words, a verified one gets 201", async () => {
      const plain = await w.person();
      const r = await suggest(qid, plain).expect(403);
      expect(r.body.error.code).toBe("verification_required");
      expect(r.body.error.message).toBe(
        "Subscribe and get verified to suggest ideas.",
      );
      const { p } = await verifiedPerson();
      const ok = await suggest(qid, p).expect(201);
      expect(ok.body.proposal.author.verified).toBe(true);
    });

    it("subscribed but not yet approved, pending, and rejected people are all refused", async () => {
      const sub = await w.person();
      await giveSubscription(w.prisma, sub.id);
      await suggest(qid, sub).expect(403);
      const { p, req } = await pending();
      await suggest(qid, p).expect(403);
      await adminPost(admin, `/${req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
      }).expect(200);
      await suggest(qid, p).expect(403);
    });

    it("reading and voting on What Next stay open to everyone", async () => {
      const plain = await w.person();
      await w
        .http()
        .get(`/api/v1/questions/${qid}/proposals`)
        .set("Authorization", plain.auth)
        .expect(200);
      await w.http().get(`/api/v1/questions/${qid}/proposals`).expect(200);
      const { p } = await verifiedPerson();
      const prop = (await suggest(qid, p, "Build more clinics").expect(201))
        .body.proposal.id;
      await w
        .http()
        .put(`/api/v1/proposals/${prop}/stance`)
        .set("Authorization", plain.auth)
        .set(idem())
        .send({ kind: "SUPPORT" })
        .expect((res) => expect(res.status).toBeLessThan(300));
    });

    it("an expired subscription loses the unlock at once (the stored date has passed)", async () => {
      const { p, sub } = await verifiedPerson();
      await suggest(qid, p, "Idea before expiry").expect(201);
      await w.prisma.user.update({
        where: { id: p.id },
        data: { verifiedUntil: new Date(Date.now() - 1000) },
      });
      await w.prisma.subscription.update({
        where: { id: sub.id },
        data: { endDay: dayPlus(-1), status: "ENDED" },
      });
      const r = await suggest(qid, p, "Idea after expiry").expect(403);
      expect(r.body.error.code).toBe("verification_required");
      const s = (await state(p)).body;
      expect(s.verified).toBe(false);
      expect(s.state).toBe("NOT_SUBSCRIBED");
    });

    it("a plan that is cancelled early ends verification at the next sync, and the gate follows", async () => {
      const { p, sub } = await verifiedPerson();
      await w.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELLED_DELETED" },
      });
      // still in the future until the job runs
      expect(await svc.syncAll()).toBeGreaterThanOrEqual(1);
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } });
      expect(u.verifiedUntil!.getTime()).toBeLessThanOrEqual(Date.now());
      await suggest(qid, p, "after the plan was cancelled").expect(403);
    });

    it("a renewal follows: a plan waiting behind the running one extends verifiedUntil", async () => {
      const { p, sub } = await verifiedPerson();
      const next = await giveSubscription(w.prisma, p.id, {
        startDay: sub.endDay,
        endDay: dayPlus(170),
        status: "QUEUED",
      });
      await svc.syncAll();
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: p.id } });
      expect(u.verifiedUntil?.toISOString()).toBe(
        endOfPlan(next.endDay).toISOString(),
      );
      expect((await state(p)).body.subscription).toBeTruthy();
    });

    it("a new plan bought after the old one ended, within 90 days, verifies again with no new documents; after 90 days it does not", async () => {
      const { p, sub } = await verifiedPerson();
      await w.prisma.subscription.update({
        where: { id: sub.id },
        data: { endDay: dayPlus(-5), status: "ENDED" },
      });
      await w.prisma.user.update({
        where: { id: p.id },
        data: { verifiedUntil: new Date(Date.now() - 5 * DAY) },
      });
      expect((await state(p)).body.state).toBe("NOT_SUBSCRIBED");
      await giveSubscription(w.prisma, p.id, {
        startDay: dayPlus(-1),
        endDay: dayPlus(89),
      });
      const s = (await state(p)).body; // the person's own view heals at once
      expect(s.state).toBe("VERIFIED");
      await suggest(qid, p, "back after renewing").expect(201);
      // a different person, lapsed 120 days ago
      const old = await verifiedPerson();
      await w.prisma.subscription.update({
        where: { id: old.sub.id },
        data: { endDay: dayPlus(-120), status: "ENDED" },
      });
      await w.prisma.user.update({
        where: { id: old.p.id },
        data: { verifiedUntil: new Date(Date.now() - 120 * DAY) },
      });
      await giveSubscription(w.prisma, old.p.id, {
        startDay: dayPlus(-1),
        endDay: dayPlus(89),
      });
      const s2 = (await state(old.p)).body;
      expect(s2.verified).toBe(false);
      expect(s2.state).toBe("LAPSED");
      expect(s2.canUpload).toBe(true);
      await suggest(qid, old.p, "too long ago").expect(403);
      // they send documents again
      await put(old.p, "id", JPEG).expect(200);
    });
  });

  // ------------------------------------------------------------------ keeping and deleting the documents
  describe("private documents", () => {
    it("deletes both files 90 days after the decision and keeps the decision row", async () => {
      const a = await pending();
      await adminPost(admin, `/${a.req.id}/approve`).expect(200);
      const b = await pending();
      await adminPost(admin, `/${b.req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
      }).expect(200);
      const decided = new Date();
      // 89 days: nothing yet
      await svc.purgeDue(new Date(decided.getTime() + 89 * DAY));
      for (const x of [a, b]) {
        expect(w.store.objects.has(x.req.idDocKey as string)).toBe(true);
        expect(w.store.objects.has(x.req.billDocKey as string)).toBe(true);
      }
      // 91 days: both requests' files are gone
      const n = await svc.purgeDue(new Date(decided.getTime() + 91 * DAY));
      expect(n).toBeGreaterThanOrEqual(2);
      for (const x of [a, b]) {
        expect(w.store.objects.has(x.req.idDocKey as string)).toBe(false);
        expect(w.store.objects.has(x.req.billDocKey as string)).toBe(false);
        const row = await w.prisma.verificationRequest.findUniqueOrThrow({
          where: { id: x.req.id },
        });
        expect(row.idDocKey).toBeNull();
        expect(row.billDocKey).toBeNull();
        expect(row.docsPurgedAt).toBeTruthy();
        expect(row.decidedById).toBe(admin.id);
        expect(row.decidedAt).toBeTruthy();
        expect(["APPROVED", "REJECTED"]).toContain(row.status);
      }
      expect(
        (
          await w.prisma.verificationRequest.findUniqueOrThrow({
            where: { id: b.req.id },
          })
        ).reasonCode,
      ).toBe("ID_EXPIRED");
      // the admin sees the decided row with its documents gone, and no links
      const d = await adminGet(admin, `/${a.req.id}`).expect(200);
      expect(d.body).toMatchObject({
        documentsDeleted: true,
        idDocument: null,
        billDocument: null,
      });
      const list = await adminGet(admin, "?status=decided").expect(200);
      expect(list.body.items.find((i: any) => i.id === b.req.id)).toMatchObject(
        { status: "REJECTED", documentsDeleted: true },
      );
      // a second pass finds nothing to do
      expect(await svc.purgeDue(new Date(decided.getTime() + 92 * DAY))).toBe(
        0,
      );
    });

    it("a file the bucket cannot delete keeps its key and is retried by the next pass", async () => {
      const a = await pending();
      await adminPost(admin, `/${a.req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
      }).expect(200);
      w.store.failDelete = true;
      const when = new Date(Date.now() + 100 * DAY);
      expect(await svc.purgeDue(when)).toBe(0);
      const row = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: a.req.id },
      });
      expect(row.docsPurgedAt).toBeNull();
      expect(row.idDocKey).toBeTruthy();
      w.store.failDelete = false;
      expect(await svc.purgeDue(when)).toBeGreaterThanOrEqual(1);
      expect(w.store.objects.has(a.req.idDocKey as string)).toBe(false);
    });

    it("a request nobody decides runs out after 90 days: files gone, state EXPIRED, the person can send again", async () => {
      const x = await pending();
      await svc.purgeDue(new Date(Date.now() + 89 * DAY));
      expect(w.store.objects.has(x.req.idDocKey as string)).toBe(true);
      expect(
        (
          await w.prisma.verificationRequest.findUniqueOrThrow({
            where: { id: x.req.id },
          })
        ).status,
      ).toBe("PENDING");
      await svc.purgeDue(new Date(Date.now() + 91 * DAY));
      const row = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: x.req.id },
      });
      expect(row).toMatchObject({
        status: "EXPIRED",
        idDocKey: null,
        billDocKey: null,
      });
      expect(row.docsPurgedAt).toBeTruthy();
      expect(w.store.objects.has(x.req.idDocKey as string)).toBe(false);
      expect(w.store.objects.has(x.req.billDocKey as string)).toBe(false);
      expect(
        (await w.prisma.user.findUniqueOrThrow({ where: { id: x.p.id } }))
          .verificationStatus,
      ).toBeNull();
      const s = (await state(x.p)).body;
      expect(s.state).toBe("EXPIRED");
      expect(s.canUpload).toBe(true);
      await put(x.p, "id", JPEG).expect(200);
      expect((await state(x.p)).body.state).toBe("READY");
      // an expired request is not in either admin queue
      const ids = [
        ...(await adminGet(admin, "").expect(200)).body.items,
        ...(await adminGet(admin, "?status=decided").expect(200)).body.items,
      ].map((i: any) => i.id);
      expect(ids).not.toContain(x.req.id);
    });

    it("a draft nobody sent is thrown away after two weeks", async () => {
      const p = await w.person();
      await giveSubscription(w.prisma, p.id);
      await put(p, "id", JPEG).expect(200);
      const d = await w.prisma.verificationRequest.findFirstOrThrow({
        where: { userId: p.id },
      });
      await svc.purgeDue(new Date(Date.now() + 13 * DAY));
      expect(w.store.objects.has(d.idDocKey as string)).toBe(true);
      await svc.purgeDue(new Date(Date.now() + 15 * DAY));
      expect(w.store.objects.has(d.idDocKey as string)).toBe(false);
      expect(
        await w.prisma.verificationRequest.count({ where: { id: d.id } }),
      ).toBe(0);
    });

    it("deleting the account removes the documents at once, closes a waiting request and keeps the decision rows", async () => {
      const done = await pending();
      await adminPost(admin, `/${done.req.id}/approve`).expect(200);
      const waiting = await pending();
      // the first person had a decision, then deletes; the second is still waiting
      for (const x of [done, waiting]) {
        await w.prisma.user.update({
          where: { id: x.p.id },
          data: {
            status: "DELETION_PENDING",
            deletionRequestedAt: new Date(Date.now() - 20 * DAY),
          },
        });
      }
      const del = w.app.get(DeletionService);
      await del.purgeDue(new Date());
      for (const x of [done, waiting]) {
        expect(w.store.objects.has(x.req.idDocKey as string)).toBe(false);
        expect(w.store.objects.has(x.req.billDocKey as string)).toBe(false);
        const row = await w.prisma.verificationRequest.findUniqueOrThrow({
          where: { id: x.req.id },
        });
        expect(row).toMatchObject({ idDocKey: null, billDocKey: null });
        expect(row.docsPurgedAt).toBeTruthy();
        const u = await w.prisma.user.findUniqueOrThrow({
          where: { id: x.p.id },
        });
        expect(u).toMatchObject({
          status: "DELETED",
          verifiedUntil: null,
          verificationStatus: null,
        });
      }
      const closed = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: waiting.req.id },
      });
      expect(closed.status).toBe("REJECTED");
      expect(closed.reasonCode).toBe("ACCOUNT_DELETED");
      const kept = await w.prisma.verificationRequest.findUniqueOrThrow({
        where: { id: done.req.id },
      });
      expect(kept).toMatchObject({ status: "APPROVED", decidedById: admin.id });
      // no admin route hands out a link for a deleted person's request
      await adminGet(admin, `/${waiting.req.id}`)
        .expect(200)
        .expect((r) => expect(r.body.idDocument).toBeNull());
    });

    it("nothing in the logs names a key, a link or a file", async () => {
      const text = w.logs.join("\n");
      expect(text).not.toContain("verification/");
      expect(text).not.toContain("signed.test");
      expect(text).not.toMatch(/\.(jpe?g|png|pdf|heic|webp)\b/i);
    });
  });

  describe("my data download", () => {
    it("holds the decision (outcome, date, reason) and never a file or a key", async () => {
      const a = await pending();
      await adminPost(admin, `/${a.req.id}/reject`, {
        reasonCode: "ID_EXPIRED",
        note: "It ran out in May.",
      }).expect(200);
      await put(a.p, "id", JPEG).expect(200);
      await put(a.p, "bill", PDF, "application/pdf").expect(200);
      await submit(a.p).expect(200);
      const store = w.app.get(ExportStore);
      const got: Buffer[] = [];
      jest.spyOn(store, "isConfigured").mockReturnValue(true);
      jest.spyOn(store, "put").mockImplementation((_k, body) => {
        got.push(body);
        return Promise.resolve();
      });
      const row = await w.prisma.dataExport.create({
        data: { userId: a.p.id },
      });
      await w.app.get(ExportService).build(row.id, a.p.id);
      const out = JSON.parse(got[0].toString());
      expect(out.verification.requests.map((r: any) => r.outcome)).toEqual([
        "REJECTED",
        "PENDING",
      ]);
      expect(out.verification.requests[0].reason).toContain(
        "It ran out in May.",
      );
      expect(out.verification.requests[0].decidedAt).toBeTruthy();
      expect(JSON.stringify(out)).not.toContain("verification/");
    });
  });

  // ------------------------------------------------------------------ the free allowance
  describe("2 free posts of up to 60 seconds (the migration and the defaults)", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "../../prisma/migrations/20261114130000_verification/migration.sql",
      ),
      "utf8",
    );
    const dataSteps = migration.slice(migration.indexOf("-- Data step 1"));
    async function run(sql: string) {
      const c = new Client({ connectionString: TEST_DATABASE_URL });
      await c.connect();
      try {
        await c.query(sql);
      } finally {
        await c.end();
      }
    }

    it("existing FreeAllowance rows become max(0, 2 - used), never negative", async () => {
      const rows: [number, number][] = [
        [10, 0],
        [9, 1],
        [8, 2],
        [7, 3],
        [0, 10],
        [4, 6],
        [10, 1],
      ];
      const ids: string[] = [];
      for (const [remaining, used] of rows) {
        const p = await w.person();
        ids.push(p.id);
        await w.prisma.freeAllowance.create({
          data: {
            userId: p.id,
            freePostsRemaining: remaining,
            freePostsUsed: used,
          },
        });
      }
      await run(dataSteps);
      const after = await w.prisma.freeAllowance.findMany({
        where: { userId: { in: ids } },
      });
      const by = new Map(after.map((a) => [a.userId, a]));
      expect(ids.map((id) => by.get(id)!.freePostsRemaining)).toEqual([
        2, 1, 0, 0, 0, 0, 1,
      ]);
      expect(after.every((a) => a.freePostsRemaining >= 0)).toBe(true);
      expect(ids.map((id) => by.get(id)!.freePostsUsed)).toEqual(
        rows.map((r) => r[1]),
      );
      // running it twice changes nothing more
      await run(dataSteps);
      const twice = await w.prisma.freeAllowance.findMany({
        where: { userId: { in: ids } },
      });
      expect(
        new Map(twice.map((a) => [a.userId, a.freePostsRemaining])),
      ).toEqual(new Map(after.map((a) => [a.userId, a.freePostsRemaining])));
    });

    it("the config rows still at the old default move to 2 and 60 and are logged; an admin's own number stays", async () => {
      await w.prisma.configEntry.deleteMany({
        where: {
          key: {
            in: [
              "allowance.free_posts",
              "voice.free_seconds",
              "allowance.free_post_text_chars",
            ],
          },
        },
      });
      await w.prisma.configChange.deleteMany({
        where: {
          key: {
            in: [
              "allowance.free_posts",
              "voice.free_seconds",
              "allowance.free_post_text_chars",
            ],
          },
        },
      });
      await w.prisma.configEntry.createMany({
        data: [
          { key: "allowance.free_posts", valueJson: 10 },
          { key: "voice.free_seconds", valueJson: 15 }, // an admin set this one
          { key: "allowance.free_post_text_chars", valueJson: 10 },
        ],
      });
      await run(dataSteps);
      const get = async (k: string) =>
        (await w.prisma.configEntry.findUniqueOrThrow({ where: { key: k } }))
          .valueJson;
      expect(await get("allowance.free_posts")).toBe(2);
      expect(await get("voice.free_seconds")).toBe(15);
      expect(await get("allowance.free_post_text_chars")).toBe(10);
      const ch = await w.prisma.configChange.findMany({
        where: { key: "allowance.free_posts" },
      });
      expect(ch).toHaveLength(1);
      expect(ch[0]).toMatchObject({
        oldValue: 10,
        newValue: 2,
        changedById: "system",
      });
      expect(
        await w.prisma.configChange.count({
          where: {
            key: {
              in: ["voice.free_seconds", "allowance.free_post_text_chars"],
            },
          },
        }),
      ).toBe(0);
      await w.prisma.configEntry.deleteMany({
        where: {
          key: {
            in: [
              "allowance.free_posts",
              "voice.free_seconds",
              "allowance.free_post_text_chars",
            ],
          },
        },
      });
    });

    it("with no config rows the public config says 2 free posts and 60 seconds, and a new account starts with 2", async () => {
      await w.prisma.configEntry.deleteMany({
        where: { key: { in: ["allowance.free_posts", "voice.free_seconds"] } },
      });
      const r = await w.http().get("/api/v1/config/public").expect(200);
      const text = JSON.stringify(r.body);
      expect(text).toContain('"freeVoiceSeconds":60');
      expect(text).toMatch(/"freePosts":2\b/);
      const p = await w.person();
      const a = await w
        .http()
        .get("/api/v1/me/allowance")
        .set("Authorization", p.auth)
        .expect(200);
      expect(a.body.freePostsRemaining).toBe(2);
      expect(a.body.costs.freeVoiceSeconds).toBe(60);
    });
  });

  // ------------------------------------------------------------------ the two mails
  describe("mail", () => {
    it("E13 and E14 are wired, fill with no field left over, have no em-dash, and carry the footer and the one contact", () => {
      expect(Object.keys(MAIL_TEMPLATES)).toEqual(
        expect.arrayContaining(["E13", "E14"]),
      );
      const vars = {
        first_name: "Ada",
        app_url: "https://usevoices.com",
        asset_base: "https://id.wawuafrica.com/assets/voices",
        until_date: "14 Feb 2027",
        reason:
          "We could not read your ID. Upload a clear, full photo or scan. Don't crop it.",
        verify_url: "https://usevoices.com/verify",
      };
      for (const id of ["E13", "E14"] as const) {
        const out = renderMail(id, MAIL_TEMPLATES[id].subject, vars);
        if (!out.ok) throw new Error(`${id} missing ${out.missing.join(",")}`);
        for (const s of [out.subject, out.html, out.text]) {
          expect(s).not.toMatch(/[–—]/);
          expect(s).not.toMatch(
            /\{\{|REGISTERED ADDRESS|support@usevoices|unsubscribe/i,
          );
        }
        expect(out.html).toContain("Voices by WAWU");
        expect(out.text).toContain("Voices by WAWU");
        expect(out.html).toContain("support@wawuafrica.com");
        expect(out.text).toContain("support@wawuafrica.com");
        expect(out.html).toContain("https://usevoices.com/verify");
      }
      const e14 = renderMail("E14", MAIL_TEMPLATES.E14.subject, vars);
      if (e14.ok)
        expect(e14.html).toContain("Don&#39;t crop it.".replace("&#39;", "'"));
    });
  });
});
