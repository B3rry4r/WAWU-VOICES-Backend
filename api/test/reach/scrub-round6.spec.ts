import { scrub } from "../../src/reach/weekly-draft";
import { cleanModelText } from "../../src/admin/summary-draft";
import {
  ownOrdinary,
  platforms,
  platformTemplates,
  round3Gone,
  round4Gone,
  starters,
} from "./scrub-fixtures";

const MARK = "[removed]";

describe("V-FIX-C round 6: F4 an email goes whatever script it is in", () => {
  for (const g of [
    "jane@müller.de",
    "jane@пример.рф",
    "jane@例え.jp",
    "jane@ех.com",
    "jane@café.com",
    "ジェーン@example.com",
    "jane@xn--mller-kva.de",
    "jane@@example.com",
  ])
    it(`removes ${g}`, () => {
      expect(scrub(`mail ${g} now`)).toBe("mail now");
      expect(cleanModelText(`mail ${g} now`)).toBe(`mail ${MARK} now`);
    });
  it("a handle in any script goes", () => {
    expect(scrub("find @жанна_ok now")).toBe("find now");
  });
});

describe("V-FIX-C round 6: M1 nothing a person could read disappears without the mark", () => {
  const kept: [string, string][] = [
    ["People said <very angry> about it.", "People said very angry about it."],
    ["He wrote <sad> in the chat.", "He wrote sad in the chat."],
    ["We want <everyone> to vote.", "We want everyone to vote."],
    ["Press <Enter> to continue.", "Press Enter to continue."],
    ["The sign said <Closed> today.", "The sign said Closed today."],
    ["If x <y and z> w then stop.", "If x y and z w then stop."],
    ["If x <b and c> d then stop.", "If x b and c d then stop."],
    ["<my cousin> said hi.", "my cousin said hi."],
    ["x < y and y > z.", "x y and y z."],
    ["Growth was <5% last year.", "Growth was 5% last year."],
    ["Aged <18 are barred.", "Aged 18 are barred."],
    ["1 < 2.", "1 2."],
  ];
  for (const [i, o] of kept)
    it(`keeps the words: ${i}`, () => expect(cleanModelText(i)).toBe(o));
  it("real markup tags are dropped, their words stay", () => {
    expect(cleanModelText("<b>bold</b> and <i>slanted</i>")).toBe(
      "bold and slanted",
    );
    expect(cleanModelText('<a href="x">link</a> now')).toBe("link now");
    expect(cleanModelText("pay<br/>now <p>ok</p>")).toBe("pay now ok");
    expect(cleanModelText("<script>alert(1)</script> pay")).toBe(
      "alert(1) pay",
    );
    expect(cleanModelText("<!-- hidden --> pay")).toBe("pay");
  });
  it("a text cut at 600 characters ends with the mark", () => {
    const out = cleanModelText("Rice is dear. ".repeat(60));
    expect(out.length).toBe(600);
    expect(out.endsWith(MARK)).toBe(true);
    expect(cleanModelText("Rice is dear. ".repeat(10))).toBe(
      "Rice is dear. ".repeat(10).trim(),
    );
  });
});

describe("V-FIX-C round 6: M2 a short host with a path goes whole", () => {
  for (const g of [
    "t.me/janedoe",
    "x.com/janedoe",
    "g.co/janedoe",
    "m.me/janedoe",
    "t.co/abc123",
    "x.co/abc",
    "a.co/d/abcdef",
  ])
    it(`removes ${g}`, () => {
      expect(scrub(`see ${g} ok`)).toBe("see ok");
      expect(cleanModelText(`see ${g} ok`)).toBe(`see ${MARK} ok`);
    });
  it("wa.me with a number goes whole too (the number is its own match in the model path)", () => {
    expect(scrub("see wa.me/2348031234567 ok")).toBe("see ok");
    const out = cleanModelText("see wa.me/2348031234567 ok");
    expect(out).toContain(MARK);
    expect(out).not.toMatch(/\d|wa\.me/);
  });
  it("prices, titles and versions still stay", () => {
    for (const t of [
      "Petrol is N617.50/litre.",
      "Dr.Ade/Dr.Bola attended.",
      "Mr.Bello/Mrs.Bello came.",
      "Use v1.2/final please.",
      "It is 9 a.m/p.m. here.",
    ])
      expect(scrub(t)).toBe(t);
  });
});

describe("V-FIX-C round 6: LOW fixes that touch no ordinary sentence", () => {
  it("scheme with one backslash or slash, and (415)555-0143", () => {
    expect(scrub("see https:\\\\evil.zz ok")).toBe("see ok");
    expect(scrub("see https:/evil.zz ok")).toBe("see ok");
    expect(scrub("call (415)555-0143 now")).toBe("call now");
  });
});

describe("V-FIX-C round 6: earlier tables and ordinary sentences, both paths", () => {
  it("rounds 3 and 4 'must go' strings are still removed, with the mark in the model path", () => {
    for (const g of [...round3Gone, ...round4Gone]) {
      expect(scrub(`see ${g} ok`)).not.toMatch(/\d{4,}|jane|evil/);
      expect(cleanModelText(`see ${g} ok`)).toContain(MARK);
    }
  });
  it("300 ordinary sentences are unchanged", () => {
    const all = [
      ...ownOrdinary,
      ...starters.map((s) => `Our people suffer. ${s} should unite.`),
      ...platforms.flatMap((p) => platformTemplates.map((f) => f(p))),
      "I use whatsapp daily.",
      "Twitter is dead.",
      "Let the police handle that.",
      "Mark the x here.",
      "Dem talk am for wa group.",
      "Buses leave at 08:30, 09:30, 10:30.",
      "Petrol now sells at N617.50/litre.",
      "I can handle 10k users.",
    ];
    expect(all.length).toBeGreaterThanOrEqual(300);
    for (const t of all) {
      expect(scrub(t)).toBe(t);
      expect(cleanModelText(t)).toBe(t);
    }
  });
});
