import { randomUUID } from "node:crypto";
import { makePerson, startHarness, type Harness } from "../talk/harness";
import { DmService } from "../../src/dm/dm.service";

/**
 * V-LINK-IN-TX: a direct message is stored in one transaction and its charge needs no link (the sweeper reads only the
 * post charges). One gap was after the store: a read that failed while the answer was built reversed the charge of a
 * message that was already stored. Now a stored message keeps its charge, whatever happens after.
 */
describe("direct message: a failure after the store never reverses the charge", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it("the balance read fails after the store: the message stays stored and its charge stays COMMITTED", async () => {
    const a = await makePerson(h, {
      verified: true,
      balanceMilli: 100_000,
      freePosts: 0,
    });
    const b = await makePerson(h);
    const spy = jest
      .spyOn(
        DmService.prototype as unknown as { balanceOf: () => Promise<number> },
        "balanceOf",
      )
      .mockRejectedValueOnce(new Error("db down"));
    const res = await h
      .http()
      .post("/api/v1/dm/messages")
      .set("Authorization", a.auth)
      .set("Idempotency-Key", randomUUID())
      .send({ toUserId: b.id, kind: "TEXT", body: "hello there" });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await h.prisma.dmMessage.count({ where: { senderId: a.id } })).toBe(
      1,
    );
    const ch = await h.prisma.charge.findFirstOrThrow({
      where: { userId: a.id },
    });
    expect(ch.status).toBe("COMMITTED");
    expect(ch.refType).toBeNull(); // no mark: the sweeper never reads it
  });
});
