/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import {
  bootAdmin,
  modItem,
  report,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "./helpers";

describe("admin: moderation and people", () => {
  let a: Admin;
  let q: string;
  const url = "/api/v1/admin/moderation/items";

  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("mod2", ["MODERATOR"]);
    await a.person("editor", ["EDITOR"]);
    await a.person("user");
    await a.person("poster");
    await a.person("r1");
    await a.person("r2");
    q = (await seedQuestion(a)).id;
  });
  afterAll(() => a.close());

  it("auth: 401 with no token, 403 PROFILE_REQUIRED, 403 ROLE_REQUIRED for a member and for an editor", async () => {
    await a.h.http().get(url).expect(401);
    const nop = await a.h
      .http()
      .get(url)
      .set({ Authorization: `Bearer ${a.h.token("a7b-nobody")}` })
      .expect(403);
    expect(nop.body.error.details.reason).toBe("PROFILE_REQUIRED");
    for (const n of ["user", "editor"]) {
      const r = await a.h.http().get(url).set(a.auth(n)).expect(403);
      expect(r.body.error.code).toBe("ROLE_REQUIRED");
    }
    await a.h.http().get(url).set(a.auth("mod")).expect(200);
    await a.h.http().get(url).set(a.auth("admin")).expect(200);
  });

  it("lists by queue with counts, rejects a bad queue with 422", async () => {
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    await report(a, a.people.r2.id, "ANSWER", ans.id, "HATE_OR_HARASSMENT");
    await modItem(a, "ANSWER", ans.id, "REPORTED", 2);
    const sens = await seedAnswer(a, q, a.people.poster.id, {
      body: "politics",
    });
    await modItem(a, "ANSWER", sens.id, "SENSITIVE", 0);
    const all = await a.h.http().get(url).set(a.auth("mod")).expect(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.counts).toMatchObject({
      REPORTED: 1,
      SENSITIVE: 1,
      SCREENED: 0,
      open: 2,
    });
    expect(all.body.counts.oldestOpenAt).toEqual(expect.any(String));
    const rep = await a.h
      .http()
      .get(`${url}?queue=REPORTED`)
      .set(a.auth("mod"))
      .expect(200);
    expect(rep.body.items).toHaveLength(1);
    expect(rep.body.items[0]).toMatchObject({
      queue: "REPORTED",
      reportCount: 2,
      status: "OPEN",
      targetType: "ANSWER",
    });
    expect(rep.body.items[0].summary).toBe("Reported 2 times · text");
    const bad = await a.h
      .http()
      .get(`${url}?queue=NOPE`)
      .set(a.auth("mod"))
      .expect(422);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    const paged = await a.h
      .http()
      .get(`${url}?limit=1`)
      .set(a.auth("mod"))
      .expect(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.nextCursor).toEqual(expect.any(String));
    const next = await a.h
      .http()
      .get(`${url}?limit=1&cursor=${paged.body.nextCursor}`)
      .set(a.auth("mod"))
      .expect(200);
    expect(next.body.items[0].id).not.toBe(paged.body.items[0].id);
  });

  it("detail: author, transcript, signed listen link, screening, audit trail; 404 for an unknown item", async () => {
    const clip = await a.prisma.voiceClip.create({
      data: {
        ownerId: a.people.poster.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/1",
        rawMime: "audio/webm",
        playKey: "play/1",
        playMime: "audio/mp4",
        durationMs: 14000,
        maxDurationMs: 30000,
      },
    });
    await a.prisma.transcript.create({
      data: { clipId: clip.id, status: "READY", text: "a spoken threat" },
    });
    const ans = await seedAnswer(a, q, a.people.poster.id, {
      kind: "VOICE",
      body: null,
      clipId: clip.id,
      listenCount: 220,
      screening: ["possible threat"],
    });
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    const r = await a.h
      .http()
      .get(`${url}/${item.id}`)
      .set(a.auth("mod"))
      .expect(200);
    expect(r.body.listenCount).toBe(220);
    expect(r.body.transcript).toBe("a spoken threat");
    expect(r.body.playUrl).toBe("https://signed.test/play/1");
    expect(r.body.screening).toEqual(["possible threat"]);
    expect(r.body.author).toMatchObject({
      handle: "a7b.poster",
      strikeCount: 0,
    });
    expect(r.body.item.summary).toBe(
      "Reported 1 time · voice 0:14 · 220 listens",
    );
    expect(r.body.context.text).toBe("Q?");
    expect(r.body.audit[0].text).toContain("reported by 1 person");
    await a.h
      .http()
      .get(`${url}/0190a000-0000-7000-8000-000000000abc`)
      .set(a.auth("mod"))
      .expect(404);
    await a.h.http().get(`${url}/not-a-uuid`).set(a.auth("mod")).expect(404);
  });

  it("action: reason required; REMOVE hides the post, keeps counters in step, notifies, logs; a second action is 409; RESTORE brings it back", async () => {
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id);
    const before = (
      await a.prisma.question.findUniqueOrThrow({ where: { id: q } })
    ).answerCount;
    const noReason = await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "  " })
      .expect(422);
    expect(noReason.body.error.code).toBe("VALIDATION_FAILED");
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "MAYBE", reason: "x" })
      .expect(422);
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("user"))
      .send({ action: "REMOVE", reason: "x" })
      .expect(403);
    const ok = await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "Threat of violence." })
      .expect(200);
    expect(ok.body.item.status).toBe("RESOLVED");
    expect(
      ok.body.audit.some((l: any) => l.text.includes("Threat of violence.")),
    ).toBe(true);
    expect(
      (await a.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
        .status,
    ).toBe("REMOVED");
    expect(
      (await a.prisma.question.findUniqueOrThrow({ where: { id: q } }))
        .answerCount,
    ).toBe(before - 1);
    expect(
      (await a.prisma.report.findFirstOrThrow({ where: { targetId: ans.id } }))
        .status,
    ).toBe("ACTIONED");
    const note = await a.prisma.notification.findFirstOrThrow({
      where: { userId: a.people.poster.id, targetId: ans.id },
    });
    expect(note).toMatchObject({
      type: "MODERATION_NOTICE",
      body: "Threat of violence.",
    });
    const log = await a.prisma.auditLog.findFirstOrThrow({
      where: { action: "moderation.action", targetId: ans.id },
    });
    expect(log).toMatchObject({
      actorId: a.people.mod.id,
      reason: "Threat of violence.",
    });
    expect((log.after as any).contentStatus).toBe("REMOVED");
    const again = await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "again" })
      .expect(409);
    expect(again.body.error.code).toBe("CONFLICT");
    expect(
      (await a.prisma.question.findUniqueOrThrow({ where: { id: q } }))
        .answerCount,
    ).toBe(before - 1);
    await a.h
      .http()
      .post(`${url}/${item.id}/action`)
      .set(a.auth("admin"))
      .send({ action: "RESTORE", reason: "Appeal accepted." })
      .expect(200);
    expect(
      (await a.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
        .status,
    ).toBe("PUBLISHED");
    expect(
      (await a.prisma.question.findUniqueOrThrow({ where: { id: q } }))
        .answerCount,
    ).toBe(before);
  });

  it("two moderators acting on one item at once: one wins, the other gets 409, one action row", async () => {
    const ans = await seedAnswer(a, q, a.people.poster.id);
    const item = await modItem(a, "ANSWER", ans.id);
    const go = (who: string) =>
      a.h
        .http()
        .post(`${url}/${item.id}/action`)
        .set(a.auth(who))
        .send({ action: "REMOVE_AND_WARN", reason: "Harassment." });
    const res = await Promise.all([go("mod"), go("mod2")]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await a.prisma.moderationAction.count({ where: { itemId: item.id } }),
    ).toBe(1);
    expect(
      await a.prisma.strike.count({ where: { userId: a.people.poster.id } }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("WARN adds a strike and leaves the post up; SUSPEND on the post's author blocks their writes; KEEP releases nothing it should not", async () => {
    const warnTarget = await seedAnswer(a, q, a.people.r2.id);
    const w = await modItem(a, "ANSWER", warnTarget.id);
    await a.h
      .http()
      .post(`${url}/${w.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "WARN", reason: "Be civil." })
      .expect(200);
    expect(
      (
        await a.prisma.answer.findUniqueOrThrow({
          where: { id: warnTarget.id },
        })
      ).status,
    ).toBe("PUBLISHED");
    expect(
      await a.prisma.strike.count({ where: { userId: a.people.r2.id } }),
    ).toBe(1);

    const keepTarget = await seedAnswer(a, q, a.people.r2.id);
    await report(a, a.people.r1.id, "ANSWER", keepTarget.id);
    const k = await modItem(a, "ANSWER", keepTarget.id);
    await a.h
      .http()
      .post(`${url}/${k.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "KEEP", reason: "Strong opinion, not a threat." })
      .expect(200);
    expect(
      (
        await a.prisma.report.findFirstOrThrow({
          where: { targetId: keepTarget.id },
        })
      ).status,
    ).toBe("DISMISSED");
    expect(
      (
        await a.prisma.answer.findUniqueOrThrow({
          where: { id: keepTarget.id },
        })
      ).status,
    ).toBe("PUBLISHED");

    await a.h.http().post("/api/v1/_write_probe").set(a.auth("r2")).expect(201);
    const sTarget = await seedAnswer(a, q, a.people.r2.id);
    const s = await modItem(a, "ANSWER", sTarget.id);
    await a.h
      .http()
      .post(`${url}/${s.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "SUSPEND", reason: "Repeat harassment." })
      .expect(200);
    const u = await a.prisma.user.findUniqueOrThrow({
      where: { id: a.people.r2.id },
    });
    expect(u.status).toBe("SUSPENDED");
    expect(u.suspendedUntil!.getTime()).toBeGreaterThan(
      Date.now() + 6 * 86400_000,
    );
    const blocked = await a.h
      .http()
      .post("/api/v1/_write_probe")
      .set(a.auth("r2"))
      .expect(403);
    expect(blocked.body.error.code).toBe("ACCOUNT_SUSPENDED");
    await a.h.http().get("/api/v1/_write_probe").set(a.auth("r2")).expect(200);
  });

  it("a moderator cannot suspend staff or themselves; an appeal decision tells the appellant", async () => {
    const t = await seedAnswer(a, q, a.people.mod2.id);
    const i = await modItem(a, "ANSWER", t.id);
    const r = await a.h
      .http()
      .post(`${url}/${i.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "SUSPEND", reason: "x" })
      .expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
    const own = await seedAnswer(a, q, a.people.mod.id);
    const oi = await modItem(a, "ANSWER", own.id);
    await a.h
      .http()
      .post(`${url}/${oi.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "WARN", reason: "x" })
      .expect(403);

    const removed = await seedAnswer(a, q, a.people.user.id, {
      status: "REMOVED",
    });
    const ap = await a.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: removed.id,
        queue: "APPEAL",
        reasons: ["APPEAL"],
        reportCount: 1,
      },
    });
    await a.prisma.appeal.create({
      data: {
        userId: a.people.user.id,
        targetType: "ANSWER",
        targetId: removed.id,
        note: "It was a joke",
        itemId: ap.id,
      },
    });
    await a.h
      .http()
      .post(`${url}/${ap.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "RESTORE", reason: "Fair, it was a joke." })
      .expect(200);
    expect(
      (
        await a.prisma.appeal.findFirstOrThrow({
          where: { targetId: removed.id },
        })
      ).status,
    ).toBe("DECIDED");
    const n = await a.prisma.notification.findFirstOrThrow({
      where: { userId: a.people.user.id, targetId: removed.id },
    });
    expect(n.title).toBe("Your appeal was accepted");
  });

  describe("users", () => {
    const base = "/api/v1/admin/users";
    it("find needs q and ADMIN; finds by handle and phone hash; filters status", async () => {
      await a.h.http().get(base).set(a.auth("mod")).expect(403);
      const noq = await a.h.http().get(base).set(a.auth("admin")).expect(422);
      expect(noq.body.error.code).toBe("VALIDATION_FAILED");
      const r = await a.h
        .http()
        .get(`${base}?q=@A7B.poster`)
        .set(a.auth("admin"))
        .expect(200);
      expect(r.body.items).toHaveLength(1);
      expect(r.body.items[0]).toMatchObject({
        status: "ACTIVE",
        roles: [],
        strikes: expect.any(Number),
      });
      expect(r.body.items[0].profile.handle).toBe("a7b.poster");
      const row = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.poster.id },
      });
      const byHash = await a.h
        .http()
        .get(`${base}?q=${row.phoneHash}`)
        .set(a.auth("admin"))
        .expect(200);
      expect(byHash.body.items.map((i: any) => i.profile.id)).toEqual([
        a.people.poster.id,
      ]);
      const sus = await a.h
        .http()
        .get(`${base}?q=a7b&status=SUSPENDED`)
        .set(a.auth("admin"))
        .expect(200);
      expect(sus.body.items.every((i: any) => i.status === "SUSPENDED")).toBe(
        true,
      );
    });

    it("suspend and restore: audit, notice, blocks writes everywhere, restore lifts it; validation and conflicts", async () => {
      const id = a.people.user.id;
      const past = await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("mod"))
        .send({ until: "2020-01-01T00:00:00Z", reason: "x", ban: false })
        .expect(422);
      expect(past.body.error.details.fields[0].path).toBe("until");
      await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("mod"))
        .send({ until: null, ban: false })
        .expect(422);
      const until = new Date(Date.now() + 3 * 86400_000).toISOString();
      const r = await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("mod"))
        .send({ until, reason: "Spam.", ban: false })
        .expect(200);
      expect(r.body.status).toBe("SUSPENDED");
      const blocked = await a.h
        .http()
        .post("/api/v1/_write_probe")
        .set(a.auth("user"))
        .expect(403);
      expect(blocked.body.error.code).toBe("ACCOUNT_SUSPENDED");
      expect(blocked.body.error.details.until).toBe(until);
      expect(
        await a.prisma.auditLog.count({
          where: {
            action: "user.suspend",
            targetId: id,
            actorId: a.people.mod.id,
            reason: "Spam.",
          },
        }),
      ).toBe(1);
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("mod"))
        .send({ reason: "Served it." })
        .expect(200);
      await a.h
        .http()
        .post("/api/v1/_write_probe")
        .set(a.auth("user"))
        .expect(201);
      const again = await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("mod"))
        .send({ reason: "x" })
        .expect(409);
      expect(again.body.error.code).toBe("CONFLICT");
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("mod"))
        .send({})
        .expect(422);
      await a.h
        .http()
        .post(`${base}/0190a000-0000-7000-8000-000000000abc/suspend`)
        .set(a.auth("mod"))
        .send({ until: null, reason: "x", ban: true })
        .expect(404);
      await a.h
        .http()
        .post(`${base}/${a.people.mod2.id}/suspend`)
        .set(a.auth("mod"))
        .send({ until: null, reason: "x", ban: true })
        .expect(403);
      await a.h
        .http()
        .post(`${base}/${a.people.mod.id}/suspend`)
        .set(a.auth("admin"))
        .send({ until: null, reason: "x", ban: false })
        .expect(200);
      await a.h
        .http()
        .post(`${base}/${a.people.mod.id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "mistake" })
        .expect(200);
    });

    it("a suspension with no end date lasts moderation.suspend_days (7 by default, config overrides); only a ban is indefinite", async () => {
      const id = a.people.r2.id;
      await a.prisma.user.update({
        where: { id },
        data: { status: "ACTIVE", suspendedUntil: null },
      });
      const r = await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("admin"))
        .send({ until: null, reason: "Spam.", ban: false })
        .expect(200);
      expect(r.body.status).toBe("SUSPENDED");
      const u = await a.prisma.user.findUniqueOrThrow({ where: { id } });
      const days = (u.suspendedUntil!.getTime() - Date.now()) / 86400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "ok" })
        .expect(200);
      await a.prisma.configEntry.upsert({
        where: { key: "moderation.suspend_days" },
        create: { key: "moderation.suspend_days", valueJson: 2 } as never,
        update: { valueJson: 2 },
      });
      await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("admin"))
        .send({ until: null, reason: "Spam.", ban: false })
        .expect(200);
      const u2 = await a.prisma.user.findUniqueOrThrow({ where: { id } });
      expect(
        (u2.suspendedUntil!.getTime() - Date.now()) / 86400_000,
      ).toBeLessThan(2.1);
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "ok" })
        .expect(200);
      await a.prisma.configEntry.delete({
        where: { key: "moderation.suspend_days" },
      });
      await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("admin"))
        .send({ until: null, reason: "Scam.", ban: true })
        .expect(200);
      const b = await a.prisma.user.findUniqueOrThrow({ where: { id } });
      expect(b).toMatchObject({ status: "BANNED", suspendedUntil: null });
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "ok" })
        .expect(200);
    });

    it("ban closes the account; the admin limit of 120 writes a minute answers 429", async () => {
      const id = a.people.r1.id;
      await a.h
        .http()
        .post(`${base}/${id}/suspend`)
        .set(a.auth("admin"))
        .send({ until: null, reason: "Scam.", ban: true })
        .expect(200);
      expect(
        (await a.prisma.user.findUniqueOrThrow({ where: { id } })).status,
      ).toBe("BANNED");
      await a.h
        .http()
        .post(`${base}/${id}/restore`)
        .set(a.auth("admin"))
        .send({ reason: "Cleared." })
        .expect(200);
      let last = 0;
      for (let i = 0; i < 125 && last !== 429; i++)
        last = (
          await a.h
            .http()
            .post(`${base}/${id}/restore`)
            .set(a.auth("admin"))
            .send({ reason: "x" })
        ).status;
      expect(last).toBe(429);
    });
  });
});
