import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";

/** One app on the shared test database with the local WAWU ID stand-in. Imports after env is set. */
export async function boot() {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.SPACES_BUCKET = "voices-test";
  process.env.SPACES_KEY = "test-key";
  process.env.SPACES_SECRET = "test-secret";
  process.env.SPACES_ENDPOINT = "https://nyc3.digitaloceanspaces.com";
  process.env.THROTTLE_LIMIT = "100000";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { PrismaService } =
    await import("../../src/common/prisma/prisma.service.js");
  const { ResultsService } =
    await import("../../src/results/results.service.js");
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app: INestApplication = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const results = app.get(ResultsService, { strict: false });
  return {
    app,
    prisma,
    results,
    jwks,
    http: () => request(app.getHttpServer() as App),
    bearer: (sub: string) => `Bearer ${jwks.sign({ sub })}`,
    async close() {
      await app.close();
      await jwks.stop();
    },
  };
}

let n = 0;
export function uid(prefix: string): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}`;
}
