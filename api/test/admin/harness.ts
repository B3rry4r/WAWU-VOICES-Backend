/* eslint-disable @typescript-eslint/no-unsafe-assignment -- tests read untyped JSON bodies */
import { PrismaService } from "../../src/common/prisma/prisma.service";
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "../me/helpers";

export { sql };
export type { Harness };

const DAY = 86_400_000;

const CLEAN = `TRUNCATE "Poll", "Override", "WeeklyReport", "ProposalGroup", "ConfigEntry", "ConfigChange", "Notification", "ShareEvent", "ShortLink", "Report", "ModerationItem", "Ad", "ResultPost", "ResultThread", "NewsVerificationRequest", "StoredFile", "VoiceClip" RESTART IDENTITY CASCADE`;

export const lagosToday = (now = new Date()): string =>
  new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
export const plusDays = (day: string, n: number): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY)
    .toISOString()
    .slice(0, 10);
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
export const lagosStart = (day: string): Date =>
  new Date(dateOf(day).getTime() - 3_600_000);

export interface Staff {
  token: string;
  id: string;
  auth: { Authorization: string };
}

export interface World {
  h: Harness;
  prisma: PrismaService;
  cats: string[];
  admin: Staff;
  admin2: Staff;
  editor: Staff;
  moderator: Staff;
  adManager: Staff;
  plain: Staff;
  api: (
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
    who?: Staff | null,
    body?: unknown,
  ) => Promise<{ status: number; body: any; headers: Record<string, string> }>;
  close: () => Promise<void>;
}

/** Boots the whole API on this task's own test database with one person per role. */
export async function world(env: Record<string, string> = {}): Promise<World> {
  const h = await boot({ ADMIN_JOBS: "off", ...env });
  await reset();
  await sql(CLEAN);
  const prisma = h.app.get(PrismaService);
  const cats = await seedCategories(4);
  const mk = async (
    sub: string,
    handle: string,
    roles: string[],
  ): Promise<Staff> => {
    const { token, me } = await signUp(h, sub, handle, cats);
    for (const role of roles)
      await sql(
        `INSERT INTO "UserRoleGrant"(id, "userId", role, "grantedById") VALUES (gen_random_uuid(), $1, $2::"VoicesRole", $1)`,
        [me.id, role],
      );
    return {
      token,
      id: me.id as string,
      auth: { Authorization: `Bearer ${token}` },
    };
  };
  const admin = await mk("a7-admin", "ada.admin", ["ADMIN"]);
  const admin2 = await mk("a7-admin2", "bola.admin", ["ADMIN"]);
  const editor = await mk("a7-editor", "ed.editor", ["EDITOR"]);
  const moderator = await mk("a7-mod", "mo.mod", ["MODERATOR"]);
  const adManager = await mk("a7-ads", "ad.manager", ["AD_MANAGER"]);
  const plain = await mk("a7-plain", "pat.plain", []);
  const api: World["api"] = async (method, path, who, body) => {
    let r = h.http()[method](`/api/v1${path}`);
    if (who) r = r.set(who.auth);
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    return {
      status: res.status,
      body: res.body,
      headers: res.headers,
    };
  };
  return {
    h,
    prisma,
    cats,
    admin,
    admin2,
    editor,
    moderator,
    adManager,
    plain,
    api,
    // leave the shared test database as other suites expect it: no config rows, no people, no calendar
    close: async () => {
      await reset();
      await sql(CLEAN);
      await h.close();
    },
  };
}

/** A week (topic), its seven daily questions, three spares and a weekly poll with four options, straight into the database. */
export async function makeWeek(
  prisma: PrismaService,
  p: {
    weekNumber: number;
    startsOn: string;
    status?: "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "LIVE" | "CLOSED";
    title?: string;
    sensitive?: boolean;
    categoryId?: string;
    poll?: boolean;
  },
) {
  const endsOn = plusDays(p.startsOn, 6);
  const topic = await prisma.topic.create({
    data: {
      weekNumber: p.weekNumber,
      title: p.title ?? `Week ${p.weekNumber} topic`,
      startsOn: dateOf(p.startsOn),
      endsOn: dateOf(endsOn),
      status: p.status ?? "SCHEDULED",
      sensitive: p.sensitive ?? false,
      questionCount: 10,
      whatNextPrompt: "What is one thing that should change?",
    },
  });
  const qs = [];
  for (let slot = 1; slot <= 7; slot++) {
    const day = plusDays(p.startsOn, slot - 1);
    qs.push(
      await prisma.question.create({
        data: {
          topicId: topic.id,
          categoryId: p.categoryId ?? null,
          kind: "DAILY",
          status: "SCHEDULED",
          text: `Week ${p.weekNumber} day ${slot} question`,
          scheduledFor: dateOf(day),
          slotIndex: slot,
          startsAt: lagosStart(day),
          endsAt: lagosStart(plusDays(endsOn, 1)),
          sensitive: p.sensitive ?? false,
        },
      }),
    );
  }
  const spare = [];
  for (let i = 1; i <= 3; i++)
    spare.push(
      await prisma.question.create({
        data: {
          topicId: topic.id,
          kind: "DAILY",
          status: "SCHEDULED",
          text: `Week ${p.weekNumber} spare ${i}`,
          isSpare: true,
        },
      }),
    );
  let poll = null;
  if (p.poll !== false)
    poll = await prisma.poll.create({
      data: {
        topicId: topic.id,
        kind: "WEEKLY",
        title: `Week ${p.weekNumber} poll`,
        status: "SCHEDULED",
        startsAt: lagosStart(p.startsOn),
        endsAt: lagosStart(plusDays(endsOn, 1)),
        options: {
          create: ["One", "Two", "Three", "Four"].map((label, i) => ({
            label,
            sortOrder: i + 1,
          })),
        },
      },
    });
  return { topic, qs, spare, poll };
}

export const uuid = "0190a000-0000-7000-8000-00000000dead";
