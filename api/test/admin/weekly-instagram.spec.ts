import { instagramSvgs, plain, zipStored } from "../../src/reach/weekly-insta";
import { world, type World } from "./harness";

/** PNG width and height live in the IHDR chunk. */
const plainish = (s: string) => plain(s);
const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe("LCH-13: the weekly report as Instagram pictures", () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  async function report(status: "DRAFT" | "PUBLISHED", over = {}) {
    const topic = await w.prisma.topic.create({
      data: {
        weekNumber: status === "PUBLISHED" ? 41 : 42,
        title: "How do you feel about Nigeria right now?",
        startsOn: new Date("2026-11-15T00:00:00Z"),
        endsOn: new Date("2026-11-21T00:00:00Z"),
        status: "CLOSED",
        questionCount: 0,
      },
    });
    return w.prisma.weeklyReport.create({
      data: {
        topicId: topic.id,
        status,
        headline: "Hopeful, but tired of waiting.",
        mood: "Hopeful, but tired of waiting.",
        themes: [{ label: "Prices rising every month", count: 770 }],
        emotions: [
          { name: "Hopeful", share: 38, change: 2 },
          { name: "Angry", share: 31, change: -1 },
        ],
        pollSummary: { line: "41% A stable naira led the vote" },
        basedOnVoices: 2480,
        basedOnVotes: 9700,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
        ...over,
      } as never,
    });
  }

  it("draws the carousel at 1080x1350 and the Story at 1080x1920, as a zip and one file each", async () => {
    const r = await report("PUBLISHED");
    const url = `/api/v1/admin/weekly-reports/${r.id}/instagram`;
    const res = await w.h
      .http()
      .get(url)
      .set(w.editor.auth)
      .buffer(true)
      .parse((rs, cb) => {
        const c: Buffer[] = [];
        rs.on("data", (d: Buffer) => c.push(d));
        rs.on("end", () => cb(null, Buffer.concat(c)));
      })
      .expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
    const zip = res.body as Buffer;
    // read the stored entries back
    const names: string[] = [];
    let off = 0;
    while (zip.readUInt32LE(off) === 0x04034b50) {
      const len = zip.readUInt32LE(off + 18);
      const nl = zip.readUInt16LE(off + 26);
      names.push(zip.subarray(off + 30, off + 30 + nl).toString());
      const data = zip.subarray(off + 30 + nl, off + 30 + nl + len);
      expect(data.subarray(1, 4).toString()).toBe("PNG");
      off += 30 + nl + len;
    }
    expect(names.at(-1)).toBe("story.png");
    expect(names.filter((n) => n.startsWith("carousel-")).length).toBe(
      names.length - 1,
    );
    expect(names.length).toBeGreaterThanOrEqual(4);
    const one = await w.h
      .http()
      .get(`${url}/carousel-1.png`)
      .set(w.editor.auth)
      .expect(200);
    expect(size(one.body as Buffer)).toEqual([1080, 1350]);
    const story = await w.h
      .http()
      .get(`${url}/story.png`)
      .set(w.editor.auth)
      .expect(200);
    expect(size(story.body as Buffer)).toEqual([1080, 1920]);
    await w.h.http().get(`${url}/nope.png`).set(w.editor.auth).expect(404);
  });

  it("is staff only, and only for a published report", async () => {
    const draft = await report("DRAFT");
    const pub = await w.prisma.weeklyReport.findFirstOrThrow({
      where: { status: "PUBLISHED" },
    });
    const get = (id: string, who?: { auth: Record<string, string> }) => {
      const r = w.h.http().get(`/api/v1/admin/weekly-reports/${id}/instagram`);
      return who ? r.set(who.auth) : r;
    };
    await get(pub.id).expect(401);
    await get(pub.id, w.plain).expect(403);
    await get(pub.id, w.moderator).expect(403);
    await get(pub.id, w.adManager).expect(403);
    await get(draft.id, w.editor).expect(409);
    await get("00000000-0000-7000-8000-000000000000", w.editor).expect(404);
    await get(pub.id, w.admin).expect(200);
  });

  it("the words on the pictures are the approved report's, nothing invented, no em-dashes or curly quotes", () => {
    const input = {
      weekNumber: 3,
      topicTitle: "Topic words",
      headline: "Prices \u2014 still \u201Chigh\u201D",
      mood: "Mood line",
      themes: [{ label: "Theme one", count: 12480 }],
      emotions: [{ name: "Angry", share: 61.4 }],
      poll: { pct: 41, text: "A stable naira" },
      quotes: [{ excerpt: "Quote words", placeLabel: "A voice from Lagos" }],
      basedOnVoices: 12480,
      basedOnVotes: 1,
      host: "usevoices.com",
    };
    const words = instagramSvgs(input)
      .flatMap((s) => [...s.matchAll(/<text [^>]*>([^<]*)<\/text>/g)])
      .map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    const joined = words.join("\n");
    // the report's own words and numbers appear as the report shows them
    for (const t of [
      "Topic words",
      "Mood line",
      "Theme one",
      "A stable naira",
      "Quote words",
      "A voice from Lagos",
      "12,480",
      "Angry 61%",
    ])
      expect(joined).toContain(t);
    expect(joined).not.toMatch(/[\u2014\u2013\u2018\u2019\u201C\u201D]/);
    expect(joined).toContain('Prices, still "high"');
    // the only other words are the boards' own fixed lines
    const fixed = [
      /^THE WEEKLY REPORT/,
      /^THE MOOD$/,
      /^MAIN ARGUMENTS$/,
      /^THE POLL IN FULL$/,
      /^IN THEIR OWN WORDS$/,
      /^Swipe for what Nigerians said\. Full report: usevoices\.com\/weekly$/,
      /^Read it all and add your voice(: usevoices\.com\/weekly)?$/,
      /^usevoices\.com\/weekly$/,
      /\d \/ \d$/,
      /voices( this week)?( · [\d,]+ votes)?$/,
    ];
    const report = [
      input.topicTitle,
      input.headline,
      input.mood,
      "Theme one",
      "Angry",
      "Quote words",
      "A voice from Lagos",
      "A stable naira",
      "Prices, still",
      "high",
    ];
    for (const t of words) {
      const ok =
        fixed.some((f) => f.test(t)) ||
        /^[\d.,]+%$/.test(t) ||
        /^Week \d+ · /.test(t) ||
        /^Angry \d+%$/.test(t) ||
        report.some((r) => plainish(r).includes(t) || t.includes(plainish(r)));
      if (!ok) throw new Error(`invented text on a picture: ${t}`);
    }
  });

  it("zipStored round trips", () => {
    const z = zipStored([{ name: "a.txt", data: Buffer.from("hello") }]);
    expect(z.subarray(30 + 5, 30 + 5 + 5).toString()).toBe("hello");
    expect(plain("a \u2014 b \u2019 \u201Cc\u201D")).toBe('a, b \' "c"');
  });
});
