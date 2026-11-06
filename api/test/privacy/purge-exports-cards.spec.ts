import { ExportService, ExportStore } from "../../src/me/export.service";
import { DeletionService } from "../../src/me/deletion.service";
import { StoragePurgeService } from "../../src/media/storage-purge.service";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

const DAY = 24 * 3_600_000;

describe("privacy P2-2: a purged person's export files and share cards are deleted", () => {
  let h: Harness;
  let purge: StoragePurgeService;
  beforeAll(async () => {
    h = await startHarness();
    purge = h.app.get(StoragePurgeService);
    await purge.run(new Date(Date.now() + 100 * DAY)); // drain what other suites left
  });
  afterAll(async () => h.close());

  let n = 0;
  async function file(
    kind: "DATA_EXPORT" | "SHARE_CARD",
    owner: Person | null,
  ) {
    const key = `p22/${kind}/${++n}-${Math.random().toString(36).slice(2)}`;
    h.store.objects.set(key, Buffer.from("x"));
    return h.prisma.storedFile.create({
      data: {
        ownerId: owner?.id ?? null,
        kind,
        key,
        mime: kind === "DATA_EXPORT" ? "application/json" : "image/png",
        confirmedAt: new Date(),
      },
    });
  }
  async function card(
    objectType: "ANSWER" | "PROFILE",
    objectId: string,
    sharerId: string | null = null,
  ) {
    const f = await file("SHARE_CARD", null);
    const link = await h.prisma.shortLink.create({
      data: {
        code: `p${++n}${Math.random().toString(36).slice(2, 7)}`.slice(0, 7),
        objectType,
        objectId,
        sharerId,
      },
    });
    const c = await h.prisma.shareCard.create({
      data: {
        linkId: link.id,
        status: "READY",
        topicLine: "t",
        storyFileId: f.id,
      },
    });
    return { f, link, c };
  }
  const answer = (p: Person, questionId: string) =>
    h.prisma.answer.create({
      data: { questionId, authorId: p.id, kind: "TEXT", body: "my words" },
    });
  const retire = (p: Person) =>
    h.prisma.user.update({
      where: { id: p.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * DAY),
      },
    });

  it("deletes the export JSON and the answer and profile card images, leaves other people's cards, and a second purge changes nothing", async () => {
    const q = await makeQuestion(h);
    const gone = await makePerson(h);
    const other = await makePerson(h);
    const exp = await file("DATA_EXPORT", gone);
    await h.prisma.dataExport.create({
      data: { userId: gone.id, status: "READY", fileId: exp.id },
    });
    const otherExp = await file("DATA_EXPORT", other);
    await h.prisma.dataExport.create({
      data: { userId: other.id, status: "READY", fileId: otherExp.id },
    });
    const myAnswer = await answer(gone, q.id);
    const theirAnswer = await answer(other, q.id);
    const mineAnswerCard = await card("ANSWER", myAnswer.id);
    // a card on a link that SOMEONE ELSE shared, for the purged person's answer, shows their words too: it goes
    const sharedByOther = await card("ANSWER", myAnswer.id, other.id);
    const profileCard = await card("PROFILE", gone.id);
    const otherAnswerCard = await card("ANSWER", theirAnswer.id);
    // the purged person shared someone else's answer: that card shows the other person's words and stays
    const sharedByGone = await card("ANSWER", theirAnswer.id, gone.id);
    const otherProfile = await card("PROFILE", other.id);
    const questionCard = await file("SHARE_CARD", null);
    const qLink = await h.prisma.shortLink.create({
      data: {
        code: `q${++n}xxxxx`.slice(0, 7),
        objectType: "QUESTION",
        objectId: q.id,
      },
    });
    await h.prisma.shareCard.create({
      data: {
        linkId: qLink.id,
        status: "READY",
        topicLine: "q",
        storyFileId: questionCard.id,
      },
    });

    await retire(gone);
    expect(await h.app.get(DeletionService).purgeDue()).toBeGreaterThanOrEqual(
      1,
    );

    // rows: export detached, cards removed
    expect(
      await h.prisma.dataExport.findFirstOrThrow({
        where: { userId: gone.id },
      }),
    ).toMatchObject({ fileId: null, status: "EXPIRED" });
    for (const x of [mineAnswerCard, sharedByOther, profileCard])
      expect(await h.prisma.shareCard.count({ where: { id: x.c.id } })).toBe(0);
    for (const x of [otherAnswerCard, sharedByGone, otherProfile])
      expect(await h.prisma.shareCard.count({ where: { id: x.c.id } })).toBe(1);

    // the storage job deletes the objects of the purged person only
    await purge.run();
    const del = new Set(h.store.deleted);
    for (const f of [exp, mineAnswerCard.f, sharedByOther.f, profileCard.f])
      expect(del.has(f.key)).toBe(true);
    for (const f of [
      otherExp,
      otherAnswerCard.f,
      sharedByGone.f,
      otherProfile.f,
      questionCard,
    ]) {
      expect(del.has(f.key)).toBe(false);
      expect(h.store.objects.has(f.key)).toBe(true);
      expect(
        (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } }))
          .purgedAt,
      ).toBeNull();
    }
    for (const f of [exp, mineAnswerCard.f, sharedByOther.f, profileCard.f]) {
      expect(h.store.objects.has(f.key)).toBe(false);
      expect(
        (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: f.id } }))
          .purgedAt,
      ).not.toBeNull();
    }

    // a second purge and a second job run change nothing
    const rows = async () =>
      JSON.stringify([
        await h.prisma.shareCard.count(),
        await h.prisma.dataExport.findMany({
          where: { userId: { in: [gone.id, other.id] } },
          orderBy: { id: "asc" },
        }),
        await h.prisma.storedFile.count({
          where: { purgeRequestedAt: { not: null } },
        }),
      ]);
    const before = await rows();
    const deleted = h.store.deleted.length;
    await h.app.get(DeletionService).purge(gone.id);
    const again = await purge.run();
    expect(again.objectsDeleted).toBe(0);
    expect(h.store.deleted.length).toBe(deleted);
    expect(await rows()).toBe(before);
  });

  it("an export that finishes after the purge is never linked and its file is marked for deletion", async () => {
    const gone = await makePerson(h);
    await retire(gone);
    await h.app.get(DeletionService).purge(gone.id);
    const row = await h.prisma.dataExport.create({ data: { userId: gone.id } });
    const store = h.app.get(ExportStore);
    jest.spyOn(store, "isConfigured").mockReturnValue(true);
    jest.spyOn(store, "put").mockResolvedValue(undefined);
    await h.app.get(ExportService).build(row.id, gone.id);
    jest.restoreAllMocks();
    const after = await h.prisma.dataExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after).toMatchObject({ fileId: null, status: "EXPIRED" });
    const f = await h.prisma.storedFile.findFirstOrThrow({
      where: { ownerId: gone.id, kind: "DATA_EXPORT" },
    });
    expect(f.purgeRequestedAt).not.toBeNull();
    await purge.run();
    expect(h.store.objects.has(f.key)).toBe(false);
  });
});
