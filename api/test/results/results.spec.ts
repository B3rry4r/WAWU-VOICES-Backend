/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- supertest bodies and caught errors are untyped; these specs assert on them directly */
import { randomUUID } from "node:crypto";
import { boot, uid } from "./harness";

type H = Awaited<ReturnType<typeof boot>>;

const SHEET = {
  state: "Lagos",
  lga: "Ikeja",
  ward: "Ward 3",
  pollingUnit: "PU 014",
  accredited: 412,
  votesCast: 398,
  rejected: 9,
};

describe("results (V-7, V-8)", () => {
  let h: H;
  let thread: string;
  let closed: string;
  let scheduled: string;
  const people: Record<string, { sub: string; id: string }> = {};

  async function person(name: string, extra: Record<string, unknown> = {}) {
    const sub = uid(`wawu-${name}`);
    const u = await h.prisma.user.create({
      data: {
        wawuId: sub,
        handle: uid(name)
          .slice(0, 20)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "."),
        referralCode: uid("ref"),
        ...extra,
      },
    });
    people[name] = { sub, id: u.id };
    return people[name];
  }

  beforeAll(async () => {
    h = await boot();
    await h.prisma.$executeRawUnsafe(
      `TRUNCATE "ResultPost","ResultThread","ConfigEntry","IdempotencyRecord" CASCADE`,
    );
    const mk = (
      title: string,
      status: "OPEN" | "CLOSED" | "SCHEDULED",
      day: string,
    ) =>
      h.prisma.resultThread.create({
        data: {
          title,
          heldOn: new Date(`${day}T00:00:00Z`),
          status,
          createdById: "seed",
        },
      });
    thread = (
      await mk("Election Week: Your Vote, Your Voice", "OPEN", "2027-01-16")
    ).id;
    closed = (await mk("Old thread", "CLOSED", "2026-12-01")).id;
    scheduled = (await mk("Later", "SCHEDULED", "2027-02-01")).id;
    await person("ada");
    await person("bola");
    await person("editor");
    await h.prisma.userRoleGrant.create({
      data: {
        userId: people.editor.id,
        role: "EDITOR",
        grantedById: people.editor.id,
      },
    });
    await person("mod");
    await h.prisma.userRoleGrant.create({
      data: {
        userId: people.mod.id,
        role: "MODERATOR",
        grantedById: people.editor.id,
      },
    });
  });

  afterAll(async () => {
    await h.close();
  });

  const post = (
    who: string,
    body: object = SHEET,
    key: string = randomUUID(),
    t?: string,
  ) =>
    h
      .http()
      .post(`/api/v1/result-threads/${t ?? thread}/posts`)
      .set("Authorization", h.bearer(people[who].sub))
      .set("Idempotency-Key", key)
      .send(body);

  it("lists threads for a guest, hides a scheduled one, and 404s it by id", async () => {
    const res = await h.http().get("/api/v1/result-threads").expect(200);
    const ids = (res.body.items as { id: string }[]).map((t) => t.id);
    expect(ids).toEqual([thread, closed]); // newest heldOn first
    expect(ids).not.toContain(scheduled);
    const open = await h
      .http()
      .get("/api/v1/result-threads?status=OPEN")
      .expect(200);
    expect(open.body.items).toHaveLength(1);
    expect(open.body.nextCursor).toBeNull();
    await h.http().get(`/api/v1/result-threads/${scheduled}`).expect(404);
    await h.http().get(`/api/v1/result-threads/${randomUUID()}`).expect(404);
    const one = await h
      .http()
      .get(`/api/v1/result-threads/${thread}`)
      .expect(200);
    expect(one.body).toMatchObject({
      id: thread,
      heldOn: "2027-01-16",
      status: "OPEN",
      postCount: 0,
    });
  });

  it("paginates threads with an opaque cursor", async () => {
    const a = await h.http().get("/api/v1/result-threads?limit=1").expect(200);
    expect(a.body.items).toHaveLength(1);
    expect(typeof a.body.nextCursor).toBe("string");
    const b = await h
      .http()
      .get(`/api/v1/result-threads?limit=1&cursor=${a.body.nextCursor}`)
      .expect(200);
    expect(b.body.items[0].id).toBe(closed);
    expect(b.body.nextCursor).toBeNull();
    await h.http().get("/api/v1/result-threads?cursor=garbage").expect(400);
    await h.http().get("/api/v1/result-threads?limit=0").expect(422);
  });

  describe("posting", () => {
    it("401 for a guest, 403 PROFILE_REQUIRED without a profile", async () => {
      await h
        .http()
        .post(`/api/v1/result-threads/${thread}/posts`)
        .set("Idempotency-Key", randomUUID())
        .send(SHEET)
        .expect(401);
      const res = await h
        .http()
        .post(`/api/v1/result-threads/${thread}/posts`)
        .set("Authorization", h.bearer("nobody-with-no-profile"))
        .set("Idempotency-Key", randomUUID())
        .send(SHEET)
        .expect(403);
      expect(res.body.error.details.reason).toBe("PROFILE_REQUIRED");
    });

    it("400 IDEMPOTENCY_KEY_REQUIRED without the header", async () => {
      const res = await h
        .http()
        .post(`/api/v1/result-threads/${thread}/posts`)
        .set("Authorization", h.bearer(people.ada.sub))
        .send(SHEET)
        .expect(400);
      expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("is free: creates a Not verified row, uses no free post, no units, no ledger", async () => {
      await h.prisma.freeAllowance.create({ data: { userId: people.ada.id } });
      const ledgerBefore = await h.prisma.ledgerTransaction.count();
      const res = await post("ada").expect(201);
      expect(res.body).toMatchObject({
        threadId: thread,
        state: "Lagos",
        accredited: 412,
        votesCast: 398,
        rejected: 9,
        status: "NOT_VERIFIED",
        label: "Not verified",
        checkedAt: null,
        isMine: true,
      });
      expect(res.body.author.handle).toBe(
        (
          await h.prisma.user.findUniqueOrThrow({
            where: { id: people.ada.id },
          })
        ).handle,
      );
      const row = await h.prisma.resultPost.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row).toMatchObject({
        authorId: people.ada.id,
        status: "NOT_VERIFIED",
        accredited: 412,
        checkedById: null,
      });
      const allowance = await h.prisma.freeAllowance.findUniqueOrThrow({
        where: { userId: people.ada.id },
      });
      expect(allowance).toMatchObject({
        freePostsRemaining: 10,
        freePostsUsed: 0,
      });
      expect(await h.prisma.ledgerTransaction.count()).toBe(ledgerBefore);
    });

    it("replays the same key and body; the same key with another body is 409", async () => {
      const key = randomUUID();
      const body = { ...SHEET, pollingUnit: "PU 200" };
      const first = await post("bola", body, key).expect(201);
      const again = await post("bola", body, key).expect(201);
      expect(again.headers["idempotent-replay"]).toBe("true");
      expect(again.body.id).toBe(first.body.id);
      expect(
        await h.prisma.resultPost.count({
          where: { authorId: people.bola.id, pollingUnit: "PU 200" },
        }),
      ).toBe(1);
      const other = await post("bola", { ...body, rejected: 1 }, key).expect(
        409,
      );
      expect(other.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("422 for totals that cannot be true, a missing field, an unknown field, and a photo that is not mine", async () => {
      const more = await post("ada", {
        ...SHEET,
        pollingUnit: "PU 9",
        votesCast: 500,
      }).expect(422);
      expect(more.body.error.code).toBe("VALIDATION_FAILED");
      expect(more.body.error.details.fields[0].path).toBe("votesCast");
      const rej = await post("ada", {
        ...SHEET,
        pollingUnit: "PU 9",
        rejected: 399,
      }).expect(422);
      expect(rej.body.error.details.fields[0].path).toBe("rejected");
      await post("ada", { ...SHEET, accredited: -1 }).expect(422);
      await post("ada", { ...SHEET, accredited: 1.5 }).expect(422);
      const noWard: Record<string, unknown> = { ...SHEET };
      delete noWard.ward;
      await post("ada", noWard).expect(422);
      await post("ada", { ...SHEET, extra: 1 }).expect(422);
      const theirs = await h.prisma.storedFile.create({
        data: {
          ownerId: people.bola.id,
          kind: "RESULT_PHOTO",
          key: `results/${randomUUID()}.jpg`,
          mime: "image/jpeg",
        },
      });
      const stolen = await post("ada", {
        ...SHEET,
        pollingUnit: "PU 9",
        photoFileId: theirs.id,
      }).expect(422);
      expect(stolen.body.error.details.fields[0].path).toBe("photoFileId");
      const avatar = await h.prisma.storedFile.create({
        data: {
          ownerId: people.ada.id,
          kind: "AVATAR",
          key: `avatars/${randomUUID()}.jpg`,
          mime: "image/jpeg",
        },
      });
      await post("ada", {
        ...SHEET,
        pollingUnit: "PU 9",
        photoFileId: avatar.id,
      }).expect(422);
    });

    it("404 unknown or scheduled thread, 409 closed thread, 409 same polling unit twice", async () => {
      await post("ada", SHEET, randomUUID(), randomUUID()).expect(404);
      await post("ada", SHEET, randomUUID(), scheduled).expect(404);
      const c = await post("ada", SHEET, randomUUID(), closed).expect(409);
      expect(c.body.error.details.reason).toBe("THREAD_CLOSED");
      const dupe = await post("ada", {
        ...SHEET,
        pollingUnit: "pu 014",
      }).expect(409);
      expect(dupe.body.error.details.reason).toBe("ALREADY_POSTED");
    });

    it("403 ACCOUNT_SUSPENDED for a suspended account, but they can still read", async () => {
      const s = await person("sus", {
        status: "SUSPENDED",
        suspendedUntil: new Date(Date.now() + 86_400_000),
      });
      const res = await post("sus").expect(403);
      expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");
      await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts`)
        .set("Authorization", h.bearer(s.sub))
        .expect(200);
    });

    it("429 RATE_LIMITED past the configured limit, with Retry-After", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.result_post_per_10min" },
        create: { key: "ratelimit.result_post_per_10min", valueJson: 2 },
        update: { valueJson: 2 },
      });
      await person("fast");
      await post("fast", { ...SHEET, pollingUnit: "F1" }).expect(201);
      await post("fast", { ...SHEET, pollingUnit: "F2" }).expect(201);
      const res = await post("fast", { ...SHEET, pollingUnit: "F3" }).expect(
        429,
      );
      expect(res.body.error.code).toBe("RATE_LIMITED");
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(
        await h.prisma.resultPost.count({
          where: { authorId: people.fast.id },
        }),
      ).toBe(2);
      await h.prisma.configEntry.delete({
        where: { key: "ratelimit.result_post_per_10min" },
      });
    });
  });

  describe("reading and deleting", () => {
    it("lists posts newest first with the label, filters, and never returns a photo", async () => {
      const photo = await h.prisma.storedFile.create({
        data: {
          ownerId: people.bola.id,
          kind: "RESULT_PHOTO",
          key: `results/${randomUUID()}.jpg`,
          mime: "image/jpeg",
          confirmedAt: new Date(),
        },
      });
      const withPhoto = await post("bola", {
        ...SHEET,
        pollingUnit: "PU 300",
        state: "Kano",
        lga: "Nassarawa",
        photoFileId: photo.id,
      }).expect(201);
      expect(JSON.stringify(withPhoto.body)).not.toMatch(/photo/i);
      const res = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts`)
        .expect(200);
      expect(res.body.items[0].id).toBe(withPhoto.body.id);
      expect(
        res.body.items.every((p: { isMine: boolean }) => p.isMine === false),
      ).toBe(true);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(photo.id);
      expect(text).not.toContain(photo.key);
      expect(text).not.toMatch(/photo/i);
      const kano = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts?state=kano`)
        .expect(200);
      expect(kano.body.items).toHaveLength(1);
      const ver = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts?status=VERIFIED`)
        .expect(200);
      expect(ver.body.items).toHaveLength(0);
      const mine = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts`)
        .set("Authorization", h.bearer(people.bola.sub))
        .expect(200);
      expect(
        mine.body.items.find((p: { id: string }) => p.id === withPhoto.body.id)
          .isMine,
      ).toBe(true);
    });

    it("reports newCount from the `after` cursor and pages without gaps", async () => {
      const first = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts?limit=2`)
        .expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.newestCursor).toBeTruthy();
      expect(first.body.newCount).toBe(0);
      const second = await h
        .http()
        .get(
          `/api/v1/result-threads/${thread}/posts?limit=2&cursor=${first.body.nextCursor}`,
        )
        .expect(200);
      const ids = [...first.body.items, ...second.body.items].map(
        (p: { id: string }) => p.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
      await person("late");
      await post("late", { ...SHEET, pollingUnit: "L1" }).expect(201);
      const poll = await h
        .http()
        .get(
          `/api/v1/result-threads/${thread}/posts?limit=2&after=${first.body.newestCursor}`,
        )
        .expect(200);
      expect(poll.body.newCount).toBe(1);
    });

    it("thread counts come from the rows: postCount, verifiedCount, toCheck", async () => {
      const rows = await h.prisma.resultPost.findMany({
        where: { threadId: thread, status: { not: "REMOVED" } },
      });
      const t = await h
        .http()
        .get(`/api/v1/result-threads/${thread}`)
        .expect(200);
      expect(t.body.postCount).toBe(rows.length);
      expect(t.body.toCheck).toBe(
        rows.filter((r) => r.status === "NOT_VERIFIED" && !r.checkedAt).length,
      );
      expect(t.body.verifiedCount).toBe(0);
    });

    it("delete: 401 guest, 403 someone else's, 204 mine, 404 again, gone from reads", async () => {
      const made = await post("late", { ...SHEET, pollingUnit: "D1" }).expect(
        201,
      );
      await h.http().delete(`/api/v1/result-posts/${made.body.id}`).expect(401);
      const other = await h
        .http()
        .delete(`/api/v1/result-posts/${made.body.id}`)
        .set("Authorization", h.bearer(people.ada.sub))
        .expect(403);
      expect(other.body.error.code).toBe("FORBIDDEN");
      await h
        .http()
        .delete(`/api/v1/result-posts/${made.body.id}`)
        .set("Authorization", h.bearer(people.late.sub))
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/result-posts/${made.body.id}`)
        .set("Authorization", h.bearer(people.late.sub))
        .expect(404);
      await h
        .http()
        .delete(`/api/v1/result-posts/${randomUUID()}`)
        .set("Authorization", h.bearer(people.late.sub))
        .expect(404);
      expect(
        (
          await h.prisma.resultPost.findUniqueOrThrow({
            where: { id: made.body.id },
          })
        ).status,
      ).toBe("REMOVED");
      const list = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts`)
        .expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(
        made.body.id,
      );
    });
  });

  describe("the team (service A7 calls) and the sheet photo", () => {
    let withPhotoId: string;
    let photoKey: string;

    beforeAll(async () => {
      const row = await h.prisma.resultPost.findFirstOrThrow({
        where: { photoFileId: { not: null }, status: { not: "REMOVED" } },
      });
      withPhotoId = row.id;
      photoKey = (
        await h.prisma.storedFile.findUniqueOrThrow({
          where: { id: row.photoFileId as string },
        })
      ).key;
    });

    it("ATTACK: a non-team account cannot get the photo URL, by the service or in any public response", async () => {
      for (const who of ["ada", "bola", "mod"]) {
        const err = await h.results
          .adminGetPost({ sub: people[who].sub } as never, withPhotoId)
          .catch((e) => e);
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse().code).toBe("ROLE_REQUIRED");
        const list = await h.results
          .adminListPosts({ sub: people[who].sub } as never, {})
          .catch((e) => e);
        expect(list.getStatus()).toBe(403);
        const dec = await h.results
          .decide({ sub: people[who].sub } as never, withPhotoId, {
            decision: "VERIFIED",
          })
          .catch((e) => e);
        expect(dec.getStatus()).toBe(403);
      }
      // a signed-out caller and a no-profile caller fail the same way
      const nobody = await h.results
        .adminGetPost({ sub: "ghost" } as never, withPhotoId)
        .catch((e) => e);
      expect(nobody.getStatus()).toBe(403);
      // nothing public carries it, signed in as the poster or not
      for (const auth of [
        undefined,
        h.bearer(people.bola.sub),
        h.bearer(people.ada.sub),
      ]) {
        for (const url of [
          `/api/v1/result-threads/${thread}/posts`,
          `/api/v1/result-threads/${thread}`,
          "/api/v1/result-threads",
        ]) {
          const r = h.http().get(url);
          const res = await (auth ? r.set("Authorization", auth) : r).expect(
            200,
          );
          expect(JSON.stringify(res.body)).not.toContain(photoKey);
          expect(JSON.stringify(res.body)).not.toMatch(/photo/i);
        }
      }
      // no route serves the file
      for (const p of [
        `/api/v1/result-posts/${withPhotoId}`,
        `/api/v1/result-posts/${withPhotoId}/photo`,
        `/api/v1/result-posts/${withPhotoId}/sheet`,
      ]) {
        const res = await h
          .http()
          .get(p)
          .set("Authorization", h.bearer(people.bola.sub));
        expect([404]).toContain(res.status);
      }
    });

    it("the team sees the signed photo URL; the queue starts with unchecked posts, oldest first", async () => {
      const one = await h.results.adminGetPost(
        { sub: people.editor.sub } as never,
        withPhotoId,
      );
      expect(one.hasPhoto).toBe(true);
      expect(one.photoUrl).toContain(photoKey);
      expect(one.photoUrl).toMatch(/X-Amz-Expires=300/);
      const q = await h.results.adminListPosts(
        { sub: people.editor.sub } as never,
        {},
      );
      expect(q.toCheck).toBeGreaterThan(0);
      const times = q.items.map((i) => i.post.createdAt);
      expect([...times].sort()).toEqual(times);
    });

    it("decide VERIFIED: label flips, who and when are kept, audit row written, the poster id is handed back", async () => {
      const out = await h.results.decide(
        { sub: people.editor.sub } as never,
        withPhotoId,
        { decision: "VERIFIED", note: "Matches the sheet" },
      );
      expect(out.authorId).toBe(people.bola.id);
      expect(out.result.post).toMatchObject({
        status: "VERIFIED",
        label: "Verified",
      });
      expect(out.result.post.checkedLine).toMatch(
        /^Checked by the WAWU team, /,
      );
      expect(out.result.checkedBy).toMatch(/^@/);
      const row = await h.prisma.resultPost.findUniqueOrThrow({
        where: { id: withPhotoId },
      });
      expect(row).toMatchObject({
        status: "VERIFIED",
        checkedById: people.editor.id,
        checkNote: "Matches the sheet",
      });
      expect(row.checkedAt).not.toBeNull();
      expect(
        await h.prisma.auditLog.count({
          where: { action: "result.decide", targetId: withPhotoId },
        }),
      ).toBe(1);
      const list = await h
        .http()
        .get(`/api/v1/result-threads/${thread}/posts?status=VERIFIED`)
        .expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([
        withPhotoId,
      ]);
      const t = await h
        .http()
        .get(`/api/v1/result-threads/${thread}`)
        .expect(200);
      expect(t.body.verifiedCount).toBe(1);
      const queue = await h.results.adminListPosts(
        { sub: people.editor.sub } as never,
        {},
      );
      expect(queue.items.map((i) => i.post.id)).not.toContain(withPhotoId);
    });

    it("decide NOT_VERIFIED after a check keeps the post Not verified but checked; SEND_TO_MODERATION opens one queue item", async () => {
      const row = await h.prisma.resultPost.findFirstOrThrow({
        where: { status: "NOT_VERIFIED", checkedAt: null },
      });
      const nv = await h.results.decide(
        { sub: people.editor.sub } as never,
        row.id,
        { decision: "NOT_VERIFIED" },
      );
      expect(nv.result.post.label).toBe("Not verified");
      expect(nv.result.post.checkedLine).toMatch(/could not be confirmed/);
      const row2 = await h.prisma.resultPost.findFirstOrThrow({
        where: { status: "NOT_VERIFIED", checkedAt: null },
      });
      await h.results.decide({ sub: people.editor.sub } as never, row2.id, {
        decision: "SEND_TO_MODERATION",
      });
      await h.results.decide({ sub: people.editor.sub } as never, row2.id, {
        decision: "SEND_TO_MODERATION",
      });
      expect(
        await h.prisma.moderationItem.count({
          where: { targetType: "RESULT_POST", targetId: row2.id },
        }),
      ).toBe(1);
      const gone = await h.results
        .decide({ sub: people.editor.sub } as never, randomUUID(), {
          decision: "VERIFIED",
        })
        .catch((e) => e);
      expect(gone.getStatus()).toBe(404);
    });

    it("H6: a result sent to moderation is no longer counted or listed as to check while its moderation item is open", async () => {
      const item = await h.prisma.moderationItem.findFirstOrThrow({
        where: { targetType: "RESULT_POST", status: "OPEN" },
      });
      const user = { sub: people.editor.sub } as never;
      const queue = await h.results.adminListPosts(user, {});
      expect(queue.items.map((i) => i.post.id)).not.toContain(item.targetId);
      const stillToCheck = await h.prisma.resultPost.count({
        where: {
          status: "NOT_VERIFIED",
          checkedAt: null,
          id: { not: item.targetId },
        },
      });
      expect(queue.toCheck).toBe(stillToCheck);
      const post = await h.prisma.resultPost.findUniqueOrThrow({
        where: { id: item.targetId },
      });
      const t = await h.results.adminListThreads(user, {});
      const mine = t.items.find((x) => x.id === post.threadId);
      expect(mine?.toCheck).toBe(
        await h.prisma.resultPost.count({
          where: {
            threadId: post.threadId,
            status: "NOT_VERIFIED",
            checkedAt: null,
            id: { not: item.targetId },
          },
        }),
      );
      // settled in moderation: it is the editors' to check again
      await h.prisma.moderationItem.update({
        where: { id: item.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      const back = await h.results.adminListPosts(user, {});
      expect(back.items.map((i) => i.post.id)).toContain(item.targetId);
    });

    it("the team can open a thread", async () => {
      const t = await h.results.adminCreateThread(
        { sub: people.editor.sub } as never,
        { title: "Run-off", heldOn: "2027-02-06" },
      );
      expect(t).toMatchObject({
        title: "Run-off",
        status: "SCHEDULED",
        heldOn: "2027-02-06",
        postCount: 0,
      });
      const err = await h.results
        .adminCreateThread({ sub: people.ada.sub } as never, {
          title: "x",
          heldOn: "2027-02-06",
        })
        .catch((e) => e);
      expect(err.getStatus()).toBe(403);
    });
  });

  it("blocks hide result posts both ways", async () => {
    await person("rblkA");
    await person("rblkB");
    const a = await post("rblkA", { ...SHEET, pollingUnit: "BA" }).expect(201);
    const b = await post("rblkB", { ...SHEET, pollingUnit: "BB" }).expect(201);
    const ids = async (who: string) =>
      (
        (
          await h
            .http()
            .get(`/api/v1/result-threads/${thread}/posts?limit=50`)
            .set("Authorization", h.bearer(people[who].sub))
            .expect(200)
        ).body.items as { id: string }[]
      ).map((i) => i.id);
    expect(await ids("rblkA")).toEqual(
      expect.arrayContaining([a.body.id, b.body.id]),
    );
    await h.prisma.block.create({
      data: { blockerId: people.rblkB.id, blockedId: people.rblkA.id },
    });
    // B blocked A: A also stops seeing B
    expect(await ids("rblkB")).not.toContain(a.body.id);
    expect(await ids("rblkA")).not.toContain(b.body.id);
    expect(await ids("rblkA")).toContain(a.body.id);
    expect(await ids("rblkB")).toContain(b.body.id);
    expect(await ids("ada")).toEqual(
      expect.arrayContaining([a.body.id, b.body.id]),
    );
  });
});
