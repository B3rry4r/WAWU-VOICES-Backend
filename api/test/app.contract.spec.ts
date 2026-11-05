import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "./test-env";
import { TestJwks } from "./test-jwks";

describe("API scaffold contract", () => {
  const jwks = new TestJwks();
  let app: INestApplication;

  beforeAll(async () => {
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    // Imported after the env is set: the strategy reads it at construction.
    const { AppModule } = await import("../src/app.module.js");
    const { configureApp } = await import("../src/app-config.js");
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await jwks.stop();
  });

  const http = () => request(app.getHttpServer() as App);

  it("GET /api/health is 200 and pings the database", async () => {
    const res = await http().get("/api/health").expect(200);
    expect(res.body).toEqual({ status: "ok", db: "up" });
  });

  it("protected probe is 401 without a token, in the one error shape", async () => {
    const res = await http().get("/api/_probe/protected").expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      message: "Unauthorized",
      code: "unauthorized",
    });
  });

  it("protected probe is 401 with a token signed by another key", async () => {
    const other = new TestJwks();
    await other.start();
    const token = other.sign();
    await other.stop();
    await http()
      .get("/api/_probe/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("protected probe is 401 for a refresh token", async () => {
    await http()
      .get("/api/_probe/protected")
      .set("Authorization", `Bearer ${jwks.sign({ type: "refresh" })}`)
      .expect(401);
  });

  it("protected probe is 200 with a valid token signed by the JWKS key", async () => {
    const res = await http()
      .get("/api/_probe/protected")
      .set("Authorization", `Bearer ${jwks.sign({ sub: "wawu-42" })}`)
      .expect(200);
    expect(res.body).toEqual({ sub: "wawu-42" });
  });

  it("guest probe: no token is a guest, a good token is a user, a bad token is 401", async () => {
    expect((await http().get("/api/_probe/guest").expect(200)).body).toEqual({
      signedIn: false,
      sub: null,
    });
    expect(
      (
        await http()
          .get("/api/_probe/guest")
          .set("Authorization", `Bearer ${jwks.sign({ sub: "u9" })}`)
          .expect(200)
      ).body,
    ).toEqual({ signedIn: true, sub: "u9" });
    await http()
      .get("/api/_probe/guest")
      .set("Authorization", "Bearer not.a.token")
      .expect(401);
  });

  it("unknown route is 404 in the one error shape", async () => {
    const res = await http().get("/api/nope").expect(404);
    expect(Object.keys(res.body as object).sort()).toEqual([
      "code",
      "message",
      "statusCode",
    ]);
    expect((res.body as { code: string }).code).toBe("not_found");
  });
});
