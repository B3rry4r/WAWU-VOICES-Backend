/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import {
  bootAdmin,
  modItem,
  report,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "../admin/helpers";

describe("privacy fix P4: the moderator who took the action cannot decide its appeal", () => {
  let a: Admin;
  let q: string;
  const url = "/api/v1/admin/moderation/items";

  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("mod2", ["MODERATOR"]);
    await a.person("poster");
    await a.person("r1");
    q = (await seedQuestion(a)).id;
  });
  afterAll(() => a.close());

  async function removedWithAppeal() {
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "Breaks the rules." })
      .expect(200);
    const ap = await a.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: ans.id,
        queue: "APPEAL",
        reasons: ["APPEAL"],
        reportCount: 1,
      },
    });
    await a.prisma.appeal.create({
      data: {
        userId: a.people.poster.id,
        targetType: "ANSWER",
        targetId: ans.id,
        note: "Please look again",
        itemId: ap.id,
      },
    });
    return { ans, ap };
  }

  it("the moderator who removed the post gets 403 with the plain words and nothing changes", async () => {
    const { ans, ap } = await removedWithAppeal();
    const r = await a.h
      .http()
      .post(`${url}/${ap.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "RESTORE", reason: "I changed my mind." })
      .expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
    expect(r.body.error.message).toBe(
      "Another moderator must decide this appeal.",
    );
    expect(
      (await a.prisma.appeal.findFirstOrThrow({ where: { targetId: ans.id } }))
        .status,
    ).toBe("OPEN");
    expect(
      (await a.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
        .status,
    ).toBe("REMOVED");
  });

  it("another moderator can decide it, and so can an admin", async () => {
    const one = await removedWithAppeal();
    await a.h
      .http()
      .post(`${url}/${one.ap.id}/action`)
      .set(a.auth("mod2"))
      .send({ action: "RESTORE", reason: "Fair." })
      .expect(200);
    const appeal1 = await a.prisma.appeal.findFirstOrThrow({
      where: { targetId: one.ans.id },
    });
    expect(appeal1).toMatchObject({
      status: "DECIDED",
      decidedById: a.people.mod2.id,
    });
    const two = await removedWithAppeal();
    await a.h
      .http()
      .post(`${url}/${two.ap.id}/action`)
      .set(a.auth("admin"))
      .send({ action: "KEEP", reason: "Stays down." })
      .expect(200);
    expect(
      (
        await a.prisma.appeal.findFirstOrThrow({
          where: { targetId: two.ans.id },
        })
      ).status,
    ).toBe("DECIDED");
  });

  it("with no appeal open the same moderator can still act again on the post", async () => {
    const ans = await seedAnswer(a, q, a.people.poster.id);
    const item = await modItem(a, "ANSWER", ans.id, "SENSITIVE", 0);
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "No." })
      .expect(200);
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "RESTORE", reason: "Checked again." })
      .expect(200);
  });
});
