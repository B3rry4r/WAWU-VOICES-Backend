/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import {
  lagosStart,
  lagosToday,
  makeWeek,
  sql,
  world,
  type World,
} from "./harness";
import { phoneHashOf } from "../../src/me";
import { signUp } from "../me/helpers";

/** The Users screen: everyone, newest first, with a count; and the search that Wallets still uses. */
describe("admin users list", () => {
  let w: World;
  const made: { id: string; handle: string }[] = [];

  beforeAll(async () => {
    w = await world();
    // 12 more people, one minute apart, so with the 6 staff there are 18 and a page of 7 makes 3 pages.
    const base = new Date("2026-10-01T10:00:00Z").getTime();
    for (let i = 0; i < 12; i++) {
      const handle = `user.n${String(i).padStart(2, "0")}`;
      const { me } = await signUp(w.h, `ul-${i}`, handle, w.cats, {
        email: `Person.${i}@Example.com`,
      });
      await sql(`UPDATE "User" SET "createdAt" = $2 WHERE id = $1`, [
        me.id,
        new Date(base + i * 60_000),
      ]);
      made.push({ id: me.id as string, handle });
    }
    // every staff member joined before them, on a day long ago
    for (const s of [
      w.admin,
      w.admin2,
      w.editor,
      w.moderator,
      w.adManager,
      w.plain,
    ])
      await sql(`UPDATE "User" SET "createdAt" = $2 WHERE id = $1`, [
        s.id,
        new Date("2026-09-01T10:00:00Z"),
      ]);
  });
  afterAll(async () => {
    await w.close();
  });

  const get = (qs: string, who = w.admin) =>
    w.api("get", `/admin/users${qs}`, who);

  it("lists everyone newest first over 3 pages, no one twice or missing", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await get(`?limit=7${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(18);
      seen.push(...r.body.items.map((i: any) => i.profile.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(18);
    const all: { id: string }[] = await sql(`SELECT id FROM "User"`);
    expect([...seen].sort()).toEqual(all.map((a) => a.id).sort());
    // newest first: the last made person is first
    expect(seen[0]).toBe(made[11].id);
    const r = await get("?limit=50");
    const times = r.body.items.map((i: any) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("gives total, counts, the new fields and the mail address", async () => {
    const r = await get("?limit=50");
    expect(r.body.counts).toMatchObject({
      total: 18,
      today: 0,
      verified: 0,
      byStatus: {
        ACTIVE: 18,
        SUSPENDED: 0,
        BANNED: 0,
        DELETION_PENDING: 0,
        DELETED: 0,
      },
    });
    const row = r.body.items.find((i: any) => i.profile.id === made[3].id);
    expect(row).toMatchObject({
      mailTo: "person.3@example.com",
      displayName: null,
      state: null,
      verified: false,
      postCount: 0,
      hasProfile: false,
      status: "ACTIVE",
    });
    expect(row.profile.handle).toBe("user.n03");
  });

  it("counts posts (answers plus replies not deleted), verified, state and status", async () => {
    const wk = await makeWeek(w.prisma, {
      weekNumber: 1,
      startsOn: lagosToday(),
      status: "LIVE",
    });
    const q = wk.qs[0];
    const p = made[5].id;
    const a1 = await w.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p,
        kind: "TEXT",
        body: "one",
      } as never,
    });
    await w.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p,
        kind: "TEXT",
        body: "two",
        deletedAt: new Date(),
      } as never,
    });
    await w.prisma.reply.create({
      data: {
        answerId: a1.id,
        authorId: p,
        stance: "AGREE",
        kind: "TEXT",
        body: "r1",
      } as never,
    });
    await w.prisma.reply.create({
      data: {
        answerId: a1.id,
        authorId: p,
        stance: "AGREE",
        kind: "TEXT",
        body: "r2",
        deletedAt: new Date(),
      } as never,
    });
    await w.prisma.reply.create({
      data: {
        answerId: a1.id,
        authorId: made[6].id,
        stance: "AGREE",
        kind: "TEXT",
        body: "r3",
      } as never,
    });
    await sql(
      `UPDATE "User" SET "displayName"='Chioma Eze', state='Lagos', "verificationStatus"='APPROVED', "verifiedUntil"=now() + interval '10 days', status='SUSPENDED' WHERE id=$1`,
      [p],
    );
    const r = await get("?limit=50");
    const row = r.body.items.find((i: any) => i.profile.id === p);
    expect(row).toMatchObject({
      postCount: 2,
      displayName: "Chioma Eze",
      state: "Lagos",
      verified: true,
      hasProfile: true,
      status: "SUSPENDED",
    });
    expect(
      r.body.items.find((i: any) => i.profile.id === made[6].id).postCount,
    ).toBe(1);
    expect(r.body.counts.verified).toBe(1);
    expect(r.body.counts.byStatus).toMatchObject({ ACTIVE: 17, SUSPENDED: 1 });
    // the status filter changes total, not counts
    const s = await get("?status=SUSPENDED");
    expect(s.body.total).toBe(1);
    expect(s.body.items).toHaveLength(1);
    expect(s.body.counts.total).toBe(18);
  });

  it("counts joined today by the Lagos midnight", async () => {
    const start = lagosStart(lagosToday());
    const [a, b, c] = [made[0].id, made[1].id, made[2].id];
    await sql(`UPDATE "User" SET "createdAt"=$2 WHERE id=$1`, [
      a,
      new Date(start.getTime() - 1),
    ]);
    await sql(`UPDATE "User" SET "createdAt"=$2 WHERE id=$1`, [b, start]);
    await sql(`UPDATE "User" SET "createdAt"=$2 WHERE id=$1`, [
      c,
      new Date(start.getTime() + 1000),
    ]);
    const r = await get("?limit=1");
    expect(r.body.counts.today).toBe(2);
    expect(r.body.items[0].profile.id).toBe(c);
  });

  it("searches by handle part, display name part, exact address, phone and hash", async () => {
    const ids = (r: any) => r.body.items.map((i: any) => i.profile.id).sort();
    expect(ids(await get("?q=n07"))).toEqual([made[7].id]);
    expect(ids(await get("?q=%40USER.N08"))).toEqual([made[8].id]);
    const byName = await get("?q=chioma");
    expect(ids(byName)).toEqual([made[5].id]);
    expect(byName.body.total).toBe(1);
    expect(ids(await get("?q=PERSON.9%40example.com"))).toEqual([made[9].id]);
    // a part of an address matches nothing
    expect((await get("?q=person.9")).body.items).toEqual([]);
    expect((await get("?q=example.com")).body.items).toEqual([]);
    expect((await get("?q=person.%40example.com")).body.total).toBe(0);
    // phone and phone hash, as before
    const phone = "+2348010000001";
    await sql(`UPDATE "User" SET "phoneHash"=$2 WHERE id=$1`, [
      made[10].id,
      phoneHashOf(phone),
    ]);
    expect(ids(await get(`?q=${encodeURIComponent(phone)}`))).toEqual([
      made[10].id,
    ]);
    expect(ids(await get(`?q=${phoneHashOf(phone)}`))).toEqual([made[10].id]);
    // search keeps the cursor and the status filter
    const page = await get("?q=user.n&limit=5");
    expect(page.body.items).toHaveLength(5);
    expect(page.body.nextCursor).not.toBeNull();
    expect(page.body.total).toBe(12);
    expect((await get("?q=user.n&status=BANNED")).body.total).toBe(0);
    // an empty q is refused, as before
    expect((await get("?q=")).status).toBe(422);
  });

  it("lists a person with no profile details yet", async () => {
    const r = await get("?q=user.n01");
    expect(r.body.items[0]).toMatchObject({
      hasProfile: false,
      displayName: null,
    });
    expect(r.body.items).toHaveLength(1);
  });

  it("is for the ADMIN role only", async () => {
    expect((await w.api("get", "/admin/users", null)).status).toBe(401);
    for (const who of [w.plain, w.editor, w.moderator, w.adManager])
      expect((await get("", who)).status).toBe(403);
    expect((await get("", w.admin2)).status).toBe(200);
  });

  it("does not put the mail address in suspend or restore answers", async () => {
    const id = made[4].id;
    const s = await w.api("post", `/admin/users/${id}/suspend`, w.moderator, {
      until: null,
      reason: "Test",
      ban: false,
    });
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toContain("example.com");
    expect("mailTo" in s.body).toBe(false);
    const r = await w.api("post", `/admin/users/${id}/restore`, w.moderator, {
      reason: "Test",
    });
    expect(r.status).toBe(200);
    expect("mailTo" in r.body).toBe(false);
  });
  it("an at-sign alone, a percent sign and an underscore match no one by accident", async () => {
    for (const q of ["%40", "%25", "_"]) {
      const r = await get(`?q=${q}`);
      expect(r.status).toBe(200);
      expect(r.body.items).toEqual([]);
      expect(r.body.total).toBe(0);
    }
  });
});
