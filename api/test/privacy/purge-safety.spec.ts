/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "../../src/generated/prisma/client";
import { encodeCursor } from "../../src/results/cursor";
import {
  STORED_FILE_REFS,
  StoragePurgeService,
} from "../../src/media/storage-purge.service";
import {
  idem,
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

const HOUR = 3_600_000;

describe("privacy fix PF1 to PF4: the storage purge never deletes a file in use", () => {
  let h: Harness;
  let purge: StoragePurgeService;
  beforeAll(async () => {
    h = await startHarness();
    purge = h.app.get(StoragePurgeService);
    await purge.run(new Date(Date.now() + 100 * HOUR)); // drain what other suites left
  });
  afterAll(async () => h.close());

  const age = (id: string, hours: number) =>
    h.prisma.storedFile.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - hours * HOUR) },
    });
  async function upload(p: Person, kind: string, put = true) {
    const r = await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", p.auth)
      .send({ kind, mime: "image/jpeg", sizeBytes: 3 })
      .expect(201);
    const f = await h.prisma.storedFile.findUniqueOrThrow({
      where: { id: r.body.fileId },
    });
    if (put) h.store.objects.set(f.key, Buffer.from("abc"));
    return f;
  }
  const thread = (by: string) =>
    h.prisma.resultThread.create({
      data: { title: "T", heldOn: new Date(), createdById: by, status: "OPEN" },
    });
  const postResult = (p: Person, threadId: string, photoFileId: string) =>
    h
      .http()
      .post(`/api/v1/result-threads/${threadId}/posts`)
      .set("Authorization", p.auth)
      .set(idem())
      .send({
        state: "Lagos",
        lga: "A",
        ward: "B",
        pollingUnit: "C" + randomUUID().slice(0, 4),
        accredited: 10,
        votesCast: 5,
        rejected: 0,
        photoFileId,
      });

  it("a completed result photo still posted 25 hours later (even with a stale purge mark) is kept", async () => {
    const p = await makePerson(h);
    const th = await thread(p.id);
    const f = await upload(p, "RESULT_PHOTO");
    await h
      .http()
      .post(`/api/v1/uploads/${f.id}/complete`)
      .set("Authorization", p.auth)
      .expect(200);
    await postResult(p, th.id, f.id).expect(201);
    await h.prisma.storedFile.update({
      where: { id: f.id },
      data: {
        createdAt: new Date(Date.now() - 25 * HOUR),
        purgeRequestedAt: new Date(),
      },
    });
    await purge.run();
    expect(h.store.objects.has(f.key)).toBe(true);
    expect(
      (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } }))
        .purgedAt,
    ).toBeNull();
  });

  it("a result photo the web never completed is confirmed by attaching it and survives the 24 hour sweep", async () => {
    const p = await makePerson(h);
    const th = await thread(p.id);
    const f = await upload(p, "RESULT_PHOTO");
    expect(f.confirmedAt).toBeNull();
    await postResult(p, th.id, f.id).expect(201);
    const after = await h.prisma.storedFile.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(after.confirmedAt).not.toBeNull();
    await age(f.id, 25);
    await purge.run();
    expect(h.store.objects.has(f.key)).toBe(true);
    // a photo whose object never arrived is refused, not attached
    const ghost = await upload(p, "RESULT_PHOTO", false);
    await postResult(p, th.id, ghost.id).expect(422);
    // another person's photo is refused
    const other = await makePerson(h);
    const theirs = await upload(other, "RESULT_PHOTO");
    await postResult(p, th.id, theirs.id).expect(422);
  });

  it("an ad creative that was never completed is confirmed by the advert and survives", async () => {
    const m = await makePerson(h);
    await h.prisma.userRoleGrant.create({
      data: { userId: m.id, role: "AD_MANAGER", grantedById: "seed" },
    });
    const f = await upload(m, "AD_CREATIVE");
    const r = await h
      .http()
      .post("/api/v1/admin/ads")
      .set("Authorization", m.auth)
      .send({ brand: "B", kind: "BANNER", headline: "H", imageFileId: f.id })
      .expect(201);
    const ad = await h.prisma.ad.findUniqueOrThrow({
      where: { id: r.body.id },
    });
    expect(ad.imageFileId).toBe(f.id);
    expect(
      (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } }))
        .confirmedAt,
    ).not.toBeNull();
    await age(f.id, 25);
    await h.prisma.storedFile.update({
      where: { id: f.id },
      data: { purgeRequestedAt: new Date() },
    });
    await purge.run();
    expect(h.store.objects.has(f.key)).toBe(true);
    // the wrong kind is refused
    const av = await upload(m, "AVATAR");
    await h
      .http()
      .post("/api/v1/admin/ads")
      .set("Authorization", m.auth)
      .send({ brand: "B", kind: "BANNER", headline: "H", imageFileId: av.id })
      .expect(422);
  });

  it("avatar A, then B, then A again: A is not deleted, B is", async () => {
    const p = await makePerson(h);
    const A = await upload(p, "AVATAR");
    const B = await upload(p, "AVATAR");
    const set = (id: string) =>
      h
        .http()
        .patch("/api/v1/me/profile")
        .set("Authorization", p.auth)
        .send({ avatarFileId: id });
    await set(A.id).expect(200);
    await set(B.id).expect(200);
    await set(A.id).expect(200);
    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
        .avatarFileId,
    ).toBe(A.id);
    await purge.run();
    expect(h.store.objects.has(A.key)).toBe(true);
    expect(h.store.objects.has(B.key)).toBe(false);
    expect(
      (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: B.id } }))
        .purgedAt,
    ).not.toBeNull();
    // even a wrongly marked, referenced file is skipped by the claim itself
    await h.prisma.storedFile.update({
      where: { id: A.id },
      data: { purgeRequestedAt: new Date() },
    });
    await purge.run();
    expect(h.store.objects.has(A.key)).toBe(true);
  });

  it("a viewer with a block still sees a purged-author result post, in the list and in newCount", async () => {
    const viewer = await makePerson(h);
    const blocked = await makePerson(h);
    await h.prisma.block.create({
      data: { blockerId: viewer.id, blockedId: blocked.id },
    });
    const th = await thread(viewer.id);
    const mk = (authorId: string | null, k: string) =>
      h.prisma.resultPost.create({
        data: {
          threadId: th.id,
          authorId,
          state: "Lagos",
          lga: "A",
          ward: "B",
          pollingUnit: k,
          accredited: 5,
          votesCast: 4,
          rejected: 0,
          idempotencyKey: k,
        },
      });
    const first = await mk(blocked.id, "b1");
    const nul = await mk(null, "n1");
    const res = await h
      .http()
      .get(`/api/v1/result-threads/${th.id}/posts`)
      .set("Authorization", viewer.auth)
      .expect(200);
    const ids = (res.body.items as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(nul.id);
    expect(ids).not.toContain(first.id);
    const cursor = encodeCursor({
      k: new Date(Date.now() - HOUR).toISOString(),
      id: "0",
    });
    const again = await h
      .http()
      .get(`/api/v1/result-threads/${th.id}/posts?after=${cursor}`)
      .set("Authorization", viewer.auth);
    expect(again.status).toBe(200);
    expect(again.body.newCount).toBe(1);
  });

  it("every column that names a StoredFile is covered by the purge's reference check", () => {
    const covered = new Set(STORED_FILE_REFS.map(([m, c]) => `${m}.${c}`));
    const found: string[] = [];
    const scalars = Prisma as unknown as Record<string, Record<string, string>>;
    for (const m of Object.keys(Prisma.ModelName))
      for (const f of Object.keys(scalars[`${m}ScalarFieldEnum`] ?? {}))
        if (/FileId$|^fileId$/.test(f)) found.push(`${m}.${f}`);
    // a real Prisma relation to StoredFile (none today) is read from the schema text
    let model = "";
    for (const line of readFileSync(
      join(__dirname, "../../prisma/schema.prisma"),
      "utf8",
    ).split("\n")) {
      const mm = /^model (\w+) /.exec(line);
      if (mm) model = mm[1];
      const rel = /^\s+(\w+)\s+StoredFile\??\s/.exec(line);
      if (rel && model !== "StoredFile") found.push(`${model}.${rel[1]}`);
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((x) => !covered.has(x))).toEqual([]);
    expect([...covered].filter((x) => !found.includes(x))).toEqual([]);
  });
});
