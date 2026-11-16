import { short, closesIn } from "../../src/mail/topic-mail.service";
import { renderMail } from "../../src/mail/mail-render";
import { countOf } from "../../src/mail/mail.service";

/** V-MAIL-COPY: pure unit spec, no database. "1 voice", and a subject never cut inside a word. */
const TODAY =
  "As a Nigerian, are you really fine? You dey okay? Or are you just tired of explaining?";
const SUBJECT = "Today’s question: {{question_short}}";

function c01(voices: number) {
  const r = renderMail("C01", SUBJECT, {
    first_name: "Ada",
    question_text: TODAY,
    question_short: short(TODAY),
    voice_count: countOf(voices, "voice", "voices"),
    closes_in: closesIn(6 * 24 * 3_600_000),
    topic_url: "https://x/q/1/speak",
    listen_url: "https://x/q/1",
    preferences_url: "https://x/p",
    unsubscribe_url: "https://x/u",
  });
  if (!r.ok) throw new Error(r.missing.join());
  return r;
}

describe("countOf", () => {
  it.each([
    [0, "0 voices"],
    [1, "1 voice"],
    [2, "2 voices"],
    [1204, "1,204 voices"],
  ])("%d -> %s", (n, out) => {
    expect(countOf(n, "voice", "voices")).toBe(out);
  });
});

describe("C01 voice line", () => {
  it("1 voice, in the text and the HTML", () => {
    const r = c01(1);
    expect(r.text).toContain("1 voice so far · closes in 6 days");
    expect(r.html).toContain("1 voice so far · closes in 6 days");
    expect(r.text).not.toContain("1 voices");
    expect(r.html).not.toContain("1 voices");
  });
  it("2 voices, 0 voices and 1,204 voices", () => {
    expect(c01(2).text).toContain("2 voices so far · closes in 6 days");
    expect(c01(2).html).toContain("2 voices so far · closes in 6 days");
    expect(c01(0).text).toContain("0 voices so far");
    expect(c01(1204).html).toContain("1,204 voices so far");
  });
});

describe("short()", () => {
  it("today's question is cut at a space, with no trailing mark but the ellipsis", () => {
    const s = short(TODAY);
    expect(s).toBe(
      "As a Nigerian, are you really fine? You dey okay? Or are you just…",
    );
    expect(s.length).toBeLessThanOrEqual(70);
    expect(TODAY.startsWith(s.slice(0, -1))).toBe(true);
    expect(TODAY[s.length - 1]).toBe(" ");
  });
  it("the real subject of 16 Nov no longer ends inside a word", () => {
    const r = renderMail("C01", SUBJECT, {
      first_name: "A",
      question_text: TODAY,
      question_short: short(TODAY),
      voice_count: "1 voice",
      closes_in: "1 day",
      topic_url: "u",
      listen_url: "u",
      preferences_url: "u",
      unsubscribe_url: "u",
    });
    if (!r.ok) throw new Error("missing");
    expect(r.subject).toBe(
      "Today’s question: As a Nigerian, are you really fine? You dey okay? Or are you just…",
    );
  });
  it("text at or under the limit is unchanged", () => {
    const at70 = "a".repeat(35) + " " + "b".repeat(34);
    expect(at70).toHaveLength(70);
    expect(short(at70)).toBe(at70);
    expect(short("Short one?")).toBe("Short one?");
    expect(short("  spaced \n out  ")).toBe("spaced out");
  });
  it("71 characters is cut, within 70 with the ellipsis", () => {
    const t = "word ".repeat(14) + "xy"; // 72
    const s = short(t);
    expect(s.length).toBeLessThanOrEqual(70);
    expect(s.endsWith("word…")).toBe(true);
  });
  it("drops a trailing comma, colon, semicolon, dash and opening quote or bracket", () => {
    const base = "x".repeat(40) + " ";
    for (const p of [",", ":", ";", "-", "–", "—", "“", "(", "["]) {
      const t = `${base}${p} ${"y".repeat(40)}`;
      const s = short(t);
      expect(s).toBe(`${"x".repeat(40)}…`);
    }
    // a question mark stays
    expect(short(`${"x".repeat(60)}? ${"y".repeat(20)}`)).toBe(
      `${"x".repeat(60)}?…`,
    );
  });
  it("one very long word is cut hard", () => {
    const s = short("z".repeat(200));
    expect(s).toBe(`${"z".repeat(69)}…`);
    expect(short(`ab ${"z".repeat(200)}`)).toBe(`ab ${"z".repeat(66)}…`);
  });
  it("’ and emoji are never split", () => {
    const t = `Don’t ${"w".repeat(30)} ${"😀".repeat(40)}`;
    const s = short(t);
    expect(s.length).toBeLessThanOrEqual(70);
    expect(s).not.toMatch(/[\uD800-\uDBFF]…$/u);
    expect(s).toBe(`Don’t ${"w".repeat(30)}…`);
    const hard = short("😀".repeat(100));
    expect(hard).not.toMatch(/[\uD800-\uDBFF]…$/u);
    expect(hard.endsWith("😀…")).toBe(true);
  });
});
