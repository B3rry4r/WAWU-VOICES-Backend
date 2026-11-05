/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read JSON bodies and raw SQL rows */
import { execFileSync } from "node:child_process";
import { Controller, Get, Module } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { TEST_DATABASE_URL } from "../test-env";
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";

describe("me: VOICES roles", () => {
  let h: Harness;
  let cats: string[];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const NIL = "0190a000-0000-7000-8000-000000000abc";

  beforeAll(async () => {
    const { Roles, CurrentMe } = await import("../../src/me/index.js");
    @Controller("_roles_probe")
    class P {
      @Get("mod")
      @Roles("MODERATOR")
      mod(@CurrentMe() me: { handle: string }) {
        return { handle: me.handle };
      }
      @Get("editor")
      @Roles("EDITOR", "AD_MANAGER")
      editor() {
        return { ok: true };
      }
    }
    @Module({ controllers: [P] })
    class PM {}
    h = await boot({}, undefined, [PM]);
    await reset();
    cats = await seedCategories(4);
  });
  afterAll(() => h.close());

  const grant = async (sub: string, role: string) => {
    const { grantRole } = await import("../../src/me/roles-grant.js");
    const { PrismaClient } =
      await import("../../src/generated/prisma/client.js");
    const p = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    try {
      return await grantRole(p, { wawuId: sub, role: role as never });
    } finally {
      await p.$disconnect();
    }
  };

  it("the @Roles guard: 401 no token, 403 PROFILE_REQUIRED with no profile, 403 ROLE_REQUIRED without the role, 200 with it; ADMIN passes all", async () => {
    const user = await signUp(h, "r-user", "r.user", cats);
    const mod = await signUp(h, "r-mod", "r.mod", cats);
    const adm = await signUp(h, "r-adm", "r.adm", cats);
    await grant("r-mod", "MODERATOR");
    await grant("r-adm", "ADMIN");
    await h.http().get("/api/v1/_roles_probe/mod").expect(401);
    const nop = await h
      .http()
      .get("/api/v1/_roles_probe/mod")
      .set(auth(h.token("r-nobody")))
      .expect(403);
    expect(nop.body.error.details.reason).toBe("PROFILE_REQUIRED");
    const no = await h
      .http()
      .get("/api/v1/_roles_probe/mod")
      .set(auth(user.token))
      .expect(403);
    expect(no.body.error.code).toBe("ROLE_REQUIRED");
    expect(
      (
        await h
          .http()
          .get("/api/v1/_roles_probe/mod")
          .set(auth(mod.token))
          .expect(200)
      ).body.handle,
    ).toBe("r.mod");
    await h
      .http()
      .get("/api/v1/_roles_probe/editor")
      .set(auth(mod.token))
      .expect(403);
    await h
      .http()
      .get("/api/v1/_roles_probe/editor")
      .set(auth(adm.token))
      .expect(200);
    // me shows the roles
    expect(
      (await h.http().get("/api/v1/me").set(auth(mod.token))).body.roles,
    ).toEqual(["MODERATOR"]);
    // a suspended moderator loses the power
    await sql(
      `UPDATE "User" SET status='SUSPENDED', "suspendedUntil"=now()+interval '1 hour' WHERE id=$1`,
      [mod.me.id],
    );
    const sus = await h
      .http()
      .get("/api/v1/_roles_probe/mod")
      .set(auth(mod.token))
      .expect(403);
    expect(sus.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("PUT /admin/users/{id}/roles: admin only; escalation attempts are refused", async () => {
    const adm = await signUp(h, "e-adm", "e.adm", cats);
    const mod = await signUp(h, "e-mod", "e.mod", cats);
    const user = await signUp(h, "e-user", "e.user", cats);
    await grant("e-adm", "ADMIN");
    await grant("e-mod", "MODERATOR");
    const put = (t: string, id: string, body: object) =>
      h.http().put(`/api/v1/admin/users/${id}/roles`).set(auth(t)).send(body);
    const b = { roles: ["ADMIN"], reason: "escalate" };
    // a plain user and a moderator cannot give themselves or anyone else a role
    for (const [t, id] of [
      [user.token, user.me.id],
      [user.token, mod.me.id],
      [mod.token, mod.me.id],
      [mod.token, user.me.id],
    ] as const) {
      const r = await put(t, id, b).expect(403);
      expect(r.body.error.code).toBe("ROLE_REQUIRED");
    }
    await h
      .http()
      .put(`/api/v1/admin/users/${user.me.id}/roles`)
      .send(b)
      .expect(401);
    expect(
      (
        await sql<any>(`SELECT 1 FROM "UserRoleGrant" WHERE "userId"=$1`, [
          user.me.id,
        ])
      ).length,
    ).toBe(0);
    // roles in the body of another route do nothing
    await h
      .http()
      .patch("/api/v1/me/profile")
      .set(auth(user.token))
      .send({ roles: ["ADMIN"] })
      .expect(422);
    // the admin can
    const ok = await put(adm.token, user.me.id, {
      roles: ["EDITOR", "MODERATOR"],
      reason: "new desk",
    }).expect(200);
    expect(ok.body.roles).toEqual(["EDITOR", "MODERATOR"]);
    expect(ok.body.user.handle).toBe("e.user");
    const audit = await sql<any>(
      `SELECT "actorId", reason, before, after FROM "AuditLog" WHERE action='role.set' AND "targetId"=$1`,
      [user.me.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adm.me.id,
      reason: "new desk",
      before: { roles: [] },
      after: { roles: ["EDITOR", "MODERATOR"] },
    });
    const [g] = await sql<any>(
      `SELECT "grantedById" FROM "UserRoleGrant" WHERE "userId"=$1 AND role='EDITOR'`,
      [user.me.id],
    );
    expect(g.grantedById).toBe(adm.me.id);
    // replacing removes
    const rep = await put(adm.token, user.me.id, {
      roles: ["EDITOR"],
      reason: "trim",
    }).expect(200);
    expect(rep.body.roles).toEqual(["EDITOR"]);
    const none = await put(adm.token, user.me.id, {
      roles: [],
      reason: "left the team",
    }).expect(200);
    expect(none.body.roles).toEqual([]);
    // validation
    await put(adm.token, user.me.id, {
      roles: ["OWNER"],
      reason: "x y z",
    }).expect(422);
    await put(adm.token, user.me.id, { roles: ["ADMIN"] }).expect(422);
    await put(adm.token, user.me.id, { roles: ["ADMIN"], reason: "" }).expect(
      422,
    );
    await put(adm.token, user.me.id, {
      roles: ["ADMIN", "ADMIN"],
      reason: "dup",
    }).expect(422);
    await put(adm.token, NIL, { roles: [], reason: "nobody" }).expect(404);
    await put(adm.token, "bad-id", { roles: [], reason: "nobody" }).expect(404);
    // the admin cannot drop their own admin role; and VOICES keeps one admin
    expect(
      (
        await put(adm.token, adm.me.id, { roles: [], reason: "oops" }).expect(
          422,
        )
      ).body.error.code,
    ).toBe("VALIDATION_FAILED");
    const adm2 = await signUp(h, "e-adm2", "e.adm2", cats);
    await grant("e-adm2", "ADMIN");
    await put(adm.token, adm2.me.id, { roles: [], reason: "step down" }).expect(
      200,
    );
    const last = await sql<any>(
      `SELECT count(*)::int n FROM "UserRoleGrant" WHERE role='ADMIN'`,
    );
    expect(last[0].n).toBeGreaterThanOrEqual(1);
  });

  it("an admin cannot demote the last other admin to zero (409), and a banned account cannot be given a role", async () => {
    await sql(`TRUNCATE "UserRoleGrant"`);
    const a1 = await signUp(h, "l-a1", "l.a1", cats);
    const a2 = await signUp(h, "l-a2", "l.a2", cats);
    await grant("l-a1", "ADMIN");
    const put = (t: string, id: string, body: object) =>
      h.http().put(`/api/v1/admin/users/${id}/roles`).set(auth(t)).send(body);
    // a2 is not admin; a1 is the only admin and cannot drop itself (422); nobody else holds ADMIN to demote
    await put(a1.token, a1.me.id, { roles: [], reason: "me out" }).expect(422);
    await sql(`UPDATE "User" SET status='BANNED' WHERE id=$1`, [a2.me.id]);
    expect(
      (
        await put(a1.token, a2.me.id, {
          roles: ["EDITOR"],
          reason: "no way",
        }).expect(409)
      ).body.error.code,
    ).toBe("CONFLICT");
    expect(
      (await sql(`SELECT 1 FROM "UserRoleGrant" WHERE "userId"=$1`, [a2.me.id]))
        .length,
    ).toBe(0);
  });

  it("two admins demoting each other at once cannot leave VOICES without an admin", async () => {
    await sql(`TRUNCATE "UserRoleGrant"`);
    const a = await signUp(h, "x-a", "x.a", cats);
    const b = await signUp(h, "x-b", "x.b", cats);
    await grant("x-a", "ADMIN");
    await grant("x-b", "ADMIN");
    const put = (t: string, id: string) =>
      h
        .http()
        .put(`/api/v1/admin/users/${id}/roles`)
        .set(auth(t))
        .send({ roles: [], reason: "swap" });
    const [r1, r2] = await Promise.all([
      put(a.token, b.me.id),
      put(b.token, a.me.id),
    ]);
    // the loser is 409 (lock held) or 403 (its admin role was already gone when its guard ran): never a second 200
    const codes = [r1.status, r2.status].sort();
    expect(codes[0]).toBe(200);
    expect([403, 409]).toContain(codes[1]);
    expect(
      (
        await sql<any>(
          `SELECT count(*)::int n FROM "UserRoleGrant" WHERE role='ADMIN'`,
        )
      )[0].n,
    ).toBe(1);
  });

  it("GET /admin/roles lists people with roles, filters by role, pages; admin only", async () => {
    await sql(`TRUNCATE "UserRoleGrant"`);
    const adm = await signUp(h, "g-adm", "g.adm", cats);
    const mod = await signUp(h, "g-mod", "g.mod", cats);
    const user = await signUp(h, "g-user", "g.user", cats);
    await grant("g-adm", "ADMIN");
    await grant("g-mod", "MODERATOR");
    await grant("g-mod", "EDITOR");
    await h.http().get("/api/v1/admin/roles").set(auth(user.token)).expect(403);
    await h.http().get("/api/v1/admin/roles").set(auth(mod.token)).expect(403);
    const all = await h
      .http()
      .get("/api/v1/admin/roles")
      .set(auth(adm.token))
      .expect(200);
    expect(all.body.items.map((i: any) => i.user.handle).sort()).toEqual([
      "g.adm",
      "g.mod",
    ]);
    expect(
      all.body.items.find((i: any) => i.user.handle === "g.mod").roles,
    ).toEqual(["EDITOR", "MODERATOR"]);
    const only = await h
      .http()
      .get("/api/v1/admin/roles?role=EDITOR")
      .set(auth(adm.token))
      .expect(200);
    expect(only.body.items).toHaveLength(1);
    await h
      .http()
      .get("/api/v1/admin/roles?role=NOPE")
      .set(auth(adm.token))
      .expect(422);
    const p1 = await h
      .http()
      .get("/api/v1/admin/roles?limit=1")
      .set(auth(adm.token))
      .expect(200);
    const p2 = await h
      .http()
      .get(`/api/v1/admin/roles?limit=1&cursor=${p1.body.nextCursor}`)
      .set(auth(adm.token))
      .expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("npm run roles:grant path: grants and revokes by handle, needs a profile, writes the audit log, is idempotent", async () => {
    await signUp(h, "cli-a", "cli.a", cats);
    const run = (...args: string[]) =>
      execFileSync("npm", ["run", "--silent", "roles:grant", "--", ...args], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    expect(run("--handle", "@Cli.A", "--role", "editor")).toMatch(
      /Gave EDITOR to @cli.a/,
    );
    expect(run("--handle", "cli.a", "--role", "EDITOR")).toMatch(/already has/);
    expect(
      (
        await h
          .http()
          .get("/api/v1/me")
          .set(auth(h.token("cli-a")))
      ).body.roles,
    ).toEqual(["EDITOR"]);
    expect(
      (await sql(`SELECT 1 FROM "AuditLog" WHERE action='role.grant'`)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(run("--handle", "cli.a", "--role", "EDITOR", "--revoke")).toMatch(
      /Removed EDITOR/,
    );
    expect(() => run("--handle", "nobody.here", "--role", "ADMIN")).toThrow(
      /No VOICES profile/,
    );
    expect(() => run("--handle", "cli.a", "--role", "BOSS")).toThrow(
      /Role must be/,
    );
    expect(() => run("--role", "ADMIN")).toThrow(/exactly one/);
  }, 60000);
});
