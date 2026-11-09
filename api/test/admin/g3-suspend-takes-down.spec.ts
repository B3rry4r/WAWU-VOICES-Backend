/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- tests read untyped JSON bodies */
import {
  bootAdmin,
  report,
  modItem,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "./helpers";

/**
 * G3, V-40 (lead, 9 Nov, walk C): suspending a person from a reported post or answer also takes that post down, as Remove
 * does. A suspension from an account item removes nothing. An appeal that wins puts the post back and lifts the strike.
 */
describe("G3 (V-40): Suspend from a reported post takes the post down", () => {
  let a: Admin;
  let q: string;
  const api = "/api/v1";
  const items = `${api}/admin/moderation/items`;

  beforeAll(async () => {
    a = await bootAdmin();
    await a.prisma.configEntry.upsert({
      where: { key: "ratelimit.appeal_per_10min" },
      create: { key: "ratelimit.appeal_per_10min", valueJson: 1000 },
      update: { valueJson: 1000 },
    });
    await a.person("mod", ["MODERATOR"]);
    await a.person("mod2", ["MODERATOR"]);
    await a.person("poster");
    await a.person("r1");
    await a.person("editor", ["EDITOR"]);
    q = (await seedQuestion(a)).id;
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification", "Block" CASCADE`,
    );
    await a.close();
  });
  const act = (who: string, id: string, action: string, reason: string) =>
    a.h
      .http()
      .post(`${items}/${id}/action`)
      .set(a.auth(who))
      .send({ action, reason });
  const reset = async () => {
    await a.prisma.notification.deleteMany({});
    await a.prisma.appeal.deleteMany({});
    await a.prisma.strike.deleteMany({});
    await a.prisma.moderationAction.deleteMany({});
    await a.prisma.moderationItem.deleteMany({});
    await a.prisma.user.update({
      where: { id: a.people.poster.id },
      data: { status: "ACTIVE", suspendedUntil: null },
    });
  };
  const userStatus = async () =>
    (
      await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.poster.id },
      })
    ).status;
  const postStatus = async (id: string) =>
    (await a.prisma.answer.findUniqueOrThrow({ where: { id } })).status;

  it("Suspend on a reported answer: the person is suspended and the answer is REMOVED", async () => {
    await reset();
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    await act("mod", item.id, "SUSPEND", "A threat.").expect(200);
    expect(await userStatus()).toBe("SUSPENDED");
    expect(await postStatus(ans.id)).toBe("REMOVED");
    const audit = await a.prisma.auditLog.findFirstOrThrow({
      where: { action: "moderation.action", targetId: ans.id },
    });
    expect((audit.after as { contentStatus: string }).contentStatus).toBe(
      "REMOVED",
    );
  });

  it("Suspend on a reported reply takes the reply down too", async () => {
    await reset();
    const ans = await seedAnswer(a, q, a.people.r1.id);
    const reply = await a.prisma.reply.create({
      data: {
        answerId: ans.id,
        authorId: a.people.poster.id,
        stance: "AGREE",
        kind: "TEXT",
        body: "a threat",
      } as never,
    });
    await report(a, a.people.r1.id, "REPLY", reply.id);
    const item = await modItem(a, "REPLY", reply.id, "REPORTED", 1);
    await act("mod", item.id, "SUSPEND", "A threat.").expect(200);
    expect(await userStatus()).toBe("SUSPENDED");
    expect(
      (await a.prisma.reply.findUniqueOrThrow({ where: { id: reply.id } }))
        .status,
    ).toBe("REMOVED");
  });

  it("Suspend from the account item removes nothing", async () => {
    await reset();
    const ans = await seedAnswer(a, q, a.people.poster.id);
    const item = await modItem(a, "USER", a.people.poster.id, "REPORTED", 1);
    await act("mod", item.id, "SUSPEND", "Repeat harassment.").expect(200);
    expect(await userStatus()).toBe("SUSPENDED");
    expect(await postStatus(ans.id)).toBe("PUBLISHED");
  });

  it("an appeal on the answer that wins (RESTORE) puts it back, removes the strike and lifts the suspension", async () => {
    await reset();
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    await act("mod", item.id, "SUSPEND", "A threat.").expect(200);
    expect(await postStatus(ans.id)).toBe("REMOVED");
    await a.h
      .http()
      .post(`${api}/appeals`)
      .set(a.auth("poster"))
      .send({ targetType: "ANSWER", targetId: ans.id, note: "Not a threat." })
      .expect(201);
    const ap = await a.prisma.moderationItem.findFirstOrThrow({
      where: { targetType: "ANSWER", targetId: ans.id, queue: "APPEAL" },
    });
    const d = await a.h
      .http()
      .get(`${items}/${ap.id}`)
      .set(a.auth("mod2"))
      .expect(200);
    expect(d.body.appealKind).toBe("REMOVAL");
    await act("mod2", ap.id, "RESTORE", "Our mistake.").expect(200);
    expect(await postStatus(ans.id)).toBe("PUBLISHED");
    expect(
      await a.prisma.strike.count({ where: { userId: a.people.poster.id } }),
    ).toBe(0);
    expect(await userStatus()).toBe("ACTIVE");
  });

  it("G2: a result sent to moderation reads as a result (place and numbers) in the queue and the item view", async () => {
    await reset();
    const thread = await a.prisma.resultThread.create({
      data: {
        title: "Election Week",
        heldOn: new Date("2027-02-06"),
        createdById: a.people.editor.id,
      },
    });
    const post = await a.prisma.resultPost.create({
      data: {
        threadId: thread.id,
        authorId: a.people.poster.id,
        state: "Lagos",
        lga: "Yaba",
        ward: "Ward 9",
        pollingUnit: "PU 007",
        accredited: 420,
        votesCast: 380,
        rejected: 12,
        idempotencyKey: "g2-k1",
      },
    });
    await a.h
      .http()
      .post(`${api}/admin/results/posts/${post.id}/decision`)
      .set(a.auth("editor"))
      .send({ decision: "SEND_TO_MODERATION" })
      .expect(200);
    const list = await a.h
      .http()
      .get(`${items}?queue=REPORTED`)
      .set(a.auth("mod"))
      .expect(200);
    const row = list.body.items.find((i: any) => i.targetId === post.id);
    expect(row.reasons).toEqual(["result check"]);
    expect(row.summary).toBe(
      "Sent from Posted results · PU 007, Ward 9, Yaba, Lagos · accredited 420 · votes cast 380 · rejected 12",
    );
    expect(JSON.stringify(row)).not.toMatch(/result_review/i);
    const d = await a.h
      .http()
      .get(`${items}/${row.id}`)
      .set(a.auth("mod"))
      .expect(200);
    expect(JSON.stringify(d.body)).not.toMatch(/result_review/i);
    expect(d.body.item.summary).toBe(row.summary);
    expect(d.body.screening).toEqual([]);
    expect(d.body.content.body).toBe(
      "PU 007, Ward 9, Yaba, Lagos: accredited 420, votes cast 380, rejected 12",
    );
  });
});
