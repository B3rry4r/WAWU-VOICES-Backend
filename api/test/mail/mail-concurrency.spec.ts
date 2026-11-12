import { createServer, type Server } from "node:http";
import { bootAdmin, type Admin } from "../admin/helpers";

/**
 * M-b fix round 1 (F2): the windowed limits (B03 half an hour, B01 an hour) count rows then insert. Many sends at the same
 * moment for one voice, each with its own event, must still give exactly one mail. The relay is a local stand-in on a
 * port from the 15180 range; nothing real is sent.
 */
const PORT = 15181;
const KEY = "mail-conc-service-key";

describe("M-b fix 1: the send limit holds under real concurrency", () => {
  let a: Admin;
  let srv: Server;
  let tags: string[] = [];

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        tags.push((JSON.parse(raw) as { tag: string }).tag);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stand-in" }));
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    a = await bootAdmin();
    await a.person("author");
    await a.prisma.user.update({
      where: { id: a.people.author.id },
      data: { mailTo: "author@mail.test" },
    });
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(`TRUNCATE "MailLog" CASCADE`);
    await a.close();
    await new Promise<void>((r) => srv.close(() => r()));
    delete process.env.WAWU_ID_BASE_URL;
    delete process.env.INTERNAL_SERVICE_KEY;
  });

  const fire = async (scope: string, n: number) => {
    const { MailService } = await import("../../src/mail/mail.service.js");
    const mail = a.h.app.get(MailService);
    const vars = {
      replier_name: "@kemi",
      reply_type: "Text reply",
      reply_excerpt: "hello",
      reply_count: 1,
      post_url: "https://usevoices.com/x",
    };
    return Promise.all(
      Array.from({ length: n }, (_, i) =>
        mail.send({
          template: "B03" as const,
          userId: a.people.author.id,
          eventKey: `reply:conc-${scope}-${i}`,
          scopeKey: `answer:${scope}`,
          vars,
        }),
      ),
    );
  };

  it("20 sends at once for one voice, different events: exactly 1 sent, 19 limited", async () => {
    tags = [];
    const out = await fire("voice-1", 20);
    expect(out.filter((o) => o === "sent")).toHaveLength(1);
    expect(out.filter((o) => o === "limited")).toHaveLength(19);
    expect(tags).toHaveLength(1);
    expect(
      await a.prisma.mailLog.count({
        where: { userId: a.people.author.id, scopeKey: "answer:voice-1" },
      }),
    ).toBe(1);
  });

  it("another voice is its own scope: it still gets its one mail", async () => {
    tags = [];
    const out = await fire("voice-2", 20);
    expect(out.filter((o) => o === "sent")).toHaveLength(1);
    expect(tags).toHaveLength(1);
  });

  it("F8: tokens print with a thousands separator", async () => {
    const { count } = await import("../../src/mail/mail.service.js");
    expect(count(1250)).toBe("1,250");
    expect(count(100)).toBe("100");
    expect(count(2000.5)).toBe("2,000.5");
  });
});
