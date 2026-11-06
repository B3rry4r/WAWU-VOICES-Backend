/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import {
  bootAdmin,
  report,
  modItem,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "./helpers";

/**
 * lead ruling WF, 6 Nov (WF-5): an appeal's outcome follows the moderator's choice about the ACTION appealed, not the
 * post's state. KEEP upholds the action (declined, strike and suspension stay); RESTORE undoes it (accepted).
 */
describe("WF-5: appeal outcome follows the choice, for a warning, a removal and a suspension", () => {
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
    q = (await seedQuestion(a)).id;
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
  const appeal = (targetType: string, targetId: string) =>
    a.h
      .http()
      .post(`${api}/appeals`)
      .set(a.auth("poster"))
      .send({ targetType, targetId, note: "I think you got this wrong." });
  const notices = async () =>
    (
      await a.h
        .http()
        .get(`${api}/notifications`)
        .set(a.auth("poster"))
        .expect(200)
    ).body.items as any[];
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
  const strikes = () =>
    a.prisma.strike.count({ where: { userId: a.people.poster.id } });
  const userStatus = async () =>
    (
      await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.poster.id },
      })
    ).status;
  const postStatus = async (id: string) =>
    (await a.prisma.answer.findUniqueOrThrow({ where: { id } })).status;

  /** The first decision (by `mod`), on a reported post. */
  async function decided(action: string) {
    await reset();
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    await act("mod", item.id, action, "First decision.").expect(200);
    return ans;
  }
  async function appealItem(targetType: string, targetId: string) {
    await appeal(targetType, targetId).expect(201);
    return a.prisma.moderationItem.findFirstOrThrow({
      where: { targetType: targetType as never, targetId, queue: "APPEAL" },
    });
  }
  const kindOf = async (itemId: string) =>
    (await a.h.http().get(`${items}/${itemId}`).set(a.auth("mod2")).expect(200))
      .body.appealKind;
  const appealTitles = async () =>
    (await notices())
      .map((n) => n.title as string)
      .filter((t) => /^Your appeal/.test(t));

  describe("a warning (the post stays up)", () => {
    it("Keep the warning (KEEP): declined, the strike stays, the post stays up", async () => {
      const ans = await decided("WARN");
      expect(await strikes()).toBe(1);
      const ap = await appealItem("ANSWER", ans.id);
      expect(await kindOf(ap.id)).toBe("WARNING");
      await act("mod2", ap.id, "KEEP", "The warning stands.").expect(200);
      expect(await appealTitles()).toEqual(["Your appeal was declined"]);
      const n = (await notices()).find((x) => /^Your appeal/.test(x.title));
      expect(n.body).toBe("The warning stands.");
      expect(await strikes()).toBe(1);
      expect(await postStatus(ans.id)).toBe("PUBLISHED");
      expect(await userStatus()).toBe("ACTIVE");
    });
    it("Remove the warning (RESTORE): accepted, the strike goes", async () => {
      const ans = await decided("WARN");
      const ap = await appealItem("ANSWER", ans.id);
      await act("mod2", ap.id, "RESTORE", "Our mistake.").expect(200);
      expect(await appealTitles()).toEqual([
        "Your appeal was accepted and the strike was removed",
      ]);
      expect(await strikes()).toBe(0);
      expect(await postStatus(ans.id)).toBe("PUBLISHED");
    });
  });

  describe("a removal", () => {
    it("Keep it removed (KEEP): declined, the post stays down, the strike stays", async () => {
      const ans = await decided("REMOVE_AND_WARN");
      expect(await postStatus(ans.id)).toBe("REMOVED");
      const ap = await appealItem("ANSWER", ans.id);
      expect(await kindOf(ap.id)).toBe("REMOVAL");
      await act("mod2", ap.id, "KEEP", "It stays down.").expect(200);
      expect(await appealTitles()).toEqual(["Your appeal was declined"]);
      expect(await postStatus(ans.id)).toBe("REMOVED");
      expect(await strikes()).toBe(1);
    });
    it("Put it back (RESTORE): accepted, the post is up, the strike goes", async () => {
      const ans = await decided("REMOVE_AND_WARN");
      const ap = await appealItem("ANSWER", ans.id);
      await act("mod2", ap.id, "RESTORE", "It was fine.").expect(200);
      expect(await appealTitles()).toEqual([
        "Your appeal was accepted and the strike was removed",
      ]);
      expect(await postStatus(ans.id)).toBe("PUBLISHED");
      expect(await strikes()).toBe(0);
    });
    it("a held post: KEEP leaves it held and declines", async () => {
      await reset();
      const held = await seedAnswer(a, q, a.people.poster.id, {
        status: "HELD",
      });
      const ap = await appealItem("ANSWER", held.id);
      expect(await kindOf(ap.id)).toBe("REMOVAL");
      await act("mod2", ap.id, "KEEP", "Still held.").expect(200);
      expect(await postStatus(held.id)).toBe("HELD");
      expect(await appealTitles()).toEqual(["Your appeal was declined"]);
    });
  });

  describe("a suspension", () => {
    async function suspended() {
      const ans = await decided("SUSPEND");
      expect(await userStatus()).toBe("SUSPENDED");
      return ans;
    }
    it("Keep it (KEEP): declined, still suspended, the strike stays", async () => {
      await suspended();
      const ap = await appealItem("USER", a.people.poster.id);
      expect(await kindOf(ap.id)).toBe("SUSPENSION");
      await act("mod2", ap.id, "KEEP", "Stays suspended.").expect(200);
      expect(await appealTitles()).toEqual(["Your appeal was declined"]);
      expect(await userStatus()).toBe("SUSPENDED");
      expect(await strikes()).toBe(1);
    });
    it("Lift the suspension (RESTORE): accepted, active again, the strike goes", async () => {
      await suspended();
      const ap = await appealItem("USER", a.people.poster.id);
      await act("mod2", ap.id, "RESTORE", "Our mistake.").expect(200);
      expect(await appealTitles()).toEqual([
        "Your appeal was accepted and the strike was removed",
      ]);
      expect(await userStatus()).toBe("ACTIVE");
      expect(await strikes()).toBe(0);
    });
  });
});
