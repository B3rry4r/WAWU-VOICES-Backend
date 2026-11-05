/* eslint-disable @typescript-eslint/no-unsafe-member-access -- tests read JSON bodies and raw SQL rows */
import { algNone, boot, forgedHs256, type Harness } from "./helpers";

const ISS = "https://id.wawuafrica.com";

/** The guard tests the scaffold lacks: every forged or out-of-date token is 401 in the one error shape. */
describe("token guard attacks", () => {
  describe("no issuer or audience configured (the live default)", () => {
    let h: Harness;
    beforeAll(async () => {
      delete process.env.WAWU_ID_JWT_ISSUER;
      delete process.env.WAWU_ID_JWT_AUDIENCE;
      h = await boot();
    });
    afterAll(() => h.close());
    const get = (token?: string) => {
      const r = h.http().get("/api/v1/me");
      return token ? r.set("Authorization", `Bearer ${token}`) : r;
    };

    it("a token with no iss and no aud is accepted (WAWU ID live tokens carry neither)", async () => {
      await get(h.token("guard-ok")).expect(200);
    });
    it("HS256 signed with the public key is 401", async () => {
      const t = await forgedHs256(h.jwks.url, { sub: "evil", email: "e@x.io" });
      const res = await get(t).expect(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });
    it("alg none is 401", async () => {
      await get(algNone({ sub: "evil" })).expect(401);
    });
    it("an expired token is 401 TOKEN_EXPIRED", async () => {
      const res = await get(
        h.token("guard-exp", {}, { expiresIn: -120 }),
      ).expect(401);
      expect(res.body.error.code).toBe("TOKEN_EXPIRED");
    });
    it("a token signed by another key is 401", async () => {
      const { TestJwks } = await import("../test-jwks.js");
      const other = new TestJwks();
      await other.start();
      const t = other.sign({ sub: "evil" });
      await other.stop();
      await get(t).expect(401);
    });
    it("a refresh token, a token with no sub, and garbage are 401", async () => {
      await get(h.token("guard-r", { type: "refresh" })).expect(401);
      const noSub = h.jwks.sign({ sub: undefined, email: "a@b.co" });
      const res = await get(noSub).expect(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      await get("not.a.token").expect(401);
      await get().expect(401);
    });
    it("every protected me route is 401 with no token", async () => {
      for (const [m, p] of [
        ["get", "/api/v1/me"],
        ["post", "/api/v1/me"],
        ["delete", "/api/v1/me"],
        ["patch", "/api/v1/me/profile"],
        ["get", "/api/v1/me/settings"],
        ["patch", "/api/v1/me/settings"],
        ["get", "/api/v1/me/handle-check?handle=abc"],
        ["put", "/api/v1/me/categories"],
        ["put", "/api/v1/me/tag-follows"],
        ["get", "/api/v1/me/blocks"],
        ["put", "/api/v1/me/blocks/0190a000-0000-7000-8000-000000000000"],
        ["get", "/api/v1/me/answers"],
        ["get", "/api/v1/me/saved"],
        ["post", "/api/v1/me/export"],
        ["get", "/api/v1/admin/roles"],
        [
          "put",
          "/api/v1/admin/users/0190a000-0000-7000-8000-000000000000/roles",
        ],
      ] as const) {
        await (
          h.http() as never as Record<
            string,
            (p: string) => Promise<{ status: number }>
          >
        )
          [m](p)
          .then((r) => expect([m, p, r.status]).toEqual([m, p, 401]));
      }
    });
  });

  describe("issuer and audience configured", () => {
    let h: Harness;
    beforeAll(async () => {
      h = await boot({
        WAWU_ID_JWT_ISSUER: ISS,
        WAWU_ID_JWT_AUDIENCE: "voices",
      });
    });
    afterAll(() => h.close());
    const get = (token: string) =>
      h.http().get("/api/v1/me").set("Authorization", `Bearer ${token}`);

    it("the right issuer and audience is accepted", async () => {
      await get(
        h.token("iss-ok", {}, { issuer: ISS, audience: "voices" }),
      ).expect(200);
    });
    it("a wrong issuer is 401", async () => {
      await get(
        h.token(
          "iss-bad",
          {},
          { issuer: "https://evil.example", audience: "voices" },
        ),
      ).expect(401);
    });
    it("a missing issuer is 401", async () => {
      await get(h.token("iss-none", {}, { audience: "voices" })).expect(401);
    });
    it("a wrong audience is 401", async () => {
      await get(
        h.token("aud-bad", {}, { issuer: ISS, audience: "other-app" }),
      ).expect(401);
    });
    it("a missing audience is 401", async () => {
      await get(h.token("aud-none", {}, { issuer: ISS })).expect(401);
    });
  });
});
