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
 * M-b (V-44): VOICES notification mail. The relay is a local stand-in on a port from the 15080 range; nothing real is
 * sent. Each wired event sends one mail, once, to the right person, respecting the person's switch and the send limit.
 */
const PORT = 15081;
const KEY = "mail-test-service-key";
const api = "/api/v1";

interface Got {
  key: string | undefined;
  idem: string | undefined;
  body: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag: string;
    app?: string;
  };
}

describe("M-b: VOICES notification mail through the relay", () => {
  let a: Admin;
  let srv: Server;
  let got: Got[] = [];
  let relayStatus = 200;
  let q: string;
  const addr = (n: string) => `${n}@mail.test`;

  const sent = async (tag?: string) => {
    // let every raised mail finish
    const { MailService } = await import("../../src/mail/mail.service.js");
    await a.h.app.get(MailService).settled();
    await new Promise((r) => setTimeout(r, 150));
    await a.h.app.get(MailService).settled();
    return tag ? got.filter((g) => g.body.tag === `voices_${tag}`) : got;
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        got.push({
          key: req.headers["x-service-key"] as string | undefined,
          idem: req.headers["idempotency-key"] as string | undefined,
          body: JSON.parse(raw) as Got["body"],
        });
        res.writeHead(relayStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stand-in" }));
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    a = await bootAdmin();
    for (const n of ["admin", "mod", "mod2", "poster", "kemi", "rep"])
      await a.person(
        n,
        n === "admin" ? ["ADMIN"] : n.startsWith("mod") ? ["MODERATOR"] : [],
      );
    for (const n of ["poster", "kemi", "rep", "mod"])
      await a.prisma.user.update({
        where: { id: a.people[n].id },
        data: { mailTo: addr(n) },
      });
    // V-46: a person starts with 2 free posts; these tests post many replies, so everyone gets plenty.
    await a.prisma.freeAllowance.updateMany({
      data: { freePostsRemaining: 100 },
    });
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
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification", "Payment", "MailLog" CASCADE`,
    );
    await a.close();
    await new Promise<void>((r) => srv.close(() => r()));
    delete process.env.WAWU_ID_BASE_URL;
    delete process.env.INTERNAL_SERVICE_KEY;
  });
  beforeEach(() => {
    got = [];
    relayStatus = 200;
  });

  it("the sign-in token's email is kept as the address mail goes to", async () => {
    await a.prisma.user.update({
      where: { id: a.people.admin.id },
      data: { mailTo: null },
    });
    await a.h
      .http()
      .post(`${api}/_write_probe`)
      .set(a.auth("admin"))
      .expect(201);
    const u = await a.prisma.user.findUniqueOrThrow({
      where: { id: a.people.admin.id },
    });
    expect(u.mailTo).toBe(`${a.people.admin.sub}@example.com`);
  });

  describe("B03: a reply", () => {
    const reply = (key: string, body = "I agree with this") =>
      a.h
        .http()
        .post(`${api}/answers/${ans}/replies`)
        .set(a.auth("kemi"))
        .set("Idempotency-Key", key)
        .send({ stance: "AGREE", kind: "TEXT", body });
    let ans = "";
    it("mails the author once, with the service key, an idempotency key and the filled words", async () => {
      ans = (await seedAnswer(a, q, a.people.poster.id, { body: "mine" })).id;
      await reply("m1").expect(201);
      const m = await sent("B03");
      expect(m).toHaveLength(1);
      expect(m[0].key).toBe(KEY);
      expect(m[0].idem).toMatch(/^vm-[0-9a-f]{40}$/);
      expect(m[0].body.to).toBe(addr("poster"));
      expect(m[0].body.app).toBe("voices");
      expect(m[0].body.subject).toBe("@a7b.kemi replied to your voice");
      expect(m[0].body.html).toContain("I agree with this");
      expect(m[0].body.text).toContain("Replies on this voice so far: 1.");
      for (const s of [m[0].body.html, m[0].body.text, m[0].body.subject])
        expect(s).not.toMatch(/\{\{|\}\}/);
      expect(m[0].body.html).toContain(
        `http://127.0.0.1:${PORT}/assets/voices/logo-wordmark-white.png`,
      );
      expect(m[0].body.html).not.toContain("/assets/voices-wordmark-white.png");
      expect(m[0].body.html).not.toMatch(/usevoices\.com\/email-assets/);
    });
    it("a second reply to the same voice inside 30 minutes sends no second mail (the template's limit)", async () => {
      await reply("m2", "another one").expect(201);
      expect(await sent("B03")).toHaveLength(0);
    });
    it("a person who switched replies off gets no mail, and the reply still posts", async () => {
      const other = (
        await seedAnswer(a, q, a.people.poster.id, { body: "second" })
      ).id;
      await a.prisma.userSettings.update({
        where: { userId: a.people.poster.id },
        data: { notifyReplies: false },
      });
      await a.h
        .http()
        .post(`${api}/answers/${other}/replies`)
        .set(a.auth("kemi"))
        .set("Idempotency-Key", "m3")
        .send({ stance: "AGREE", kind: "TEXT", body: "quiet" })
        .expect(201);
      expect(await sent("B03")).toHaveLength(0);
      await a.prisma.userSettings.update({
        where: { userId: a.people.poster.id },
        data: { notifyReplies: true },
      });
    });
    it("a relay that is down never breaks the reply; the slot is given back so the event can be tried again", async () => {
      const other = (
        await seedAnswer(a, q, a.people.poster.id, { body: "third" })
      ).id;
      relayStatus = 503;
      await a.h
        .http()
        .post(`${api}/answers/${other}/replies`)
        .set(a.auth("kemi"))
        .set("Idempotency-Key", "m4")
        .send({ stance: "AGREE", kind: "TEXT", body: "down" })
        .expect(201);
      const tries = await sent("B03");
      expect(tries.length).toBe(3); // three asks, then given up
      expect(
        await a.prisma.mailLog.count({
          where: {
            template: "B03",
            eventKey: { contains: "" },
            scopeKey: `answer:${other}`,
          },
        }),
      ).toBe(0);
    });
  });

  describe("E: reports, decisions, appeals", () => {
    let post = "";
    let item = "";
    const act = (
      who: string,
      id: string,
      action: string,
      reason = "It threatens a person.",
    ) =>
      a.h
        .http()
        .post(`${api}/admin/moderation/items/${id}/action`)
        .set(a.auth(who))
        .send({ action, reason });
    it("E09 thanks the reporter, once, with a reference", async () => {
      post = (
        await seedAnswer(a, q, a.people.poster.id, { body: "a bad post" })
      ).id;
      await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("rep"))
        .send({
          targetType: "ANSWER",
          targetId: post,
          reason: "THREAT_OR_VIOLENCE",
        })
        .expect(201);
      const m = await sent("E09");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("rep"));
      expect(m[0].body.text).toMatch(/Reference: RP-[0-9A-F]{8}/);
      expect(m[0].body.text).toContain("Reason: Threat or violence");
      item = (
        await a.prisma.moderationItem.findFirstOrThrow({
          where: { targetId: post },
        })
      ).id;
    });
    it("a news flag gets no thank-you (it has no outcome to promise)", async () => {
      const news = await seedAnswer(a, q, a.people.poster.id, {
        isNews: true,
        newsTag: "GOSSIP",
        body: "claimed",
      });
      await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("rep"))
        .send({
          targetType: "ANSWER",
          targetId: news.id,
          reason: "MISLEADING_NEWS_TAG",
        })
        .expect(201);
      expect(await sent("E09")).toHaveLength(0);
    });
    it("a removal mails the poster E01 (reason, excerpt, appeal link) and the reporter E10", async () => {
      await act("mod", item, "REMOVE_AND_WARN").expect(200);
      const e1 = await sent("E01");
      expect(e1).toHaveLength(1);
      expect(e1[0].body.to).toBe(addr("poster"));
      expect(e1[0].body.text).toContain("It threatens a person.");
      expect(e1[0].body.text).toContain("a bad post");
      expect(e1[0].body.text).toContain("/notifications");
      const e10 = await sent("E10");
      expect(e10).toHaveLength(1);
      expect(e10[0].body.to).toBe(addr("rep"));
      expect(e10[0].body.text).toContain("We took action on it.");
    });
    it("E06 on an appeal, then E07 when the appeal is accepted and the strike goes; no E01 twice", async () => {
      await a.h
        .http()
        .post(`${api}/appeals`)
        .set(a.auth("poster"))
        .send({ targetType: "ANSWER", targetId: post, note: "I was joking" })
        .expect(201);
      const e6 = await sent("E06");
      expect(e6).toHaveLength(1);
      expect(e6[0].body.text).toMatch(/Reference: AP-[0-9A-F]{8}/);
      expect(e6[0].body.text).not.toContain("Expected reply");
      got = [];
      const appealItem = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: post, queue: "APPEAL" },
      });
      await act(
        "mod2",
        appealItem.id,
        "RESTORE",
        "On a second look it is fine.",
      ).expect(200);
      const m = await sent();
      expect(m.map((x) => x.body.tag)).toEqual(["voices_E07"]);
      expect(m[0].body.to).toBe(addr("poster"));
      expect(m[0].body.app).toBe("voices");
      expect(m[0].body.text).toContain(
        "The strike linked to it has been removed.",
      );
    });
    it("a declined appeal is E08 with the moderator's reason", async () => {
      const p2 = (
        await seedAnswer(a, q, a.people.poster.id, { body: "second bad post" })
      ).id;
      await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("rep"))
        .send({ targetType: "ANSWER", targetId: p2, reason: "SCAM_OR_SPAM" })
        .expect(201);
      const it2 = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: p2, queue: "REPORTED" },
      });
      await act("mod", it2.id, "REMOVE", "Spam.").expect(200);
      await a.h
        .http()
        .post(`${api}/appeals`)
        .set(a.auth("poster"))
        .send({ targetType: "ANSWER", targetId: p2, note: "no" })
        .expect(201);
      await sent();
      got = [];
      const ai = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: p2, queue: "APPEAL" },
      });
      await act("mod2", ai.id, "KEEP", "It is spam.").expect(200);
      const m = await sent();
      expect(m.map((x) => x.body.tag)).toEqual(["voices_E08"]);
      expect(m[0].body.text).toContain("It is spam.");
    });
    it("a warning is E02 with the count; a suspension is E04 in VOICES words, with the day it ends", async () => {
      const p3 = (await seedAnswer(a, q, a.people.poster.id, { body: "rude" }))
        .id;
      await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("rep"))
        .send({
          targetType: "ANSWER",
          targetId: p3,
          reason: "HATE_OR_HARASSMENT",
        })
        .expect(201);
      const i3 = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: p3, queue: "REPORTED" },
      });
      got = [];
      await act("mod", i3.id, "WARN", "Be kind.").expect(200);
      const w = await sent("E02");
      expect(w).toHaveLength(1);
      expect(w[0].body.text).toMatch(/Warnings on your account: \d+\n/);
      expect(w[0].body.text).not.toContain(" of 3");
      got = [];
      const p4 = (await seedAnswer(a, q, a.people.poster.id, { body: "worse" }))
        .id;
      await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("rep"))
        .send({
          targetType: "ANSWER",
          targetId: p4,
          reason: "THREAT_OR_VIOLENCE",
        })
        .expect(201);
      const i4 = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: p4, queue: "REPORTED" },
      });
      got = [];
      await act("mod", i4.id, "SUSPEND", "Repeated threats.").expect(200);
      const s = await sent("E04");
      expect(s).toHaveLength(1);
      expect(s[0].body.subject).toBe("Your Voices account is suspended");
      expect(s[0].body.text).toContain("What you can do: Listen and read");
      expect(s[0].body.text).not.toMatch(/Ends: No end date/);
    });
  });

  describe("E11, E04 and E05 from the editor and the people screen, B11 directly", () => {
    it("E11: an editor changes a tag; the poster gets the old and new tag, no appeal link", async () => {
      await a.person("editor", ["EDITOR"]);
      const news = await seedAnswer(a, q, a.people.poster.id, {
        isNews: true,
        newsTag: "GOSSIP",
        body: "claimed news",
      });
      await a.h
        .http()
        .post(`${api}/admin/news/${news.id}/decision`)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "UNVERIFIED_NEWS",
          reason: "It is reported but not confirmed.",
        })
        .expect(200);
      const m = await sent("E11");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("poster"));
      expect(m[0].body.app).toBe("voices");
      expect(m[0].body.text).toContain("Old tag: Gossip");
      expect(m[0].body.text).toContain("New tag: Unverified News");
      expect(m[0].body.text).not.toContain("Ask an editor");
    });
    it("E04 then E05 from the people screen", async () => {
      await a.h
        .http()
        .post(`${api}/admin/users/${a.people.kemi.id}/suspend`)
        .set(a.auth("admin"))
        .send({ reason: "Repeated spam.", ban: false, until: null })
        .expect(200);
      const s = await sent("E04");
      expect(s).toHaveLength(1);
      expect(s[0].body.to).toBe(addr("kemi"));
      expect(s[0].body.html).toContain("Your account is suspended.");
      got = [];
      await a.h
        .http()
        .post(`${api}/admin/users/${a.people.kemi.id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "Time served." })
        .expect(200);
      const r = await sent("E05");
      expect(r).toHaveLength(1);
      expect(r[0].body.subject).toBe("Your Voices account is back to normal");
    });
    it("B11: the improved proposal's author is mailed with both texts and the question link", async () => {
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      await a.h.app
        .get(MailEvents)
        .proposalImproved(
          a.people.poster.id,
          "Fix the roads now",
          "kemi",
          "Fix the roads and the drains",
          q,
          "imp-1",
        );
      const m = await sent("B11");
      expect(m).toHaveLength(1);
      expect(m[0].body.subject).toBe("@kemi improved your proposal");
      expect(m[0].body.text).toContain("Fix the roads and the drains");
      expect(m[0].body.text).toContain(`/q/${q}`);
    });
  });

  describe("D: payments", () => {
    let n = 0;
    const mk = (kind: "UNITS" | "EXTRA_VOICE" = "UNITS") => {
      n++;
      return a.prisma.payment.create({
        data: {
          userId: a.people.poster.id,
          kind,
          ...(kind === "EXTRA_VOICE"
            ? { tokenKind: "SECONDS_30" as const }
            : {}),
          amountKobo: 69000,
          unitsMilli: kind === "UNITS" ? 55000 : null,
          bonusMilli: kind === "UNITS" ? 5000 : null,
          txRef: `VU-261112-0000${n}`,
          idempotencyKey: `mailpay${n}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    };
    const reverify = (id: string, key: string) =>
      a.h
        .http()
        .post(`${api}/admin/payments/${id}/reverify`)
        .set(a.auth("admin"))
        .set("Idempotency-Key", key);
    it("D02: a tokens pack that succeeds mails one receipt in tokens, and a second verify sends nothing more", async () => {
      const p = await mk();
      a.flw.pay(p.txRef, 690);
      await reverify(p.id, "mp-1").expect(200);
      await reverify(p.id, "mp-1b").expect(200);
      const m = await sent("D02");
      expect(m).toHaveLength(1);
      expect(m[0].body.to).toBe(addr("poster"));
      expect(m[0].body.app).toBe("voices");
      expect(m[0].body.subject).toMatch(/^Receipt for your VOICES Tokens /);
      expect(m[0].body.text).toContain("Amount: ₦690");
      expect(m[0].body.text).toContain("Tokens added: 55");
      expect(m[0].body.text).not.toMatch(/credit/i);
      expect(m[0].body.text).toContain(`/units/receipt/${p.id}`);
    });
    it("D01: an extra voice purchase mails the extra-recording-time receipt", async () => {
      const p = await mk("EXTRA_VOICE");
      a.flw.pay(p.txRef, 690);
      await reverify(p.id, "mp-2").expect(200);
      const m = await sent("D01");
      expect(m).toHaveLength(1);
      expect(m[0].body.text).toContain("Item: Extra voice, 30 seconds");
      expect(m[0].body.text).toContain("Prices are in naira.");
    });
    it("D03 on a failed payment and D04 while it waits, each once", async () => {
      const f = await mk();
      a.flw.record(f.txRef, "flw-verify-successful.json", {
        status: "failed",
        amount: 690,
        charged_amount: 690,
      });
      await reverify(f.id, "mp-3").expect(200);
      await reverify(f.id, "mp-3b").expect(200);
      const d3 = await sent("D03");
      expect(d3).toHaveLength(1);
      expect(d3[0].body.text).toContain("Item: ");
      expect(d3[0].body.text).toContain("/units/buy");
      got = [];
      const w = await mk();
      a.flw.record(w.txRef, "flw-verify-successful.json", {
        status: "pending",
        amount: 690,
        charged_amount: 690,
      });
      await reverify(w.id, "mp-4").expect(200);
      const d4 = await sent("D04");
      expect(d4).toHaveLength(1);
      expect(d4[0].body.text).toMatch(/Reference: /);
    });
  });

  it("with no relay set, nothing is sent and nothing breaks", async () => {
    const base = process.env.WAWU_ID_BASE_URL;
    delete process.env.WAWU_ID_BASE_URL;
    try {
      const { MailService } = await import("../../src/mail/mail.service.js");
      const out = await a.h.app.get(MailService).send({
        template: "E05",
        userId: a.people.poster.id,
        eventKey: "x",
        vars: {},
      });
      expect(out).toBe("unconfigured");
      expect(got).toHaveLength(0);
    } finally {
      process.env.WAWU_ID_BASE_URL = base;
    }
  });

  it("every wired template renders with no leftover field, no em-dash, no usevoices.com sender or email-assets link", async () => {
    const { MAIL_TEMPLATES } = await import("../../src/mail/mail-templates.js");
    const dir = join(__dirname, "../../src/mail/templates");
    for (const id of Object.keys(MAIL_TEMPLATES)) {
      for (const kind of ["html", "text"] as const) {
        const f = readdirSync(join(dir, kind)).find((x) =>
          x.startsWith(`${id}-`),
        )!;
        const s = readFileSync(join(dir, kind, f), "utf8");
        expect(s).not.toContain("—");
        // An unsubscribe link is allowed only where the template has an unsubscribe kind (C01, C02): the link works there.
        const hasUnsub =
          "unsubscribe" in MAIL_TEMPLATES[id as keyof typeof MAIL_TEMPLATES];
        expect(s).not.toMatch(
          hasUnsub
            ? /support@usevoices|email-assets|REGISTERED ADDRESS|\bcredits?\b/i
            : /support@usevoices|email-assets|REGISTERED ADDRESS|unsubscribe_url|\bcredits?\b/i,
        );
      }
    }
  });
});
