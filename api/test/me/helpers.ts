import { createHmac, createPublicKey } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";

export interface Harness {
  app: INestApplication;
  jwks: TestJwks;
  http: () => ReturnType<typeof request>;
  /** A WAWU ID access token for this sub (phone and email claims included). */
  token: (
    sub: string,
    claims?: Record<string, unknown>,
    opts?: object,
  ) => string;
  close: () => Promise<void>;
  moduleRef: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>
  >;
}

/** Boots the whole API against the real test database and a local JWKS. `env` is set before the app is built. */
export async function boot(
  env: Record<string, string> = {},
  override?: (b: ReturnType<typeof Test.createTestingModule>) => void,
  extraImports: unknown[] = [],
): Promise<Harness> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.THROTTLE_LIMIT ??= "100000";
  process.env.ME_SIGNUP_LIMIT ??= "100000";
  process.env.ME_SENSITIVE_LIMIT ??= "100000";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const builder = Test.createTestingModule({
    imports: [AppModule, ...(extraImports as never[])],
  });
  override?.(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    jwks,
    moduleRef,
    http: () => request(app.getHttpServer() as App),
    token: (sub, claims = {}, opts = {}) =>
      jwks.sign(
        {
          sub,
          email: `${sub}@example.com`,
          phone: `+234801${hash4(sub)}000`,
          ...claims,
        },
        opts,
      ),
    close: async () => {
      await app.close();
      await jwks.stop();
      for (const k of Object.keys(env)) delete process.env[k];
    },
  };
}

function hash4(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 10000;
  return String(h).padStart(4, "0");
}

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Empties the tables these tests touch (TRUNCATE works on the append-only tables; DELETE does not). */
export async function reset(): Promise<void> {
  await sql(
    `TRUNCATE "User", "Category", "ConfigEntry", "Topic", "Question", "AuditLog", "LedgerTransaction", "LedgerEntry" RESTART IDENTITY CASCADE`,
  );
}

export async function seedCategories(n = 4): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await sql<{ id: string }>(
      `INSERT INTO "Category"(id, slug, name, "sortOrder", active) VALUES (gen_random_uuid(), $1, $2, $3, true) RETURNING id`,
      [`cat-${i}`, `Category ${i}`, i],
    );
    ids.push(r[0].id);
  }
  return ids;
}

export function createBody(
  categoryIds: string[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    handle: "ada.okafor",
    ageConfirmed: true,
    termsAccepted: true,
    rulesAccepted: true,
    countryCode: "NG",
    languages: ["en"],
    categoryIds: categoryIds.slice(0, 3),
    ...over,
  };
}

/** Signs up a person end to end and returns their token and Me. */
export async function signUp(
  h: Harness,
  sub: string,
  handle: string,
  categoryIds: string[],
  claims: Record<string, unknown> = {},
): Promise<{ token: string; me: Record<string, any> }> {
  const token = h.token(sub, claims);
  const res = await h
    .http()
    .post("/api/v1/me")
    .set("Authorization", `Bearer ${token}`)
    .send(createBody(categoryIds, { handle }));
  if (res.status !== 201)
    throw new Error(`signUp ${sub}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token, me: res.body as Record<string, any> };
}

/** A token signed HS256 with the JWKS public key as the secret (the classic algorithm-confusion forgery). */
export async function forgedHs256(
  jwksUrl: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const jwk = ((await (await fetch(jwksUrl)).json()) as { keys: object[] })
    .keys[0];
  const pem = createPublicKey({ key: jwk as never, format: "jwk" }).export({
    type: "spki",
    format: "pem",
  }) as string;
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT", kid: "test-key-1" });
  const body = enc({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const sig = createHmac("sha256", pem)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function algNone(claims: Record<string, unknown>): string {
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ exp: Math.floor(Date.now() / 1000) + 600, ...claims })}.`;
}
