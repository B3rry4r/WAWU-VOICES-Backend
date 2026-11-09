/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { Harness, makePerson, startHarness } from "../talk/harness";

/** LCH-A2 fix 5: GET /invites/:code turns a code into the owner's handle, and nothing else. */
describe("invite lookup (the asked-how-you-feel line)", () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.INVITE_LOOKUP_IP_LIMIT = "100000";
    h = await startHarness();
  });
  afterAll(async () => {
    delete process.env.INVITE_LOOKUP_IP_LIMIT;
    await h.close();
  });

  const lookup = (code: string) =>
    h.http().get(`/api/v1/invites/${encodeURIComponent(code)}`);
  const codeOf = async (auth: string): Promise<string> =>
    (
      await h
        .http()
        .get("/api/v1/me/invite")
        .set("Authorization", auth)
        .expect(200)
    ).body.code;

  it("a good code gives the handle and only the handle, with no sign-in and no caching", async () => {
    const ada = await makePerson(h);
    const code = await codeOf(ada.auth);
    const handle = (
      await h.prisma.user.findUniqueOrThrow({ where: { id: ada.id } })
    ).handle;
    const r = await lookup(code).expect(200);
    expect(r.body).toEqual({ handle });
    expect(Object.keys(r.body)).toEqual(["handle"]);
    expect(r.headers["cache-control"]).toBe("no-store");
    // upper case and padding are accepted the way the claim accepts them
    expect((await lookup(code.toUpperCase()).expect(200)).body).toEqual({
      handle,
    });
  });

  it("a bad, unknown or wrong-shaped code shows no line (handle null, same 200)", async () => {
    for (const c of [
      "zzzzzzz",
      "abc",
      "not a code at all!!",
      "a".repeat(200),
      "ABCDEF-",
    ]) {
      const r = await lookup(c).expect(200);
      expect(r.body).toEqual({ handle: null });
    }
  });

  it("an owner who is suspended, banned or being deleted shows no line", async () => {
    for (const status of ["SUSPENDED", "BANNED", "DELETION_PENDING"] as const) {
      const p = await makePerson(h);
      const code = await codeOf(p.auth);
      await h.prisma.user.update({ where: { id: p.id }, data: { status } });
      expect((await lookup(code).expect(200)).body).toEqual({ handle: null });
    }
  });
});

/** A fresh app, so the limit counts only these calls. */
describe("invite lookup rate limit", () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.INVITE_LOOKUP_IP_LIMIT = "5";
    h = await startHarness();
  });
  afterAll(async () => {
    delete process.env.INVITE_LOOKUP_IP_LIMIT;
    await h.close();
  });
  const lookup = (code: string) => h.http().get(`/api/v1/invites/${code}`);

  it("is limited per network address", async () => {
    for (let i = 0; i < 5; i++) await lookup("abcdefg").expect(200);
    const over = await lookup("abcdefg");
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("RATE_LIMITED");
  });
});
