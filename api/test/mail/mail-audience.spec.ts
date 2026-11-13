/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- tests read untyped JSON bodies */
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { configureApp } from "../../src/app-config";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { MailAudienceController } from "../../src/mail/mail-audience.controller";
import {
  MailAudienceService,
  firstNameOf,
} from "../../src/mail/mail-audience.service";

/**
 * EMAIL-03 (V-AUD): GET /api/v1/internal/mail/audience. The real controller, guard, service and the app's own pipes and
 * error filter run; only the database is a small in-memory stand-in that answers the exact query the service asks, so
 * this needs no Postgres. Nothing is sent anywhere.
 */
const KEY = "audience-test-service-key-not-real";
const url = "/api/v1/internal/mail/audience";

interface Row {
  id: string;
  status: string;
  mailTo: string | null;
  displayName: string | null;
}

describe("GET /internal/mail/audience", () => {
  let app: INestApplication;
  let rows: Row[];
  let writes = 0;
  const calls: unknown[] = [];

  const matches = (r: Row, where: any): boolean =>
    r.status === where.status &&
    r.mailTo !== null &&
    r.mailTo !== "" &&
    (where.id?.gt === undefined || r.id > where.id.gt);

  const fakePrisma = {
    user: {
      findMany: ({
        where,
        orderBy,
        take,
      }: {
        where: any;
        orderBy: unknown;
        take: number;
      }) => {
        calls.push({ where, orderBy, take });
        return Promise.resolve(
          rows
            .filter((r) => matches(r, where))
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .slice(0, take),
        );
      },
      count: ({ where }: any) =>
        Promise.resolve(rows.filter((r) => matches(r, where)).length),
      create: () => (writes++, Promise.reject(new Error("write"))),
      update: () => (writes++, Promise.reject(new Error("write"))),
      updateMany: () => (writes++, Promise.reject(new Error("write"))),
      delete: () => (writes++, Promise.reject(new Error("write"))),
    },
  };

  const make = (id: number, over: Partial<Row> = {}): Row => ({
    id: `u${String(id).padStart(3, "0")}`,
    status: "ACTIVE",
    mailTo: `m${id}@audience.test`,
    displayName: `Name${id} Surname`,
    ...over,
  });

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = KEY;
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [MailAudienceController],
      providers: [
        MailAudienceService,
        { provide: PrismaService, useValue: fakePrisma },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INTERNAL_SERVICE_KEY;
  });

  beforeEach(() => {
    rows = [];
    calls.length = 0;
  });

  const get = (q = "", key: string | null = KEY) => {
    const r = request(app.getHttpServer() as App).get(`${url}${q}`);
    return key === null ? r : r.set("X-Service-Key", key);
  };

  it("is 401 with no key, a wrong key or a key of another length, and reads nothing", async () => {
    rows = [make(1)];
    await get("", null).expect(401);
    await get("", "wrong").expect(401);
    await get("", `${KEY}x`).expect(401);
    await get("", KEY.slice(0, -1)).expect(401);
    await get("", "").expect(401);
    expect(calls).toHaveLength(0);
  });

  it("is 401 for everyone while the server has no key set", async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [MailAudienceController],
      providers: [
        MailAudienceService,
        { provide: PrismaService, useValue: fakePrisma },
      ],
    }).compile();
    const bare = mod.createNestApplication();
    configureApp(bare);
    await bare.init();
    try {
      const call = (k: string) =>
        request(bare.getHttpServer() as App)
          .get(url)
          .set("X-Service-Key", k);
      await call("").expect(401);
      await call(KEY).expect(401);
    } finally {
      await bare.close();
      process.env.INTERNAL_SERVICE_KEY = KEY;
    }
  });

  it("refuses before it reads the query", async () => {
    await get("?limit=nonsense", null).expect(401);
  });

  it("answers { data, nextCursor, total } with email and firstName", async () => {
    rows = [make(1), make(2, { displayName: null })];
    const res = await get().expect(200);
    expect(res.body).toEqual({
      data: [
        { email: "m1@audience.test", firstName: "Name1" },
        { email: "m2@audience.test", firstName: null },
      ],
      nextCursor: null,
      total: 2,
    });
  });

  it("pages by cursor in id order, the cursor being the last id, and total counts everyone", async () => {
    rows = [5, 3, 1, 4, 2].map((n) => make(n));
    const a = await get("?limit=2").expect(200);
    expect(a.body.data.map((d: { email: string }) => d.email)).toEqual([
      "m1@audience.test",
      "m2@audience.test",
    ]);
    expect(a.body.nextCursor).toBe("u002");
    expect(a.body.total).toBe(5);
    const b = await get("?limit=2&cursor=u002").expect(200);
    expect(b.body.data.map((d: { email: string }) => d.email)).toEqual([
      "m3@audience.test",
      "m4@audience.test",
    ]);
    expect(b.body.nextCursor).toBe("u004");
    const c = await get("?limit=2&cursor=u004").expect(200);
    expect(c.body.data).toHaveLength(1);
    expect(c.body.nextCursor).toBeNull();
    expect(c.body.total).toBe(5);
  });

  it("gives a last page of exactly limit members no next cursor", async () => {
    rows = [make(1), make(2)];
    const res = await get("?limit=2").expect(200);
    expect(res.body.nextCursor).toBeNull();
  });

  it("defaults the limit to 500 and takes 1 to 1000", async () => {
    await get().expect(200);
    expect((calls[0] as any).take).toBe(501);
    await get("?limit=1000").expect(200);
    await get("?limit=1").expect(200);
    await get("?limit=0").expect(422);
    await get("?limit=1001").expect(422);
    await get("?limit=abc").expect(422);
  });

  it("lists only ACTIVE members who have a mailTo address", async () => {
    rows = [
      make(1),
      make(2, { status: "SUSPENDED" }),
      make(3, { status: "BANNED" }),
      make(4, { status: "DELETION_PENDING" }),
      make(5, { status: "DELETED" }),
      make(6, { mailTo: null }),
      make(7, { mailTo: "" }),
      make(8),
    ];
    const res = await get().expect(200);
    expect(res.body.data.map((d: { email: string }) => d.email)).toEqual([
      "m1@audience.test",
      "m8@audience.test",
    ]);
    expect(res.body.total).toBe(2);
  });

  it("asks for ACTIVE, an address and id order, and never writes", async () => {
    await get("?cursor=u010").expect(200);
    expect(calls[0]).toMatchObject({
      where: { status: "ACTIVE", mailTo: { not: null }, id: { gt: "u010" } },
      orderBy: { id: "asc" },
    });
    expect(writes).toBe(0);
  });

  it("takes the first word of the display name as firstName, or null", () => {
    expect(firstNameOf("Ada Obi")).toBe("Ada");
    expect(firstNameOf("  Ada   Obi ")).toBe("Ada");
    expect(firstNameOf("Ada")).toBe("Ada");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
