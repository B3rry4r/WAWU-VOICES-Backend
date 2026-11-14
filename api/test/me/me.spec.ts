/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read JSON bodies and raw SQL rows */
import { createHash, createHmac } from "node:crypto";
import {
  boot,
  createBody,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";

const sha = (s: string) =>
  createHmac("sha256", "voices-test-pepper-not-a-secret")
    .update(s)
    .digest("hex");

describe("me: sign-in bootstrap, profile, settings", () => {
  let h: Harness;
  let cats: string[];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    h = await boot();
    await reset();
    cats = await seedCategories(5);
  });
  afterAll(() => h.close());

  describe("before a profile", () => {
    it("GET /me is a virtual Me with profileComplete false and handle null, and stores nothing", async () => {
      const t = h.token("fresh-1", { phone: "+2348012345678" });
      const res = await h.http().get("/api/v1/me").set(auth(t)).expect(200);
      expect(res.body).toMatchObject({
        wawuId: "fresh-1",
        handle: null,
        profileComplete: false,
        profile: null,
        roles: [],
        status: "ACTIVE",
        phoneMasked: "+234 ••• ••• 5678",
      });
      expect(res.body.allowances.freePostsRemaining).toBe(2);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='fresh-1'`)).length,
      ).toBe(0);
    });

    it("everything that needs a profile is 403 FORBIDDEN with details.reason PROFILE_REQUIRED", async () => {
      const t = h.token("fresh-2");
      for (const [m, p] of [
        ["get", "/api/v1/me/settings"],
        ["get", "/api/v1/me/answers"],
        ["get", "/api/v1/me/blocks"],
        ["patch", "/api/v1/me/profile"],
        ["delete", "/api/v1/me"],
      ] as const) {
        const res = await (
          h.http() as never as Record<string, (p: string) => any>
        )
          [m](p)
          .set(auth(t))
          .send({});
        expect([
          m,
          p,
          res.status,
          res.body.error?.code,
          res.body.error?.details,
        ]).toEqual([m, p, 403, "FORBIDDEN", { reason: "PROFILE_REQUIRED" }]);
      }
    });
  });

  describe("POST /me", () => {
    it("creates the person from the token: user, wallet, free allowance, settings, topics, phone hash only", async () => {
      const phone = "+2348099990001";
      const t = h.token("create-1", { phone });
      const res = await h
        .http()
        .post("/api/v1/me")
        .set(auth(t))
        .send(
          createBody(cats, { handle: "Ada.Okafor", languages: ["en", "pcm"] }),
        )
        .expect(201);
      expect(res.body).toMatchObject({
        wawuId: "create-1",
        handle: "ada.okafor",
        profileComplete: true,
        status: "ACTIVE",
        roles: [],
        savedCount: 0,
        replyCount: 0,
        reactionsReceived: 0,
        unreadNotifications: 0,
      });
      expect(res.body.referralCode).toMatch(/^[A-Z2-9]{8}$/);
      expect(res.body.profile).toMatchObject({
        handle: "ada.okafor",
        countryCode: "NG",
        languages: ["en", "pcm"],
        voiceCount: 0,
      });
      expect(res.body.allowances).toMatchObject({
        freePostsRemaining: 2,
        balanceMilli: 0,
        maxVoiceSeconds: 60,
        freeReactionsLeftToday: 20,
        freeVotesLeftToday: 3,
      });
      expect(res.body.allowances.costs).toMatchObject({
        textPostMilli: 5000,
        voicePostMilli: 78000,
        reactionAfterFreeMilli: 100,
        voteAfterFreeMilli: 200,
        minPackKobo: 18300,
        extraVoice30Kobo: 7800,
        extraVoice60Kobo: 10000,
      });
      const id = res.body.id as string;
      const [u] = await sql<any>(`SELECT * FROM "User" WHERE id=$1`, [id]);
      expect(u.wawuId).toBe("create-1");
      expect(u.phoneHash).toBe(sha(phone));
      expect(
        u.ageConfirmedAt && u.termsAcceptedAt && u.rulesAcceptedAt,
      ).toBeTruthy();
      const [w] = await sql<any>(
        `SELECT "balanceMilli" FROM "Wallet" WHERE "userId"=$1`,
        [id],
      );
      expect(w.balanceMilli).toBe(0);
      const [a] = await sql<any>(
        `SELECT "freePostsRemaining" FROM "FreeAllowance" WHERE "userId"=$1`,
        [id],
      );
      expect(a.freePostsRemaining).toBe(2);
      expect(
        (await sql(`SELECT 1 FROM "UserSettings" WHERE "userId"=$1`, [id]))
          .length,
      ).toBe(1);
      expect(
        (await sql(`SELECT 1 FROM "UserCategory" WHERE "userId"=$1`, [id]))
          .length,
      ).toBe(3);
      expect(
        (
          await sql<any>(`SELECT tag FROM "NewsTagFollow" WHERE "userId"=$1`, [
            id,
          ])
        ).map((r) => r.tag),
      ).toEqual(["VERIFIED_NEWS"]);
      // The phone number itself is stored nowhere.
      expect(
        (await sql(`SELECT 1 FROM "User" u WHERE u::text LIKE '%8099990001%'`))
          .length,
      ).toBe(0);
      // GET /me now returns the same person.
      const again = await h.http().get("/api/v1/me").set(auth(t)).expect(200);
      expect(again.body.id).toBe(id);
      expect(again.body.profileComplete).toBe(true);
    });

    it("a client-sent id, wawuId or role in the body is refused: the token is the only identity", async () => {
      const t = h.token("create-attack");
      for (const extra of [
        { id: "0190a000-0000-7000-8000-000000000001" },
        { wawuId: "someone-else" },
        { sub: "someone-else" },
        { roles: ["ADMIN"] },
        { userId: "0190a000-0000-7000-8000-000000000001" },
      ]) {
        const res = await h
          .http()
          .post("/api/v1/me")
          .set(auth(t))
          .send(createBody(cats, { handle: "attack.one", ...extra }))
          .expect(422);
        expect(res.body.error.code).toBe("VALIDATION_FAILED");
      }
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='create-attack'`))
          .length,
      ).toBe(0);
    });

    it("is idempotent: the same body returns the same Me; a different handle is 409 PROFILE_EXISTS", async () => {
      const t = h.token("create-2");
      const body = createBody(cats, { handle: "repeat.me" });
      const a = await h
        .http()
        .post("/api/v1/me")
        .set(auth(t))
        .send(body)
        .expect(201);
      const b = await h
        .http()
        .post("/api/v1/me")
        .set(auth(t))
        .send(body)
        .expect(201);
      expect(b.body.id).toBe(a.body.id);
      const c = await h
        .http()
        .post("/api/v1/me")
        .set(auth(t))
        .send(createBody(cats, { handle: "other.name" }))
        .expect(409);
      expect(c.body.error.details.reason).toBe("PROFILE_EXISTS");
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='create-2'`)).length,
      ).toBe(1);
    });

    it("rejects: under 18, terms, rules, fewer than 3 topics, unknown topic, bad country", async () => {
      const t = h.token("create-3");
      const post = (over: Record<string, unknown>) =>
        h
          .http()
          .post("/api/v1/me")
          .set(auth(t))
          .send(createBody(cats, { handle: "reject.me", ...over }));
      expect(
        (await post({ ageConfirmed: false }).expect(403)).body.error.code,
      ).toBe("AGE_CONFIRMATION_REQUIRED");
      expect(
        (await post({ termsAccepted: false }).expect(422)).body.error.details
          .fields[0].path,
      ).toBe("termsAccepted");
      expect(
        (await post({ rulesAccepted: false }).expect(422)).body.error.details
          .fields[0].path,
      ).toBe("rulesAccepted");
      expect(
        (await post({ categoryIds: cats.slice(0, 2) }).expect(400)).body.error
          .code,
      ).toBe("MIN_TOPICS");
      expect(
        (await post({ categoryIds: [cats[0], cats[0], cats[0]] }).expect(400))
          .body.error.code,
      ).toBe("MIN_TOPICS");
      expect(
        (
          await post({
            categoryIds: [
              ...cats.slice(0, 2),
              "0190a000-0000-7000-8000-000000000009",
            ],
          }).expect(422)
        ).body.error.code,
      ).toBe("VALIDATION_FAILED");
      expect(
        (await post({ countryCode: "ZZ" }).expect(422)).body.error.details
          .fields[0].path,
      ).toBe("countryCode");
      expect(
        (await post({ handle: undefined }).expect(422)).body.error.code,
      ).toBe("VALIDATION_FAILED");
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='create-3'`)).length,
      ).toBe(0);
    });

    it("handle rules: reserved words, brand prefixes, shape and length are 422; taken is 409 HANDLE_TAKEN in any case", async () => {
      const t = h.token("create-4");
      const post = (handle: string) =>
        h
          .http()
          .post("/api/v1/me")
          .set(auth(t))
          .send(createBody(cats, { handle }));
      for (const bad of [
        "admin",
        "Admin",
        "voices",
        "voices.team",
        "wawu_support",
        "a.d.m.i.n",
        "ab",
        "x".repeat(21),
        "has space",
        "emoji\u{1F600}x",
        ".lead",
        "trail.",
        "dou..ble",
        "Sup_port",
      ]) {
        const res = await post(bad).expect(422);
        expect([bad, res.body.error.code]).toEqual([bad, "VALIDATION_FAILED"]);
      }
      const taken = await post("ADA.OKAFOR").expect(409);
      expect(taken.body.error.code).toBe("HANDLE_TAKEN");
    });

    it("one account per phone number: a second WAWU ID with the same phone is 409 CONFLICT", async () => {
      const phone = "+2348077770001";
      await signUp(h, "phone-a", "phone.a", cats, { phone });
      const res = await h
        .http()
        .post("/api/v1/me")
        .set(auth(h.token("phone-b", { phone })))
        .send(createBody(cats, { handle: "phone.b" }))
        .expect(409);
      expect(res.body.error.details.reason).toBe("PHONE_IN_USE");
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='phone-b'`)).length,
      ).toBe(0);
    });

    it("a handle race: 12 parallel sign-ups for one handle make exactly one account", async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          h
            .http()
            .post("/api/v1/me")
            .set(auth(h.token(`race-${i}`)))
            .send(createBody(cats, { handle: "race.handle" })),
        ),
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(11);
      for (const r of results.filter((r) => r.status === 409))
        expect(r.body.error.code).toBe("HANDLE_TAKEN");
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE handle='race.handle'`)).length,
      ).toBe(1);
      expect(
        (
          await sql(
            `SELECT 1 FROM "Wallet" w JOIN "User" u ON u.id=w."userId" WHERE u."wawuId" LIKE 'race-%'`,
          )
        ).length,
      ).toBe(1);
    });

    it("one person tapping twice at once (same sub, same body) makes one account and both calls succeed", async () => {
      const t = h.token("double-tap");
      const body = createBody(cats, { handle: "double.tap" });
      const rs = await Promise.all(
        Array.from({ length: 6 }, () =>
          h.http().post("/api/v1/me").set(auth(t)).send(body),
        ),
      );
      expect(rs.map((r) => r.status)).toEqual(Array(6).fill(201));
      expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
      expect(
        (await sql(`SELECT 1 FROM "User" WHERE "wawuId"='double-tap'`)).length,
      ).toBe(1);
    });

    it("records the referral when a valid code is sent and ignores an unknown one", async () => {
      const a = await signUp(h, "ref-a", "ref.a", cats);
      const b = await h
        .http()
        .post("/api/v1/me")
        .set(auth(h.token("ref-b")))
        .send(
          createBody(cats, {
            handle: "ref.b",
            referralCode: a.me.referralCode,
          }),
        )
        .expect(201);
      const rows = await sql<any>(
        `SELECT "referrerId" FROM "Referral" WHERE "referredId"=$1`,
        [b.body.id],
      );
      expect(rows[0].referrerId).toBe(a.me.id);
      await h
        .http()
        .post("/api/v1/me")
        .set(auth(h.token("ref-c")))
        .send(createBody(cats, { handle: "ref.c", referralCode: "NOSUCHCD" }))
        .expect(201);
    });
  });

  describe("phone hash", () => {
    it("is refreshed when the token's phone claim changes, and never to a number another account holds", async () => {
      const first = "+2348055550001";
      const second = "+2348055550002";
      const taken = "+2348055550003";
      const { me } = await signUp(h, "ph-1", "ph.one", cats, { phone: first });
      await signUp(h, "ph-2", "ph.two", cats, { phone: taken });
      const hash = async () =>
        (
          await sql<any>(`SELECT "phoneHash" FROM "User" WHERE id=$1`, [me.id])
        )[0].phoneHash;
      expect(await hash()).toBe(sha(first));
      await h
        .http()
        .get("/api/v1/me")
        .set(auth(h.token("ph-1", { phone: second })))
        .expect(200);
      expect(await hash()).toBe(sha(second));
      // a guarded route refreshes it too
      await h
        .http()
        .get("/api/v1/me/settings")
        .set(auth(h.token("ph-1", { phone: first })))
        .expect(200);
      expect(await hash()).toBe(sha(first));
      // another account's number: kept as it was
      await h
        .http()
        .get("/api/v1/me")
        .set(auth(h.token("ph-1", { phone: taken })))
        .expect(200);
      expect(await hash()).toBe(sha(first));
      // no phone claim: unchanged
      await h
        .http()
        .get("/api/v1/me")
        .set(auth(h.token("ph-1", { phone: undefined })))
        .expect(200);
      expect(await hash()).toBe(sha(first));
    });
  });

  describe("phone formats (M1)", () => {
    it("one phone typed any way is one account: spaces, dashes, 0-prefix, bare 234, 00 prefix", async () => {
      await signUp(h, "fmt-0", "fmt.zero", cats, {
        phone: "+2348033330001",
        country: "NG",
      });
      const [u0] = await sql<any>(
        `SELECT "phoneHash" FROM "User" WHERE "wawuId"='fmt-0'`,
      );
      expect(u0.phoneHash).toBe(sha("+2348033330001"));
      let i = 0;
      for (const phone of [
        "+234 803 333 0001",
        "+234-803-333-0001",
        "08033330001",
        "2348033330001",
        "0803 333 0001",
        "00234 803 333 0001",
        "(0803) 333-0001",
      ]) {
        const res = await h
          .http()
          .post("/api/v1/me")
          .set(auth(h.token(`fmt-${++i}`, { phone, country: "NG" })))
          .send(createBody(cats, { handle: `fmt.dup${i}` }));
        expect([phone, res.status, res.body.error?.details?.reason]).toEqual([
          phone,
          409,
          "PHONE_IN_USE",
        ]);
      }
      // a trunk 0 kept after the dial code is the same number
      for (const phone of [
        "+234 (0) 803 333 0001",
        "+23408033330001",
        "234 0803 333 0001",
        "+234 0 803 333 0001",
      ]) {
        const res = await h
          .http()
          .post("/api/v1/me")
          .set(auth(h.token(`fmt-t${++i}`, { phone, country: "NG" })))
          .send(createBody(cats, { handle: `fmt.trunk${i}` }));
        expect([phone, res.status, res.body.error?.details?.reason]).toEqual([
          phone,
          409,
          "PHONE_IN_USE",
        ]);
      }
      // another launch country: national 0 uses the country claim
      await signUp(h, "fmt-gh", "fmt.gh", cats, {
        phone: "0244123456",
        country: "GH",
      });
      const [gh] = await sql<any>(
        `SELECT "phoneHash" FROM "User" WHERE "wawuId"='fmt-gh'`,
      );
      expect(gh.phoneHash).toBe(sha("+233244123456"));
      for (const [phone, country] of [
        ["+233 (0) 244 123 456", "GH"],
        ["+2330244123456", "GH"],
        ["233 0244 123 456", "GH"],
        ["+233 244 123 456", "GH"],
        ["233244123456", "GH"],
      ]) {
        const res = await h
          .http()
          .post("/api/v1/me")
          .set(auth(h.token(`fmt-g${++i}`, { phone, country })))
          .send(createBody(cats, { handle: `fmt.gh${i}` }));
        expect([phone, res.status]).toEqual([phone, 409]);
      }
      await signUp(h, "fmt-ke", "fmt.ke", cats, {
        phone: "0712345678",
        country: "KE",
      });
      for (const [phone, country] of [
        ["+254 (0) 712 345 678", "KE"],
        ["+2540712345678", "KE"],
        ["254 0712 345 678", "KE"],
        ["+254712345678", "KE"],
        ["254712345678", "KE"],
      ]) {
        const res = await h
          .http()
          .post("/api/v1/me")
          .set(auth(h.token(`fmt-k${++i}`, { phone, country })))
          .send(createBody(cats, { handle: `fmt.ke${i}` }));
        expect([phone, res.status]).toEqual([phone, 409]);
      }
      // a different number is a different account
      await signUp(h, "fmt-other", "fmt.other", cats, {
        phone: "08033330002",
        country: "NG",
      });
    });

    it("normalisePhone and the hash are not a plain SHA-256", async () => {
      const { normalisePhone } = await import("../../src/me/phone.js");
      expect(normalisePhone("0803 123 4567")).toBe("+2348031234567");
      expect(normalisePhone("2547 12 345 678", "KE")).toBe("+254712345678");
      expect(normalisePhone("abc")).toBeNull();
      expect(normalisePhone("+234 (0) 809 999 0001")).toBe("+2348099990001");
      expect(normalisePhone("+23408099990001")).toBe("+2348099990001");
      expect(normalisePhone("234 0809 999 0001")).toBe("+2348099990001");
      expect(normalisePhone("+27 (0) 82 123 4567")).toBe("+27821234567");
      expect(normalisePhone("+2348099990001")).toBe("+2348099990001");
      expect(normalisePhone("+2348099990002")).not.toBe("+2348099990001");
      expect(sha("+2348033330001")).not.toBe(
        createHash("sha256").update("+2348033330001").digest("hex"),
      );
    });

    it("production refuses to boot without VOICES_PHONE_PEPPER", async () => {
      const { phonePepper } = await import("../../src/me/phone.js");
      expect(() => phonePepper({ NODE_ENV: "production" })).toThrow(
        /VOICES_PHONE_PEPPER/,
      );
      expect(
        phonePepper({
          NODE_ENV: "production",
          VOICES_PHONE_PEPPER: "x",
        }),
      ).toBe("x");
    });
  });

  describe("suspended and banned accounts read but cannot write", () => {
    it("403 ACCOUNT_SUSPENDED with details.until on every write; reads stay open; an ended suspension writes again", async () => {
      const { token, me } = await signUp(h, "susp-1", "susp.one", cats);
      const until = new Date(Date.now() + 3600_000);
      await sql(
        `UPDATE "User" SET status='SUSPENDED', "suspendedUntil"=$2 WHERE id=$1`,
        [me.id, until],
      );
      await h.http().get("/api/v1/me/settings").set(auth(token)).expect(200);
      await h.http().get("/api/v1/me").set(auth(token)).expect(200);
      const w = await h
        .http()
        .patch("/api/v1/me/settings")
        .set(auth(token))
        .send({ dataSaver: true })
        .expect(403);
      expect(w.body.error.code).toBe("ACCOUNT_SUSPENDED");
      expect(w.body.error.details.until).toBe(until.toISOString());
      await h
        .http()
        .patch("/api/v1/me/profile")
        .set(auth(token))
        .send({ bio: "x" })
        .expect(403);
      await h
        .http()
        .put(`/api/v1/me/blocks/${me.id}`)
        .set(auth(token))
        .expect(403);
      await sql(
        `UPDATE "User" SET "suspendedUntil"=now() - interval '1 minute' WHERE id=$1`,
        [me.id],
      );
      await h
        .http()
        .patch("/api/v1/me/settings")
        .set(auth(token))
        .send({ dataSaver: true })
        .expect(200);
      await sql(
        `UPDATE "User" SET status='BANNED', "suspendedUntil"=NULL WHERE id=$1`,
        [me.id],
      );
      const b = await h
        .http()
        .patch("/api/v1/me/settings")
        .set(auth(token))
        .send({ dataSaver: false })
        .expect(403);
      expect(b.body.error.details.until).toBeNull();
    });
  });

  describe("PATCH /me/profile", () => {
    it("edits the profile and returns it", async () => {
      const { token, me } = await signUp(h, "prof-1", "prof.one", cats);
      const res = await h
        .http()
        .patch("/api/v1/me/profile")
        .set(auth(token))
        .send({
          displayName: "Ada O.",
          bio: "Lagos",
          state: "Lagos",
          city: "Ikeja",
          languages: ["en", "yo"],
          countryCode: "gh",
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: me.id,
        displayName: "Ada O.",
        bio: "Lagos",
        state: "Lagos",
        city: "Ikeja",
        languages: ["en", "yo"],
        countryCode: "GH",
      });
      const clear = await h
        .http()
        .patch("/api/v1/me/profile")
        .set(auth(token))
        .send({ bio: null, city: null })
        .expect(200);
      expect(clear.body.bio).toBeNull();
      expect(clear.body.city).toBeNull();
    });

    it("changing the handle: taken is 409, reserved is 422, free works, case-insensitive", async () => {
      const { token } = await signUp(h, "prof-2", "prof.two", cats);
      const patch = (handle: string) =>
        h.http().patch("/api/v1/me/profile").set(auth(token)).send({ handle });
      expect((await patch("PROF.ONE").expect(409)).body.error.code).toBe(
        "HANDLE_TAKEN",
      );
      await patch("admin").expect(422);
      expect((await patch("Prof.Renamed").expect(200)).body.handle).toBe(
        "prof.renamed",
      );
    });

    it("refuses an unknown field, an id in the body, a bad country and over-long text", async () => {
      const { token } = await signUp(h, "prof-3", "prof.three", cats);
      const patch = (b: object) =>
        h.http().patch("/api/v1/me/profile").set(auth(token)).send(b);
      await patch({ id: "0190a000-0000-7000-8000-000000000001" }).expect(422);
      await patch({ roles: ["ADMIN"] }).expect(422);
      await patch({ status: "ACTIVE" }).expect(422);
      await patch({ countryCode: "ZZ" }).expect(422);
      await patch({ bio: "x".repeat(281) }).expect(422);
    });

    it("the avatar must be my own finished upload: another person's file id is refused", async () => {
      const a = await signUp(h, "av-a", "av.a", cats);
      const b = await signUp(h, "av-b", "av.b", cats);
      const mk = async (owner: string, confirmed: boolean, kind = "AVATAR") =>
        (
          await sql<any>(
            `INSERT INTO "StoredFile"(id, "ownerId", kind, key, mime, bytes, "confirmedAt") VALUES (gen_random_uuid(), $1, $2::"FileKind", $3, 'image/jpeg', 10, $4) RETURNING id`,
            [
              owner,
              kind,
              `avatars/${Math.random()}`,
              confirmed ? new Date() : null,
            ],
          )
        )[0].id as string;
      const theirs = await mk(b.me.id, true);
      const unconfirmed = await mk(a.me.id, false);
      const wrongKind = await mk(a.me.id, true, "RESULT_PHOTO");
      const mine = await mk(a.me.id, true);
      const set = (id: string | null) =>
        h
          .http()
          .patch("/api/v1/me/profile")
          .set(auth(a.token))
          .send({ avatarFileId: id });
      for (const bad of [
        theirs,
        unconfirmed,
        wrongKind,
        "0190a000-0000-7000-8000-0000000000aa",
      ])
        expect([bad, (await set(bad)).status]).toEqual([bad, 422]);
      await set(mine).expect(200);
      const [u] = await sql<any>(
        `SELECT "avatarFileId" FROM "User" WHERE id=$1`,
        [a.me.id],
      );
      expect(u.avatarFileId).toBe(mine);
      await set(null).expect(200);
    });

    it("the voice card must be my own READY VOICE_CARD clip of 10 seconds or less", async () => {
      const a = await signUp(h, "vc-a", "vc.a", cats);
      const b = await signUp(h, "vc-b", "vc.b", cats);
      const mk = async (
        owner: string,
        purpose: string,
        status: string,
        durationMs = 8000,
      ) =>
        (
          await sql<any>(
            `INSERT INTO "VoiceClip"(id, "ownerId", purpose, status, "rawKey", "rawMime", "playKey", "playMime", "durationMs", "maxDurationMs")
             VALUES (gen_random_uuid(), $1, $2::"VoiceClipPurpose", $3::"VoiceClipStatus", $4, 'audio/webm', 'play/x', 'audio/mp4', $5, 10000) RETURNING id`,
            [owner, purpose, status, `raw/${Math.random()}`, durationMs],
          )
        )[0].id as string;
      const theirs = await mk(b.me.id, "VOICE_CARD", "READY");
      const notReady = await mk(a.me.id, "VOICE_CARD", "PROCESSING");
      const wrongPurpose = await mk(a.me.id, "ANSWER", "READY");
      const tooLong = await mk(a.me.id, "VOICE_CARD", "READY", 30000);
      const mine = await mk(a.me.id, "VOICE_CARD", "READY");
      const set = (id: string | null) =>
        h
          .http()
          .patch("/api/v1/me/profile")
          .set(auth(a.token))
          .send({ voiceCardClipId: id });
      for (const bad of [theirs, notReady, wrongPurpose, tooLong])
        expect([bad, (await set(bad)).status]).toEqual([bad, 422]);
      const ok = await set(mine).expect(200);
      expect(ok.body.voiceCard).toMatchObject({
        id: mine,
        status: "READY",
        durationMs: 8000,
      });
      // the same clip cannot become a second person's card
      await h
        .http()
        .patch("/api/v1/me/profile")
        .set(auth(b.token))
        .send({ voiceCardClipId: mine })
        .expect(422);
    });
  });

  describe("settings, topics, tags", () => {
    it("GET and PATCH /me/settings with validation", async () => {
      const { token } = await signUp(h, "set-1", "set.one", cats);
      const g = await h
        .http()
        .get("/api/v1/me/settings")
        .set(auth(token))
        .expect(200);
      expect(g.body).toEqual({
        language: "en",
        dataSaver: false,
        theme: "system",
        timezone: "Africa/Lagos",
        quietHoursStart: null,
        quietHoursEnd: null,
        notifyDailyQuestion: true,
        notifyWeeklyTopic: true,
        notifyReplies: true,
        notifyReactions: true,
        notifyPollResults: true,
        notifyFlashPolls: false,
        notifyCategoryAlerts: true,
        dailyQuestionMinute: 480,
        shareMyWord: true,
      });
      const p = await h
        .http()
        .patch("/api/v1/me/settings")
        .set(auth(token))
        .send({
          theme: "dark",
          dataSaver: true,
          quietHoursStart: 1320,
          quietHoursEnd: 360,
          notifyReactions: false,
          dailyQuestionMinute: 540,
          timezone: "Africa/Accra",
        })
        .expect(200);
      expect(p.body).toMatchObject({
        theme: "dark",
        dataSaver: true,
        quietHoursStart: 1320,
        quietHoursEnd: 360,
        notifyReactions: false,
        dailyQuestionMinute: 540,
        timezone: "Africa/Accra",
      });
      const patch = (b: object) =>
        h.http().patch("/api/v1/me/settings").set(auth(token)).send(b);
      await patch({ theme: "neon" }).expect(422);
      await patch({ timezone: "Mars/Olympus" }).expect(422);
      await patch({ quietHoursStart: 2000 }).expect(422);
      await patch({ dailyQuestionMinute: -1 }).expect(422);
      await patch({ userId: "x" }).expect(422);
      const cleared = await patch({
        quietHoursStart: null,
        quietHoursEnd: null,
      }).expect(200);
      expect(cleared.body.quietHoursStart).toBeNull();
    });

    it("PUT /me/categories: at least 3 (400 MIN_TOPICS), real topics only, replaces the set", async () => {
      const { token, me } = await signUp(h, "cat-1", "cat.one", cats);
      const put = (list: { categoryId: string; alertsOn: boolean }[]) =>
        h
          .http()
          .put("/api/v1/me/categories")
          .set(auth(token))
          .send({ categories: list });
      expect(
        (
          await put(
            cats
              .slice(0, 2)
              .map((categoryId) => ({ categoryId, alertsOn: true })),
          ).expect(400)
        ).body.error.code,
      ).toBe("MIN_TOPICS");
      await put(
        [...cats.slice(0, 2), "0190a000-0000-7000-8000-000000000009"].map(
          (categoryId) => ({ categoryId, alertsOn: true }),
        ),
      ).expect(422);
      const ok = await put(
        cats
          .slice(1, 5)
          .map((categoryId, i) => ({ categoryId, alertsOn: i % 2 === 0 })),
      ).expect(200);
      expect(ok.body.categories).toHaveLength(4);
      const rows = await sql<any>(
        `SELECT "categoryId","alertsOn" FROM "UserCategory" WHERE "userId"=$1`,
        [me.id],
      );
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.categoryId)).not.toContain(cats[0]);
      const got = await h
        .http()
        .get("/api/v1/me/categories")
        .set(auth(token))
        .expect(200);
      expect(got.body.categories).toHaveLength(4);
      await sql(`UPDATE "Category" SET active=false WHERE id=$1`, [cats[4]]);
      await put(
        cats.slice(1, 5).map((categoryId) => ({ categoryId, alertsOn: true })),
      ).expect(422);
      await sql(`UPDATE "Category" SET active=true WHERE id=$1`, [cats[4]]);
    });

    it("PUT /me/tag-follows always keeps Verified News", async () => {
      const { token, me } = await signUp(h, "tag-1", "tag.one", cats);
      const res = await h
        .http()
        .put("/api/v1/me/tag-follows")
        .set(auth(token))
        .send({ tags: ["GOSSIP"] })
        .expect(200);
      expect(res.body.tags.sort()).toEqual(["GOSSIP", "VERIFIED_NEWS"]);
      const none = await h
        .http()
        .put("/api/v1/me/tag-follows")
        .set(auth(token))
        .send({ tags: [] })
        .expect(200);
      expect(none.body.tags).toEqual(["VERIFIED_NEWS"]);
      expect(
        (
          await sql<any>(`SELECT tag FROM "NewsTagFollow" WHERE "userId"=$1`, [
            me.id,
          ])
        ).map((r) => r.tag),
      ).toEqual(["VERIFIED_NEWS"]);
      await h
        .http()
        .put("/api/v1/me/tag-follows")
        .set(auth(token))
        .send({ tags: ["NOPE"] })
        .expect(422);
    });
  });

  describe("allowances inside GET /me", () => {
    it("Me carries the allowances read from the database; costs follow ConfigEntry rows", async () => {
      const { token, me } = await signUp(h, "al-1", "al.one", cats);
      await sql(
        `UPDATE "FreeAllowance" SET "freePostsRemaining"=4 WHERE "userId"=$1`,
        [me.id],
      );
      await sql(`UPDATE "Wallet" SET "balanceMilli"=12500 WHERE "userId"=$1`, [
        me.id,
      ]);
      const day = new Date().toLocaleDateString("en-CA", {
        timeZone: "Africa/Lagos",
      });
      await sql(
        `INSERT INTO "UsageCounter"("userId", day, action, used) VALUES ($1, $2, 'REACTION', 7), ($1, $2, 'VOTE', 3)`,
        [me.id, day],
      );
      await sql(
        `INSERT INTO "ConfigEntry"(key,"valueJson","updatedAt") VALUES ('cost.text_post_milli','700'::jsonb, now())`,
      );
      const res = await h.http().get("/api/v1/me").set(auth(token)).expect(200);
      expect(res.body.allowances).toMatchObject({
        freePostsRemaining: 4,
        balanceMilli: 12500,
        freeReactionsLeftToday: 13,
        freeVotesLeftToday: 0,
        maxVoiceSeconds: 60,
      });
      expect(res.body.allowances.costs.textPostMilli).toBe(700);
      await sql(`DELETE FROM "ConfigEntry" WHERE key='cost.text_post_milli'`);
      // SHARED-1a item 4: GET /me/allowance is served now (it was unserved, 404, until the units module landed)
      const al = await h
        .http()
        .get("/api/v1/me/allowance")
        .set(auth(token))
        .expect(200);
      expect(al.body).toEqual({
        ...res.body.allowances,
        costs: expect.any(Object),
      });
      expect(al.body.costs.textPostMilli).toBe(5000);
    });
  });

  describe("GET /me/handle-check", () => {
    it("says available, taken, or why not; the caller's own handle is available", async () => {
      const { token } = await signUp(h, "hc-1", "hc.one", cats);
      const chk = (hd: string) =>
        h
          .http()
          .get(`/api/v1/me/handle-check?handle=${encodeURIComponent(hd)}`)
          .set(auth(token));
      expect((await chk("free.name").expect(200)).body).toEqual({
        handle: "free.name",
        available: true,
      });
      expect((await chk("HC.One").expect(200)).body).toEqual({
        handle: "hc.one",
        available: true,
      });
      expect((await chk("ada.okafor").expect(200)).body).toMatchObject({
        available: false,
        reason: "TAKEN",
      });
      expect((await chk("admin").expect(200)).body).toMatchObject({
        available: false,
        reason: "RESERVED",
      });
      expect((await chk("ab").expect(200)).body).toMatchObject({
        available: false,
        reason: "TOO_SHORT",
      });
      expect((await chk("bad name").expect(200)).body).toMatchObject({
        available: false,
        reason: "BAD_CHARACTERS",
      });
      await h
        .http()
        .get("/api/v1/me/handle-check")
        .set(auth(token))
        .expect(422);
    });

    it("is rate limited: the 301st call in a minute is 429 RATE_LIMITED with Retry-After (LCH-09: was the 31st)", async () => {
      const t = h.token("hc-rate");
      let last: any;
      for (let i = 0; i < 301; i++)
        last = await h
          .http()
          .get("/api/v1/me/handle-check?handle=rate.test")
          .set(auth(t));
      expect(last.status).toBe(429);
      expect(last.body.error.code).toBe("RATE_LIMITED");
      expect(last.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(last.headers["retry-after"]).toBeTruthy();
    });
  });
});
