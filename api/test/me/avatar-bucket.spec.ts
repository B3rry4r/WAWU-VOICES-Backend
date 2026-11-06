/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { makePerson, startHarness, type Harness } from "../talk/harness";

describe("PATCH /me/profile avatarFileId when the bucket cannot be reached", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("answers 503 UNAVAILABLE with a plain message, and leaves the file unconfirmed", async () => {
    const me = await makePerson(h);
    const up = await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", me.auth)
      .send({ kind: "AVATAR", mime: "image/png", sizeBytes: 1200 })
      .expect(201);
    const id = up.body.fileId as string;
    const real = h.store.head.bind(h.store);
    h.store.head = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    try {
      const r = await h
        .http()
        .patch("/api/v1/me/profile")
        .set("Authorization", me.auth)
        .send({ avatarFileId: id })
        .expect(503);
      expect(r.body.error.code).toBe("UNAVAILABLE");
      expect(r.body.error.message).toBe(
        "Uploads are not available right now. Try again in a minute.",
      );
    } finally {
      h.store.head = real;
    }
    const file = await h.prisma.storedFile.findUniqueOrThrow({ where: { id } });
    expect(file.confirmedAt).toBeNull();
    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: me.id },
    });
    expect(user.avatarFileId).toBeNull();
  });
});
