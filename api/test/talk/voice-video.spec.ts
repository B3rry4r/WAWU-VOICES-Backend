/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportService, ExportStore } from "../../src/me/export.service";
import { DeletionService } from "../../src/me/deletion.service";
import { StoragePurgeService } from "../../src/media/storage-purge.service";
import { VoiceVideoService } from "../../src/media/voice-video.service";
import {
  captionChunks,
  layoutFor,
  renderVoiceVideo,
} from "../../src/media/voice-video-render";
import {
  fixture,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

jest.setTimeout(180_000);

describe("LCH-07: the voice made into a short video", () => {
  let h: Harness;
  let svc: VoiceVideoService;
  const realRender = renderVoiceVideo;
  beforeAll(async () => {
    h = await startHarness();
    svc = h.app.get(VoiceVideoService);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    svc.render = realRender;
  });

  async function voiceAnswer(
    p: Person,
    o: {
      durationMs?: number;
      transcript?: string | null;
      audio?: string;
      mood?: boolean;
    } = {},
  ) {
    const q = await makeQuestion(h);
    const playKey = `voice/${Math.random().toString(36).slice(2)}.m4a`;
    h.store.objects.set(playKey, fixture(o.audio ?? "sample.webm"));
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: p.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/" + playKey,
        rawMime: "audio/webm",
        playKey,
        playMime: "audio/mp4",
        durationMs: o.durationMs ?? 5000,
        maxDurationMs: 10_000,
        readyAt: new Date(),
      },
    });
    if (o.transcript !== null)
      await h.prisma.transcript.create({
        data: {
          clipId: clip.id,
          status: "READY",
          text:
            o.transcript ??
            "Hopeful, because my younger ones are building things with nothing.",
          readyAt: new Date(),
        },
      });
    return h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p.id,
        kind: "VOICE",
        clipId: clip.id,
        ...(o.mood ? { mood: "HOPEFUL" as const } : {}),
      },
    });
  }

  const make = (p: Person | null, answerId: string, shape = "9x16") => {
    const r = h
      .http()
      .post(`/api/v1/answers/${answerId}/videos`)
      .send({ shape });
    return p ? r.set("Authorization", p.auth) : r;
  };
  const list = (p: Person, answerId: string) =>
    h
      .http()
      .get(`/api/v1/answers/${answerId}/videos`)
      .set("Authorization", p.auth);
  const file = (p: Person, id: string) =>
    h
      .http()
      .get(`/api/v1/voice-videos/${id}/file`)
      .set("Authorization", p.auth)
      .buffer(true)
      .parse((rs, cb) => {
        const c: Buffer[] = [];
        rs.on("data", (d: Buffer) => c.push(d));
        rs.on("end", () => cb(null, Buffer.concat(c)));
      });
  const probe = (buf: Buffer) => {
    const dir = mkdtempSync(join(tmpdir(), "lche-"));
    const f = join(dir, "v.mp4");
    writeFileSync(f, buf);
    const out = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      f,
    ]).toString();
    const j = JSON.parse(out);
    return {
      w: j.streams[0].width as number,
      h: j.streams[0].height as number,
      secs: Number(j.format.duration),
    };
  };

  it("makes 9:16 and 1:1 MP4s of at most 15 seconds, however long the clip", async () => {
    const p = await makePerson(h);
    const a = await voiceAnswer(p, {
      durationMs: 30_000,
      audio: "long15.webm",
      mood: true,
    });
    const v1 = (await make(p, a.id, "9x16").expect(202)).body;
    const v2 = (await make(p, a.id, "1x1").expect(202)).body;
    expect(v1.status).toBe("QUEUED");
    await svc.idle();
    const items = (await list(p, a.id).expect(200)).body.items;
    expect(items.map((i: { status: string }) => i.status)).toEqual([
      "READY",
      "READY",
    ]);
    for (const [v, size] of [
      [v1, [1080, 1920]],
      [v2, [1080, 1080]],
    ] as const) {
      const res = await file(p, v.id).expect(200);
      expect(res.headers["content-type"]).toBe("video/mp4");
      const m = probe(res.body as Buffer);
      expect([m.w, m.h]).toEqual(size);
      expect(m.secs).toBeLessThanOrEqual(15.1);
      expect(m.secs).toBeGreaterThan(14);
    }
  });

  it("asking twice for the same shape is one video; only a voice answer, only a real shape", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("x"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const one = (await make(p, a.id).expect(202)).body;
    const two = (await make(p, a.id).expect(202)).body;
    expect(two.id).toBe(one.id);
    await make(p, a.id, "4x3").expect(422);
    const q = await makeQuestion(h);
    const t = await h.prisma.answer.create({
      data: { questionId: q.id, authorId: p.id, kind: "TEXT", body: "hello" },
    });
    await make(p, t.id).expect(422);
    await svc.idle();
  });

  it("only the answer's author can ask, list or fetch", async () => {
    const p = await makePerson(h);
    const other = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("mp4data"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    await make(null, a.id).expect(401);
    await make(other, a.id).expect(403);
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    await list(other, a.id).expect(404);
    await file(other, v.id).expect(404);
    await h.http().get(`/api/v1/voice-videos/${v.id}/file`).expect(401);
    expect((await file(p, v.id).expect(200)).body.toString()).toBe("mp4data");
    expect(
      await h.prisma.voiceVideo.count({ where: { authorId: other.id } }),
    ).toBe(0);
  });

  it("a removed answer's video is a 404 at once, and its file is deleted by the purge", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("mp4data"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    await file(p, v.id).expect(200);
    const row = await h.prisma.voiceVideo.findUniqueOrThrow({
      where: { id: v.id },
    });
    const stored = await h.prisma.storedFile.findUniqueOrThrow({
      where: { id: row.fileId as string },
    });
    await h.prisma.answer.update({
      where: { id: a.id },
      data: { status: "REMOVED" },
    });
    await file(p, v.id).expect(404);
    expect((await list(p, a.id).expect(200)).body.items).toEqual([]);
    await make(p, a.id).expect(404);
    await h.app.get(StoragePurgeService).run();
    expect(h.store.deleted).toContain(stored.key);
    const after = await h.prisma.voiceVideo.findUniqueOrThrow({
      where: { id: v.id },
    });
    expect([after.status, after.fileId]).toEqual(["REMOVED", null]);
    expect(
      (
        await h.prisma.storedFile.findUniqueOrThrow({
          where: { id: stored.id },
        })
      ).purgedAt,
    ).not.toBeNull();
  });

  it("an answer the author deleted loses its video the same way", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    await h
      .http()
      .delete(`/api/v1/answers/${a.id}`)
      .set("Authorization", p.auth);
    await file(p, v.id).expect(404);
  });

  it("the deletion purge removes a person's videos and their files", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    const row = await h.prisma.voiceVideo.findUniqueOrThrow({
      where: { id: v.id },
    });
    const key = (
      await h.prisma.storedFile.findUniqueOrThrow({
        where: { id: row.fileId as string },
      })
    ).key;
    await h.prisma.user.update({
      where: { id: p.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 30 * 86_400_000),
      },
    });
    await h.app.get(DeletionService).purge(p.id);
    expect(
      (await h.prisma.voiceVideo.findUniqueOrThrow({ where: { id: v.id } }))
        .status,
    ).toBe("REMOVED");
    await h.app.get(StoragePurgeService).run();
    expect(h.store.deleted).toContain(key);
  });

  it("a person can ask for 5 videos a day, then is told to wait", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    for (let i = 0; i < 5; i++) {
      const a = await voiceAnswer(p);
      await make(p, a.id).expect(202);
    }
    const a6 = await voiceAnswer(p);
    const res = await make(p, a6.id).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(res.body.error.message).not.toMatch(/[—]/);
    await svc.idle();
  });

  it("every build counts toward the Lagos day: a failed one and its retries too", async () => {
    const p = await makePerson(h);
    svc.render = () => Promise.reject(new Error("ffmpeg gone"));
    const a = await voiceAnswer(p);
    for (let i = 0; i < 5; i++) {
      await make(p, a.id).expect(202);
      await svc.idle();
    }
    const res = await make(p, a.id).expect(429);
    expect(res.body.error.message).toBe(
      "You can make 5 videos a day. You can make more after midnight.",
    );
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(await h.prisma.voiceVideo.count({ where: { authorId: p.id } })).toBe(
      5,
    );
  });

  it("a day's count starts at Lagos midnight, not 24 hours back", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const old = new Date(Date.now() - 2 * 86_400_000);
    for (let i = 0; i < 5; i++)
      await h.prisma.voiceVideo.create({
        data: {
          answerId: a.id,
          authorId: p.id,
          shape: "1x1",
          status: "FAILED",
          createdAt: old,
        },
      });
    await make(p, a.id).expect(202);
    await svc.idle();
  });

  it("a restored answer can have its video made again; the old video stays deleted", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const first = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    await h.prisma.answer.update({
      where: { id: a.id },
      data: { status: "REMOVED" },
    });
    await svc.sweepGone();
    await h.prisma.answer.update({
      where: { id: a.id },
      data: { status: "PUBLISHED" },
    });
    expect((await list(p, a.id)).body.items).toEqual([]);
    await file(p, first.id).expect(404);
    const again = (await make(p, a.id).expect(202)).body;
    expect(again.id).not.toBe(first.id);
    await svc.idle();
    expect((await list(p, a.id)).body.items[0].status).toBe("READY");
  });

  it("tells the person once per build: ready, or could not be made, opening the answer", async () => {
    const p = await makePerson(h);
    const a = await voiceAnswer(p);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    await svc.process(v.id);
    svc.render = () => Promise.reject(new Error("x"));
    const a2 = await voiceAnswer(p);
    const f = (await make(p, a2.id).expect(202)).body;
    await svc.idle();
    const rows = await h.prisma.notification.findMany({
      where: { userId: p.id, type: "VIDEO_READY" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.title, r.targetType, r.targetId])).toEqual([
      ["Your video is ready.", "answer", a.id],
      ["We could not make your video. Try again.", "answer", a2.id],
    ]);
    expect(f.id).toBeTruthy();
    const feed = (
      await h
        .http()
        .get("/api/v1/notifications")
        .set("Authorization", p.auth)
        .expect(200)
    ).body;
    expect(JSON.stringify(feed)).toContain("Your video is ready.");
  });

  it("the sweeps never throw, never lock when nothing is gone, and run side by side without deadlock", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await voiceAnswer(p));
    for (const a of answers) await make(p, a.id).expect(202);
    await svc.idle();
    expect(await svc.sweepGone()).toBe(0);
    for (const a of answers)
      await h.prisma.answer.update({
        where: { id: a.id },
        data: { status: "REMOVED" },
      });
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => svc.sweepGone()),
    );
    expect(runs.reduce((n, r) => n + r, 0)).toBe(4);
    await Promise.all([
      svc.sweep(),
      svc.sweepGone(),
      h.app.get(StoragePurgeService).run(),
    ]);
    expect(
      await h.prisma.voiceVideo.count({
        where: { authorId: p.id, status: { not: "REMOVED" } },
      }),
    ).toBe(0);
  });

  it("the data download lists my videos with no file and no link", async () => {
    const p = await makePerson(h);
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("mp4data"), durationMs: 1000 });
    const a = await voiceAnswer(p);
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    const store = h.app.get(ExportStore);
    const put: Buffer[] = [];
    jest.spyOn(store, "isConfigured").mockReturnValue(true);
    jest.spyOn(store, "put").mockImplementation((_k, body) => {
      put.push(body);
      return Promise.resolve();
    });
    const exp = h.app.get(ExportService);
    const er = await h.prisma.dataExport.create({ data: { userId: p.id } });
    await exp.build(er.id, p.id);
    jest.restoreAllMocks();
    const out = JSON.parse(put[0].toString());
    expect(out.videos).toEqual([
      {
        id: v.id,
        answerId: a.id,
        shape: "9x16",
        status: "READY",
        bytes: 7,
        durationMs: 1000,
        createdAt: expect.any(String),
        readyAt: expect.any(String),
      },
    ]);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/video\/[0-9a-f-]+\.mp4|https?:|voice-videos/);
  });

  it("50 requests at once: queued, made two at a time, all done, none lost", async () => {
    svc.peakRunning = 0;
    let active = 0;
    let most = 0;
    svc.render = async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return { mp4: Buffer.from("m"), durationMs: 1000 };
    };
    const people = await Promise.all(
      Array.from({ length: 10 }, () => makePerson(h)),
    );
    const targets: { p: Person; id: string }[] = [];
    for (const p of people)
      for (let i = 0; i < 5; i++)
        targets.push({ p, id: (await voiceAnswer(p)).id });
    const res = await Promise.all(targets.map((t) => make(t.p, t.id)));
    expect(res.every((r) => r.status === 202)).toBe(true);
    expect(res.filter((r) => r.body.status === "QUEUED").length).toBe(50);
    await svc.idle();
    const ready = await h.prisma.voiceVideo.count({
      where: { answerId: { in: targets.map((t) => t.id) }, status: "READY" },
    });
    expect(ready).toBe(50);
    expect(most).toBeLessThanOrEqual(2);
    expect(svc.peakRunning).toBeLessThanOrEqual(2);
  });

  it("a failed render is FAILED, not stuck, and can be asked again", async () => {
    const p = await makePerson(h);
    const a = await voiceAnswer(p);
    svc.render = () => Promise.reject(new Error("ffmpeg gone"));
    const v = (await make(p, a.id).expect(202)).body;
    await svc.idle();
    expect((await list(p, a.id)).body.items[0].status).toBe("FAILED");
    svc.render = () =>
      Promise.resolve({ mp4: Buffer.from("m"), durationMs: 1000 });
    const again = (await make(p, a.id).expect(202)).body;
    expect(again.id).not.toBe(v.id);
    await svc.idle();
    expect((await list(p, a.id)).body.items[0].status).toBe("READY");
  });

  it("captions come only from the stored transcript; none when there is none", () => {
    const text =
      "Hopeful, because my younger ones are building things with nothing. They do not wait for anyone.";
    const input = {
      shape: "1x1" as const,
      question: "How do you feel about Nigeria right now?",
      mood: "HOPEFUL",
      who: null,
      transcript: text,
      audio: Buffer.alloc(0),
      durationMs: 10_000,
      host: "usevoices.com",
    };
    const L = layoutFor(input);
    const chunks = captionChunks(text, L);
    expect(chunks.flatMap((c) => c.lines).join(" ")).toBe(text);
    expect(chunks.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1);
    expect(L.bgSvg(10)).not.toMatch(/[—’“]/);
    expect(L.bgSvg(10)).toContain("usevoices.com/go");
    expect(L.bgSvg(10)).toContain("HOPEFUL");
    expect(layoutFor({ ...input, mood: null }).bgSvg(10)).not.toContain(
      "HOPEFUL",
    );
  });
});
