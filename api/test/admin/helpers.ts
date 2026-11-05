import { Controller, Get, Module, Post } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { TEST_DATABASE_URL } from "../test-env";
import {
  boot as bootBase,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "../me/helpers";
import { FakeFlutterwave } from "../units/helpers";

export { reset, seedCategories, signUp };
export type { Harness };

export interface Admin {
  h: Harness;
  flw: FakeFlutterwave;
  prisma: import("../../src/common/prisma/prisma.service").PrismaService;
  people: Record<
    string,
    { token: string; id: string; handle: string; sub: string }
  >;
  auth: (name: string) => Record<string, string>;
  person: (
    name: string,
    roles?: string[],
  ) => Promise<{ token: string; id: string; handle: string; sub: string }>;
  cats: string[];
  close: () => Promise<void>;
}

export const FAKE_STORE = {
  signedGet: (key: string) =>
    Promise.resolve({
      url: `https://signed.test/${key}`,
      expiresAt: new Date(Date.now() + 60000),
    }),
};

export async function bootAdmin(): Promise<Admin> {
  const { WriteAccess } = await import("../../src/me/index.js");
  const { FLW_CLIENT } = await import("../../src/units/flutterwave.client.js");
  const { ADMIN_MEDIA_STORE } =
    await import("../../src/admin/trust/moderation.service.js");
  @Controller("_write_probe")
  class P {
    @Post()
    @WriteAccess()
    write() {
      return { ok: true };
    }
    @Get()
    read() {
      return { ok: true };
    }
  }
  @Module({ controllers: [P] })
  class PM {}
  const flw = new FakeFlutterwave();
  process.env.APP_BASE_URL = "https://voices.test";
  const h = await bootBase(
    {},
    (b) =>
      b
        .overrideProvider(FLW_CLIENT)
        .useValue(flw)
        .overrideProvider(ADMIN_MEDIA_STORE)
        .useValue(FAKE_STORE),
    [PM],
  );
  await reset();
  await sql(
    `TRUNCATE "ModerationItem", "ModerationAction", "Ad", "Payment", "ResultThread", "IdempotencyRecord", "Wallet", "Report", "Appeal", "Notification" RESTART IDENTITY CASCADE`,
  );
  const cats = await seedCategories(4);
  const { PrismaService } =
    await import("../../src/common/prisma/prisma.service.js");
  const prisma = h.app.get(PrismaService);
  const people: Admin["people"] = {};
  const grant = async (sub: string, role: string) => {
    const { grantRole } = await import("../../src/me/roles-grant.js");
    const { PrismaClient } =
      await import("../../src/generated/prisma/client.js");
    const p = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    try {
      await grantRole(p, { wawuId: sub, role: role as never });
    } finally {
      await p.$disconnect();
    }
  };
  const person = async (name: string, roles: string[] = []) => {
    const sub = `a7b-${name}`;
    const handle = `a7b.${name}`;
    const r = await signUp(h, sub, handle, cats);
    for (const role of roles) await grant(sub, role);
    people[name] = { token: r.token, id: r.me.id as string, handle, sub };
    return people[name];
  };
  return {
    h,
    flw,
    prisma,
    people,
    cats,
    person,
    auth: (n) => ({ Authorization: `Bearer ${people[n].token}` }),
    close: () => h.close(),
  };
}

export async function seedQuestion(a: Admin, text = "Q?") {
  return a.prisma.question.create({
    data: {
      text,
      status: "LIVE",
      kind: "DAILY",
      answerCount: 0,
      voiceCount: 0,
    },
  });
}

export async function seedAnswer(
  a: Admin,
  questionId: string,
  authorId: string,
  over: Record<string, unknown> = {},
) {
  const ans = await a.prisma.answer.create({
    data: {
      questionId,
      authorId,
      kind: "TEXT",
      body: "hello there",
      ...over,
    } as never,
  });
  await a.prisma.question.update({
    where: { id: questionId },
    data: { answerCount: { increment: 1 } },
  });
  return ans;
}

export async function report(
  a: Admin,
  reporterId: string,
  targetType: string,
  targetId: string,
  reason = "THREAT_OR_VIOLENCE",
  note?: string,
) {
  await a.prisma.report.create({
    data: {
      reporterId,
      targetType: targetType as never,
      targetId,
      reason: reason as never,
      note,
    },
  });
}

export async function modItem(
  a: Admin,
  targetType: string,
  targetId: string,
  queue = "REPORTED",
  reportCount = 1,
) {
  return a.prisma.moderationItem.create({
    data: {
      targetType: targetType as never,
      targetId,
      queue: queue as never,
      reasons: ["THREAT_OR_VIOLENCE"],
      reportCount,
    },
  });
}
