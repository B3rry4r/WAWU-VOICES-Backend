/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bootAdmin,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "../admin/helpers";

/**
 * M-b round 2 (V-44): the logo folder, account deletion and its undo (A10, A11, A12), and the nine events round 1 left
 * (B01, B09, B12, G01, G04, G05, G06, G09, H04). The relay and WAWU ID are one local stand-in on a port from the 15140
 * range; nothing real is sent.
 */
const PORT = 15141;
const KEY = "mail2-test-service-key";
const api = "/api/v1";

interface Got {
  path: string;
  key: string | undefined;
  body: Record<string, any>;
}

describe("M-b round 2: logos, deletion mails and the nine events", () => {
  let a: Admin;
  let srv: Server;
  let got: Got[] = [];
  let status = 200;
  let q: string;
  /** The address mail goes to is the token's email claim, kept on every signed-in request; read it back from the row. */
  const mails: Record<string, string> = {};
  const addr = (n: string) => mails[n];

  const settle = async () => {
    const { MailService } = await import("../../src/mail/mail.service.js");
    await a.h.app.get(MailService).settled();
    await new Promise((r) => setTimeout(r, 150));
    await a.h.app.get(MailService).settled();
  };
  const sent = async (tag: string) => {
    await settle();
    return got.filter((g) => g.body.tag === `voices_${tag}`);
  };
  const notices = async (kind: string) => {
    await settle();
    return got.filter(
      (g) => g.path === "/internal/mail/notice" && g.body.kind === kind,
    );
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        got.push({
          path: req.url ?? "",
          key: req.headers["x-service-key"] as string | undefined,
          body: JSON.parse(raw) as Record<string, any>,
        });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stand-in", sent: true }));
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    a = await bootAdmin();
    for (const n of [
      "admin",
      "admin2",
      "editor",
      "poster",
      "kemi",
      "quoted",
      "leaver",
      "newbie",
      "sup",
    ])
      await a.person(
        n,
        n.startsWith("admin") ? ["ADMIN"] : n === "editor" ? ["EDITOR"] : [],
      );
    for (const n of Object.keys(a.people)) {
      await a.h.http().get(`${api}/me`).set(a.auth(n)).expect(200);
      mails[n] = (
        await a.prisma.user.findUniqueOrThrow({ where: { id: a.people[n].id } })
      ).mailTo as string;
      expect(mails[n]).toBeTruthy();
    }
    q = (await seedQuestion(a, "What should change?")).id;
    await a.prisma.question.update({
      where: { id: q },
      data: {
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Override", "WeeklyQuote", "WeeklyReport", "ProposalGroup", "SupportMessage", "Notification", "MailLog" CASCADE`,
    );
    await a.close();
    await new Promise<void>((r) => srv.close(() => r()));
    delete process.env.WAWU_ID_BASE_URL;
    delete process.env.INTERNAL_SERVICE_KEY;
  });
  beforeEach(() => {
    got = [];
    status = 200;
  });

  describe("logos", () => {
    it("every template points at the one logo folder, none at the old path", () => {
      const dir = join(__dirname, "../../src/mail/templates/html");
      const files = readdirSync(dir);
      const withLogo = files.filter((f) =>
        readFileSync(join(dir, f), "utf8").includes("{{asset_base}}"),
      );
      expect(withLogo.length).toBeGreaterThanOrEqual(26);
      for (const f of files) {
        const h = readFileSync(join(dir, f), "utf8");
        expect(h).not.toContain("voices-wordmark-white.png");
        if (h.includes("{{asset_base}}"))
          expect(h).toContain("{{asset_base}}/logo-wordmark-white.png");
      }
    });
    it("the folder is <relay>/assets/voices by default and VOICES_MAIL_ASSET_URL overrides it", async () => {
      const { MailService } = await import("../../src/mail/mail.service.js");
      const svc = a.h.app.get(MailService);
      expect(svc.assetBase()).toBe(`http://127.0.0.1:${PORT}/assets/voices`);
      process.env.VOICES_MAIL_ASSET_URL = "https://img.example/voices/";
      expect(svc.assetBase()).toBe("https://img.example/voices");
      delete process.env.VOICES_MAIL_ASSET_URL;
    });
  });

  describe("A10, A11, A12: deleting an account and undoing it", () => {
    const del = (who: string, handle: string) =>
      a.h
        .http()
        .delete(`${api}/me`)
        .set(a.auth(who))
        .send({ confirmHandle: handle, understandUnitsForfeited: true });
    it("A10 goes through WAWU ID's notice route with app voices, once, and a second request while pending sends nothing", async () => {
      await del("leaver", a.people.leaver.handle).expect(202);
      const n = await notices("account_deletion_started");
      expect(n).toHaveLength(1);
      expect(n[0].key).toBe(KEY);
      expect(n[0].body.app).toBe("voices");
      expect(n[0].body.wawuId).toBe(a.people.leaver.sub);
      expect(n[0].body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
      const row = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.leaver.id },
      });
      const on = new Date(n[0].body.data.deleteOn).getTime();
      expect(on).toBe(row.deletionRequestedAt!.getTime() + 14 * 86_400_000);
      got = [];
      await del("leaver", a.people.leaver.handle).expect(202);
      expect(await notices("account_deletion_started")).toHaveLength(0);
    });
    it("a signed-in request while pending does not cancel and sends no welcome back", async () => {
      got = [];
      await a.h.http().get(`${api}/me`).set(a.auth("leaver")).expect(200);
      expect(await sent("A12")).toHaveLength(0);
      const row = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.leaver.id },
      });
      expect(row.status).toBe("DELETION_PENDING");
    });
    it("A12: only Undo cancels; it sends one welcome back through the relay with the real counts and no followers", async () => {
      const mine = await seedAnswer(a, q, a.people.leaver.id, {
        body: "my voice",
      });
      await a.prisma.reply.create({
        data: {
          answerId: mine.id,
          authorId: a.people.kemi.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "a reply while you were away",
        },
      });
      got = [];
      await a.h
        .http()
        .post(`${api}/me/deletion/cancel`)
        .set(a.auth("leaver"))
        .expect(200);
      const m = await sent("A12");
      expect(m).toHaveLength(1);
      expect(m[0].path).toBe("/internal/mail/send");
      expect(m[0].body.to).toBe(addr("leaver"));
      expect(m[0].body.subject).toMatch(/^Welcome back to Voices, /);
      expect(m[0].body.html).toContain("new replies");
      expect(m[0].body.html).not.toContain("followers");
      expect(m[0].body.text).not.toContain("followers");
      expect(m[0].body.html).toContain("What should change?");
      expect(m[0].body.text).toMatch(/1 new replies \| \d+ open polls/);
      for (const s of [m[0].body.html, m[0].body.text, m[0].body.subject])
        expect(s).not.toMatch(/\{\{|\}\}/);
      got = [];
      await a.h
        .http()
        .post(`${api}/me/deletion/cancel`)
        .set(a.auth("leaver"))
        .expect(200);
      expect(await sent("A12")).toHaveLength(0); // already active: nothing to undo, nothing sent
    });
    it("A11 goes out once when the purge runs, with the WAWU ID the account had", async () => {
      await del("newbie", a.people.newbie.handle).expect(202);
      got = [];
      const { DeletionService } =
        await import("../../src/me/deletion.service.js");
      const d = a.h.app.get(DeletionService);
      await a.prisma.user.update({
        where: { id: a.people.newbie.id },
        data: {
          deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000),
        },
      });
      await d.purge(a.people.newbie.id);
      const n = await notices("account_deleted");
      expect(n).toHaveLength(1);
      expect(n[0].body.app).toBe("voices");
      expect(n[0].body.wawuId).toBe(a.people.newbie.sub);
      got = [];
      await d.purge(a.people.newbie.id); // a second run is a no-op
      expect(await notices("account_deleted")).toHaveLength(0);
    });
    it("a WAWU ID that is down never breaks the deletion, and the slot is given back", async () => {
      status = 503;
      await del("sup", a.people.sup.handle).expect(202);
      const n = await notices("account_deletion_started");
      expect(n.length).toBe(3);
      const row = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.sup.id },
      });
      expect(row.status).toBe("DELETION_PENDING");
      expect(
        await a.prisma.mailLog.count({
          where: { userId: a.people.sup.id, template: "A10" },
        }),
      ).toBe(0);
      status = 200;
      await a.prisma.user.update({
        where: { id: a.people.sup.id },
        data: { status: "ACTIVE", deletionRequestedAt: null },
      });
    });
  });

  describe("B01: your voice is live", () => {
    const post = (who: string, key: string, body = "Prices must come down") =>
      a.h
        .http()
        .post(`${api}/questions/${q}/answers`)
        .set(a.auth(who))
        .set("Idempotency-Key", key)
        .send({ kind: "TEXT", body });
    it("mails the author once, with the question and a link to the post; a second voice within the hour sends none", async () => {
      await post("poster", "b01-1").expect(201);
      const m = await sent("B01");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("poster"));
      expect(m[0].body.subject).toBe("Your voice is live");
      expect(m[0].body.html).toContain("What should change?");
      expect(m[0].body.html).toContain("Written answer");
      expect(m[0].body.html).toMatch(/usevoices\.com\/q\/[^/]+\/a\/[^"]+/);
      expect(m[0].body.html).not.toContain("Share it</a>");
      for (const s of [m[0].body.html, m[0].body.text])
        expect(s).not.toMatch(/\{\{|\}\}/);
      got = [];
      await post("poster", "b01-2", "A second thought").expect(201);
      expect(await sent("B01")).toHaveLength(0);
    });
    it("the Replies switch turns it off and the post still goes through", async () => {
      await a.prisma.mailLog.deleteMany({ where: { template: "B01" } });
      await a.prisma.userSettings.update({
        where: { userId: a.people.kemi.id },
        data: { notifyReplies: false },
      });
      await post("kemi", "b01-3", "Quiet one").expect(201);
      expect(await sent("B01")).toHaveLength(0);
      await a.prisma.userSettings.update({
        where: { userId: a.people.kemi.id },
        data: { notifyReplies: true },
      });
    });
  });

  describe("B09: your voice was featured", () => {
    it("each quoted person gets one mail when the report goes public, with the quote and no name", async () => {
      const topic = await a.prisma.topic.create({
        data: {
          weekNumber: 91,
          title: "Are You Really Fine?",
          startsOn: new Date(Date.UTC(2026, 10, 9)),
          endsOn: new Date(Date.UTC(2026, 10, 15)),
          status: "LIVE",
        },
      });
      const ans = await seedAnswer(a, q, a.people.quoted.id, {
        body: "Rent is too high",
      });
      const rep = await a.prisma.weeklyReport.create({
        data: {
          topicId: topic.id,
          status: "APPROVED",
          headline: "What Nigerians said",
          summary: "A summary.",
          publishAt: new Date(Date.now() - 1000),
          approvedAt: new Date(),
          humanReviewed: true,
          quotes: {
            create: [
              {
                answerId: ans.id,
                excerpt: "Rent is too high",
                placeLabel: "A voice from Lagos",
                consentAt: new Date(),
              },
            ],
          },
        },
      });
      const { WeeklyService } =
        await import("../../src/reach/weekly.service.js");
      expect(await a.h.app.get(WeeklyService).publishDue()).toBe(1);
      const m = await sent("B09");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("quoted"));
      expect(m[0].body.html).toContain("Rent is too high");
      expect(m[0].body.html).toContain("Are You Really Fine?");
      expect(m[0].body.html).toContain(`/weekly/${rep.id}`);
      expect(m[0].body.html).not.toContain("Change my permission");
      expect(m[0].body.html).not.toContain(a.people.quoted.handle);
      got = [];
      await a.h.app.get(WeeklyService).publishDue(); // nothing left to publish
      expect(await sent("B09")).toHaveLength(0);
    });
  });

  describe("B12: your proposal was grouped", () => {
    it("the authors, not the moderator, hear once per group", async () => {
      const mk = (who: string, body: string, support: number) =>
        a.prisma.proposal.create({
          data: {
            questionId: q,
            authorId: a.people[who].id,
            body,
            supportCount: support,
          },
        });
      const p1 = await mk("poster", "Write it down", 5);
      const p2 = await mk("kemi", "Put it in writing", 7);
      const p3 = await mk("admin", "Promises in writing", 1);
      await a.h
        .http()
        .post(`${api}/admin/proposal-groups`)
        .set(a.auth("admin"))
        .send({
          title: "Written promises",
          proposalIds: [p1.id, p2.id, p3.id],
        })
        .expect(201);
      const m = await sent("B12");
      expect(m.map((x) => x.body.to as string).sort()).toEqual(
        [addr("kemi"), addr("poster")].sort(),
      );
      expect(m[0].body.html).toContain("Written promises");
      expect(m[0].body.html).toContain(">3<"); // proposals in the group
      expect(m[0].body.html).toContain(">13<"); // total support
      expect(m[0].body.html).toContain("proposals in the group");
      expect(m[0].body.html).not.toMatch(/\bideas?\b/);
      for (const s of [m[0].body.html, m[0].body.text, m[0].body.subject])
        expect(s).not.toMatch(/\{\{|\}\}/);
    });
  });

  describe("G01: the weekly draft is ready", () => {
    it("editors and admins hear once, only when the AI text is really there", async () => {
      const topic = await a.prisma.topic.create({
        data: {
          weekNumber: 92,
          title: "Money talk",
          startsOn: new Date(Date.UTC(2026, 10, 16)),
          endsOn: new Date(Date.UTC(2026, 10, 22)),
          status: "LIVE",
        },
      });
      const poll = await a.prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "What next?",
          status: "CLOSED",
          startsAt: new Date(Date.now() - 3 * 86_400_000),
          endsAt: new Date(Date.now() - 86_400_000),
        },
      });
      const { WeeklyDraftService } =
        await import("../../src/reach/weekly-draft.js");
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      const mails = a.h.app.get(MailEvents);
      // no drafter: an empty shell, nobody is told "the AI draft is ready"
      const shell = new WeeklyDraftService(a.prisma, null, mails);
      expect(await shell.draftTopic(poll.id)).toBe(true);
      expect(await sent("G01")).toHaveLength(0);
      await a.prisma.weeklyReport.deleteMany({ where: { topicId: topic.id } });
      const tq = await a.prisma.question.create({
        data: {
          text: "Money?",
          status: "LIVE",
          kind: "DAILY",
          topicId: topic.id,
        },
      });
      await seedAnswer(a, tq.id, a.people.poster.id, { body: "Prices" });
      const drafter = {
        draft: () =>
          Promise.resolve({
            headline: "A headline",
            mood: "Tired",
            summary: "A summary",
            themes: [],
          }),
      };
      const svc = new WeeklyDraftService(a.prisma, drafter, mails);
      expect(await svc.draftTopic(poll.id)).toBe(true);
      const m = await sent("G01");
      expect(m.map((x) => x.body.to as string).sort()).toEqual(
        [addr("admin"), addr("admin2"), addr("editor")].sort(),
      );
      expect(m[0].body.subject).toBe("Draft ready for review: Money talk");
      expect(m[0].body.html).toContain("/admin/weekly");
      got = [];
      expect(await svc.draftTopic(poll.id)).toBe(false); // already drafted
      expect(await sent("G01")).toHaveLength(0);
    });
  });

  describe("G04, G05, G06: overrides", () => {
    const make = (over: Record<string, unknown>) =>
      a.h
        .http()
        .post(`${api}/admin/overrides`)
        .set(a.auth("editor"))
        .send({
          headline: "Lagos floods: are you safe?",
          contentKind: "TEXT",
          body: "Tell us where you are.",
          emergency: false,
          ...over,
        });
    it("G04: set for later, every admin hears once (the editor who set it is not an admin)", async () => {
      const startsAt = new Date(Date.now() + 3 * 86_400_000);
      const r = await make({
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 24 * 3_600_000).toISOString(),
        notifyAlert: true,
      });
      expect(r.status).toBe(201);
      const m = await sent("G04");
      expect(m.map((x) => x.body.to as string).sort()).toEqual(
        [addr("admin"), addr("admin2")].sort(),
      );
      expect(m[0].body.html).toContain("24 hours");
      expect(m[0].body.html).toContain("In-app alert");
      expect(m[0].body.html).not.toContain("Push notification");
      expect(await sent("G05")).toHaveLength(0);
      for (const s of [m[0].body.html, m[0].body.text, m[0].body.subject])
        expect(s).not.toMatch(/\{\{|\}\}/);
      await a.prisma.override.updateMany({ data: { status: "CANCELLED" } });
    });
    it("G05 when it starts on time and G06 when it ends: once each, to every admin", async () => {
      await a.prisma.override.deleteMany({});
      const startsAt = new Date(Date.now() + 3_600_000);
      const r = await make({
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      });
      expect(r.status).toBe(201);
      got = [];
      const { OverridesAdminService } =
        await import("../../src/admin/overrides.service.js");
      const svc = a.h.app.get(OverridesAdminService);
      await svc.tick(new Date(startsAt.getTime() + 60_000));
      const live = await sent("G05");
      expect(live.map((x) => x.body.to as string).sort()).toEqual(
        [addr("admin"), addr("admin2")].sort(),
      );
      expect(live[0].body.html).toContain("Lagos floods: are you safe?");
      await svc.tick(new Date(startsAt.getTime() + 90_000)); // a second tick: nothing new
      expect(await sent("G05")).toHaveLength(2);
      got = [];
      await svc.tick(new Date(startsAt.getTime() + 2 * 3_600_000));
      const ended = await sent("G06");
      expect(ended).toHaveLength(2);
      for (const s of [
        ended[0].body.html,
        ended[0].body.text,
        ended[0].body.subject,
      ])
        expect(s).not.toMatch(/\{\{|\}\}/);
    });
    it("G05 when an override is made to show at once", async () => {
      await a.prisma.override.deleteMany({});
      got = [];
      const r = await make({
        emergency: true,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      });
      expect(r.status).toBe(201);
      expect(await sent("G05")).toHaveLength(2);
      expect(await sent("G04")).toHaveLength(0);
    });
  });

  describe("G09: role changed", () => {
    it("the person hears once per real change, naming the role, and the same roles again send nothing", async () => {
      const put = (roles: string[]) =>
        a.h
          .http()
          .put(`${api}/admin/users/${a.people.sup.id}/roles`)
          .set(a.auth("admin"))
          .send({ roles, reason: "team" });
      await put(["MODERATOR"]).expect(200);
      const m = await sent("G09");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("sup"));
      expect(m[0].body.html).toContain("Moderator");
      got = [];
      await put(["MODERATOR"]).expect(200);
      expect(await sent("G09")).toHaveLength(0);
      await put([]).expect(200);
      const gone = await sent("G09");
      expect(gone).toHaveLength(1);
      expect(gone[0].body.html).toContain("No admin role");
    });
  });

  describe("H04: we got your message", () => {
    it("a signed-in person gets a receipt with a reference; a guest gets none", async () => {
      const r = await a.h
        .http()
        .post(`${api}/support/messages`)
        .set(a.auth("kemi"))
        .send({ topic: "PAYMENT", message: "My payment did not go through" })
        .expect(201);
      const m = await sent("H04");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("kemi"));
      expect(m[0].body.subject).toMatch(
        /^We got your message \[SP-[0-9A-F]{8}\]$/,
      );
      expect(m[0].body.subject).toContain(
        String(r.body.id).replace(/-/g, "").slice(-8).toUpperCase(),
      );
      expect(m[0].body.html).toContain("Payment");
      expect(m[0].body.html).not.toMatch(/usually within/);
      expect(m[0].body.text).not.toMatch(/reply to this email/i);
      got = [];
      await a.h
        .http()
        .post(`${api}/support/messages`)
        .set("X-Guest-Id", "0190a000-0000-7000-8000-00000000a001")
        .send({
          topic: "OTHER",
          message: "Hello",
          contactEmail: "guest@mail2.test",
        })
        .expect(201);
      expect(await sent("H04")).toHaveLength(0);
    });
  });
});
