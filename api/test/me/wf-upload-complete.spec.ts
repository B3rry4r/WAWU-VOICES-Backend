/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { makePerson, startHarness, type Harness } from "../talk/harness";

describe("POST /uploads/{id}/complete when the bucket cannot be reached (WF-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("answers the same 503 UNAVAILABLE as the file attach, not a 500, and leaves the file unconfirmed; it works again when the bucket is back", async () => {
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
        .post(`/api/v1/uploads/${id}/complete`)
        .set("Authorization", me.auth)
        .expect(503);
      expect(r.body.error.code).toBe("UNAVAILABLE");
      expect(r.body.error.message).toBe(
        "Uploads are not available right now. Try again in a minute.",
      );
    } finally {
      h.store.head = real;
    }
    expect(
      (await h.prisma.storedFile.findUniqueOrThrow({ where: { id } }))
        .confirmedAt,
    ).toBeNull();
    // the object is not there yet: the plain "not received" answer, not a 503
    const missing = await h
      .http()
      .post(`/api/v1/uploads/${id}/complete`)
      .set("Authorization", me.auth)
      .expect(409);
    expect(missing.body.error.code).toBe("UPLOAD_NOT_RECEIVED");
  });
});
