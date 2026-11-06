/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import { bootAdmin, modItem, seedAnswer, type Admin } from "./helpers";

const lagosDay = () =>
  new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

/** lead ruling WF fix round 1: F1, F4, F5, F6, F7. */
describe("WF-1 fix round 1: recentVoices, replies, listen, quotes, appeals", () => {
  let a: Admin;
  let q: string;
  const api = "/api/v1";

  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("mod", ["MODERATOR"]);
    for (const n of [
      "ada",
      "ngozi",
      "tunde",
      "kemi",
      "femi",
      "poster",
      "stranger",
    ])
      await a.person(n);
    const row = await a.prisma.question.create({
      data: {
        text: "What should change?",
        kind: "DAILY",
        status: "LIVE",
        scheduledFor: new Date(`${lagosDay()}T00:00:00.000Z`),
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    q = row.id;
    const day = (n: number) =>
      new Date(
        `${lagosDay()}T00:00:00.000Z`.replace(/.*/, (x) => x),
      ).getTime() +
      n * 86_400_000;
    const topic = await a.prisma.topic.create({
      data: {
        weekNumber: 1,
        title: "Week one",
        startsOn: new Date(day(-1)),
        endsOn: new Date(day(5)),
        status: "LIVE",
        questionCount: 1,
      },
    });
    await a.prisma.question.update({
      where: { id: q },
      data: { topicId: topic.id, slotIndex: 2 },
    });
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification", "Block" CASCADE`,
    );
    await a.close();
  });

  const get = (path: string, who?: string) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const block = (blocker: string, blocked: string) =>
    a.prisma.block.create({
      data: {
        blockerId: a.people[blocker].id,
        blockedId: a.people[blocked].id,
      },
    });

  describe("F1: recentVoices never serves a blocked person", () => {
    const surfaces: [string, (who?: string) => Promise<unknown>][] = [
      [
        "question card",
        async (w) => (await get(`/questions/${q}`, w).expect(200)).body,
      ],
      ["Home", async (w) => (await get(`/home`, w).expect(200)).body],
      ["feed/new", async (w) => (await get(`/feed/new`, w).expect(200)).body],
      [
        "questions/today",
        async (w) => (await get(`/questions/today`, w).expect(200)).body,
      ],
    ];
    beforeAll(async () => {
      for (const n of ["tunde", "kemi", "femi", "ngozi"])
        await seedAnswer(a, q, a.people[n].id, { body: `${n} says` });
    });

    for (const direction of ["viewer blocked her", "she blocked the viewer"]) {
      it(`${direction}: none of the four surfaces names her, and the viewer still sees other people`, async () => {
        await a.prisma.block.deleteMany({});
        if (direction === "viewer blocked her") await block("ada", "ngozi");
        else await block("ngozi", "ada");
        for (const [name, fetch] of surfaces) {
          const body = JSON.stringify(await fetch("ada"));
          expect({ name, mentions: body.includes(q) }).toEqual({
            name,
            mentions: true,
          });
          expect({ name, id: body.includes(a.people.ngozi.id) }).toEqual({
            name,
            id: false,
          });
          expect({ name, handle: body.includes("a7b.ngozi") }).toEqual({
            name,
            handle: false,
          });
          expect({
            name,
            other: body.includes("a7b.tunde") || body.includes("a7b.kemi"),
          }).toEqual({ name, other: true });
        }
        // a guest and a stranger are not affected
        for (const who of [undefined, "stranger"])
          expect(JSON.stringify(await surfaces[0][1](who))).toContain(
            "a7b.ngozi",
          );
        await a.prisma.block.deleteMany({});
      });
    }

    it("still shows three faces when some are hidden", async () => {
      await a.prisma.block.deleteMany({});
      await block("ada", "ngozi");
      const card = (await get(`/questions/${q}`, "ada").expect(200)).body;
      expect(card.recentVoices).toHaveLength(3);
      await a.prisma.block.deleteMany({});
    });
  });

  describe("F4/F5: a block is not revealed", () => {
    it("replying to someone who blocked you is 404 'We could not find that', like the GET; listen on a hidden answer is 404", async () => {
      await a.prisma.block.deleteMany({});
      const ans = await seedAnswer(a, q, a.people.ada.id, { body: "ada root" });
      await block("ada", "tunde");
      const r = await a.h
        .http()
        .post(`${api}/answers/${ans.id}/replies`)
        .set(a.auth("tunde"))
        .set("Idempotency-Key", "wf2-r1")
        .send({ stance: "AGREE", kind: "TEXT", body: "x" })
        .expect(404);
      expect(r.body.error.message).toBe("We could not find that.");
      await get(`/answers/${ans.id}`, "tunde").expect(404);
      await a.h
        .http()
        .post(`${api}/answers/${ans.id}/listen`)
        .set(a.auth("tunde"))
        .send({ completed: true })
        .expect(404);
      await a.h
        .http()
        .post(`${api}/answers/${ans.id}/listen`)
        .set(a.auth("kemi"))
        .send({ completed: false })
        .expect(204);
      await a.h
        .http()
        .post(`${api}/answers/${ans.id}/listen`)
        .send({ completed: false })
        .expect(204);
      // the other direction too
      await a.prisma.block.deleteMany({});
      await block("kemi", "ada");
      await a.h
        .http()
        .post(`${api}/answers/${ans.id}/listen`)
        .set(a.auth("kemi"))
        .send({ completed: true })
        .expect(404);
      await a.prisma.block.deleteMany({});
    });
  });

  describe("F6: a reply is quoted only while it is up", () => {
    it("removed reply: the row stays with plain words and no quote", async () => {
      await a.prisma.block.deleteMany({});
      await a.prisma.notification.deleteMany({});
      const ans = await seedAnswer(a, q, a.people.ada.id, {
        body: "ada again",
      });
      await a.h
        .http()
        .post(`${api}/answers/${ans.id}/replies`)
        .set(a.auth("kemi"))
        .set("Idempotency-Key", "wf2-r2")
        .send({
          stance: "AGREE",
          kind: "TEXT",
          body: "something rude about the thing",
        })
        .expect(201);
      let rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(rows[0].body).toContain("something rude");
      await a.prisma.reply.updateMany({
        where: { answerId: ans.id },
        data: { status: "REMOVED" },
      });
      rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(rows).toHaveLength(1);
      expect(rows[0].body).not.toContain("rude");
      expect(rows[0].body).not.toContain("“");
      expect(rows[0].body.length).toBeGreaterThan(0);
    });
  });

  describe("F7: an appeal on a post that was already put back", () => {
    it("is 409 'This has already been put back.'; a post still down can be appealed", async () => {
      await a.prisma.configEntry.upsert({
        where: { key: "ratelimit.appeal_per_10min" },
        create: { key: "ratelimit.appeal_per_10min", valueJson: 1000 },
        update: { valueJson: 1000 },
      });
      const ans = await seedAnswer(a, q, a.people.poster.id, {
        status: "REMOVED",
      });
      const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
      await a.h
        .http()
        .post(`${api}/admin/moderation/items/${item.id}/action`)
        .set(a.auth("mod"))
        .send({ action: "RESTORE", reason: "Put back." })
        .expect(200);
      const r = await a.h
        .http()
        .post(`${api}/appeals`)
        .set(a.auth("poster"))
        .send({ targetType: "ANSWER", targetId: ans.id, note: "please" })
        .expect(409);
      expect(r.body.error.message).toBe("This has already been put back.");
      const down = await seedAnswer(a, q, a.people.poster.id, {
        status: "REMOVED",
      });
      await a.h
        .http()
        .post(`${api}/appeals`)
        .set(a.auth("poster"))
        .send({ targetType: "ANSWER", targetId: down.id, note: "please" })
        .expect(201);
    });
  });
});
