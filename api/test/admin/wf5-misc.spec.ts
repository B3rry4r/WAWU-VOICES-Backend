/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import { randomUUID } from "node:crypto";
import { TopicsAdminService } from "../../src/admin/topics.service";
import { bootAdmin, seedAnswer, type Admin } from "./helpers";

const lagosDay = () =>
  new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

/** lead ruling WF, 6 Nov (WF-5): listen on an unknown answer, three faces, the viewer's reply count, flash catch-up. */
describe("WF-5: listen, recentVoices, reply count as the viewer sees it, flash re-announce", () => {
  let a: Admin;
  let q: string;
  const api = "/api/v1";

  beforeAll(async () => {
    a = await bootAdmin();
    for (const n of ["ada", "tunde", "kemi", "femi"]) await a.person(n);
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
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Block", "Notification" CASCADE`,
    );
    await a.close();
  });

  it("listen on an answer that does not exist is 404, signed in or not, like a hidden one", async () => {
    const nope = randomUUID();
    for (const who of [undefined, "ada"]) {
      const r = a.h.http().post(`${api}/answers/${nope}/listen`);
      const res = await (who ? r.set(a.auth(who)) : r)
        .send({ completed: false })
        .expect(404);
      expect(res.body.error.message).toBe("We could not find that.");
    }
    const real = await seedAnswer(a, q, a.people.kemi.id);
    await a.h
      .http()
      .post(`${api}/answers/${real.id}/listen`)
      .send({ completed: false })
      .expect(204);
  });

  it("three faces show when they exist, even when the viewer blocked the 13 newest authors", async () => {
    const q2 = (
      await a.prisma.question.create({
        data: {
          text: "A busy one?",
          kind: "DAILY",
          status: "LIVE",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 86_400_000),
        },
      })
    ).id;
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) {
      const u = await a.prisma.user.create({
        data: {
          wawuId: `wf5-face-${i}`,
          handle: `wf5.face${i}`,
          referralCode: `WF5F${i}`,
          countryCode: "NG",
        },
      });
      ids.push(u.id);
      await a.prisma.answer.create({
        data: {
          questionId: q2,
          authorId: u.id,
          kind: "TEXT",
          body: `voice ${i}`,
          createdAt: new Date(Date.now() - (100 - i) * 60_000),
        },
      });
    }
    // newest are 3..15; block them, leaving the three oldest (0, 1, 2)
    await a.prisma.block.createMany({
      data: ids.slice(3).map((id) => ({
        blockerId: a.people.ada.id,
        blockedId: id,
      })),
    });
    const card = (
      await a.h
        .http()
        .get(`${api}/questions/${q2}`)
        .set(a.auth("ada"))
        .expect(200)
    ).body;
    expect(card.recentVoices.map((v: any) => v.id).sort()).toEqual(
      ids.slice(0, 3).sort(),
    );
    await a.prisma.block.deleteMany({});
  });

  it("the thread's reply count, and its stance counts, are the list the viewer sees", async () => {
    const ans = await seedAnswer(a, q, a.people.ada.id, { body: "root" });
    const mk = (who: string, stance: "AGREE" | "DISAGREE") =>
      a.prisma.reply.create({
        data: {
          answerId: ans.id,
          authorId: a.people[who].id,
          stance,
          kind: "TEXT",
          body: `${who} replies`,
        },
      });
    await mk("tunde", "AGREE");
    await mk("kemi", "AGREE");
    await mk("femi", "DISAGREE");
    await a.prisma.answer.update({
      where: { id: ans.id },
      data: { replyCount: 3, agreeCount: 2, disagreeCount: 1 },
    });
    const thread = async (who: string) => {
      const t = (
        await a.h
          .http()
          .get(`${api}/answers/${ans.id}`)
          .set(a.auth(who))
          .expect(200)
      ).body;
      const l = (
        await a.h
          .http()
          .get(`${api}/answers/${ans.id}/replies`)
          .set(a.auth(who))
          .expect(200)
      ).body;
      return { count: t.replyCount, listed: l.items.length, counts: l.counts };
    };
    expect(await thread("ada")).toEqual({
      count: 3,
      listed: 3,
      counts: { agree: 2, disagree: 1, experience: 0 },
    });
    // she blocked tunde: 2 replies in the list, 2 in the count
    await a.prisma.block.create({
      data: { blockerId: a.people.ada.id, blockedId: a.people.tunde.id },
    });
    expect(await thread("ada")).toEqual({
      count: 2,
      listed: 2,
      counts: { agree: 1, disagree: 1, experience: 0 },
    });
    // femi blocked her (the other direction): the same for femi's replies
    await a.prisma.block.deleteMany({});
    await a.prisma.block.create({
      data: { blockerId: a.people.femi.id, blockedId: a.people.ada.id },
    });
    expect((await thread("ada")).count).toBe(2);
    // someone not involved still sees all 3
    expect((await thread("kemi")).count).toBe(3);
    await a.prisma.block.deleteMany({});
  });

  it("the flash re-announce catches up what a crash cut short, once, and ignores closed polls", async () => {
    await a.prisma.$executeRawUnsafe(`TRUNCATE "Poll", "Notification" CASCADE`);
    await a.prisma.userSettings.updateMany({
      data: { notifyFlashPolls: false },
    });
    await a.prisma.userSettings.updateMany({
      where: { userId: { in: [a.people.ada.id, a.people.tunde.id] } },
      data: { notifyFlashPolls: true },
    });
    const open = await a.prisma.poll.create({
      data: {
        kind: "FLASH",
        title: "Should fuel cost less?",
        status: "OPEN",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    await a.prisma.poll.create({
      data: {
        kind: "FLASH",
        title: "Old one?",
        status: "CLOSED",
        startsAt: new Date(Date.now() - 7_200_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    // the first run died after one person
    await a.prisma.notification.create({
      data: {
        userId: a.people.ada.id,
        type: "FLASH_POLL",
        title: "A flash poll is open",
        body: open.title,
        targetType: "poll",
        targetId: open.id,
        groupKey: `flash:${open.id}`,
      },
    });
    const svc = a.h.moduleRef.get(TopicsAdminService, { strict: false });
    const count = () =>
      a.prisma.notification.count({ where: { type: "FLASH_POLL" } });
    expect(await svc.reannounceOpenFlash()).toBe(1);
    expect(await count()).toBe(2);
    // throttled, and a forced second run adds nothing
    expect(await svc.reannounceOpenFlash()).toBe(0);
    expect(await svc.reannounceOpenFlash(new Date(), 0)).toBe(0);
    expect(await count()).toBe(2);
  });
});
