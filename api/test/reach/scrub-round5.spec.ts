import { scrub } from "../../src/reach/weekly-draft";
import { cleanModelText, REMOVED_NOTE } from "../../src/admin/summary-draft";
import {
  ownOrdinary,
  platforms,
  platformTemplates,
  round3Gone,
  round4Gone,
  separators,
  starters,
} from "./scrub-fixtures";

const MARK = "[removed]";
const ms = (f: () => unknown): number => {
  const t = process.hrtime.bigint();
  f();
  return Number(process.hrtime.bigint() - t) / 1e6;
};
const digitsLeft = (t: string) => (t.match(/\d/g) ?? []).length;

describe("V-FIX-C round 5: ruling A, the model path shows what it took out", () => {
  it("every match becomes one visible mark, spaces tidy", () => {
    expect(cleanModelText("mail jane@example.com now")).toBe(
      `mail ${MARK} now`,
    );
    expect(cleanModelText("call 0803 123 4567, 0701 234 5678.")).toBe(
      `call ${MARK}, ${MARK}.`,
    );
    expect(cleanModelText("see evil.tk and bio.link/jane")).toBe(
      `see ${MARK} and ${MARK}`,
    );
  });
  it("the posts path still deletes", () => {
    expect(scrub("mail jane@example.com now")).toBe("mail now");
  });
  it("all earlier 'must go' tables: nothing of the detail is left, and the mark is there", () => {
    for (const g of [...round3Gone, ...round4Gone]) {
      const out = cleanModelText(`see ${g} ok`);
      expect(out).toContain(MARK);
      expect(out.replace(/\[removed\]/g, "")).not.toMatch(/\d{3,}/);
    }
  });
  it("the note for the editor reuses the aiNote field and has no em-dash", () => {
    expect(REMOVED_NOTE).toBe(
      "Something that looked like a contact detail was taken out. Check the marked places.",
    );
    expect(REMOVED_NOTE).not.toMatch(/\u2014/);
  });
});

describe("V-FIX-C round 5: N1 every phone in a run goes", () => {
  const runs = [
    "0803 123 4567, 0701 234 5678",
    "0803 123 4567 / 0701 234 5678",
    "0803 123 4567 - 0701 234 5678",
    "0803 123 4567; 0701 234 5678",
    "0803 123 4567 | 0701 234 5678",
    "0803 123 4567 & 0701 234 5678",
    "0803-123-4567, 0701-234-5678",
    "0803.123.4567, 0701.234.5678",
    "0803 123 4567, 0701 234 5678, 0812 345 6789",
    "+234 803 123 4567, +234 701 234 5678",
    "+234 803 123 4567 / +234 701 234 5678",
    "0803 123 4567 0701 234 5678",
    "0803 123 4567\n0701 234 5678",
    "0803 123 4567,0701 234 5678",
    "0803 123 4567 (0701 234 5678)",
    "0803 1234567, 0701 2345678",
    "+1 202 555 0143, +44 7911 123456",
    "202-555-0143, 202-555-0199",
    "(202) 555-0143 / (202) 555-0199",
    "08031234567, 07012345678",
    "08031234567 07012345678",
    "0803 123 4567 and 0701 234 5678",
    "0803 123 4567 or 0701 234 5678",
    "00234 803 123 4567",
    "00234-803-123-4567",
  ];
  for (const r of runs)
    it(`no digit of a number is left: ${JSON.stringify(r)}`, () => {
      expect(digitsLeft(scrub(`call ${r} now`))).toBe(0);
      expect(digitsLeft(cleanModelText(`call ${r} now`))).toBe(0);
    });
  it("list markers around two numbers stay, both numbers go", () => {
    expect(scrub("1, 0803 123 4567, 2, 0701 234 5678")).toBe("1, , 2,");
    expect(cleanModelText("1, 0803 123 4567, 2, 0701 234 5678")).toBe(
      `1, ${MARK}, 2, ${MARK}`,
    );
  });
  it("the model path puts one mark per number", () => {
    expect(
      cleanModelText("call 0803 123 4567, 0701 234 5678, 0812 345 6789 now"),
    ).toBe(`call ${MARK}, ${MARK}, ${MARK} now`);
  });
});

describe("V-FIX-C round 5: ruling B phones by shape", () => {
  it("each shape goes", () => {
    for (const t of [
      "+2348031234567",
      "+234 803 123 4567",
      "+1 202 555 0143",
      "+44 7911 123456",
      "08031234567",
      "0803 123 4567",
      "0701 234 5678",
      "0901 234 5678",
      "0911 234 5678",
      "2348031234567",
      "234 803 123 4567",
      "002348031234567",
      "8031234567",
      "1234567890",
      "202-555-0143",
      "202.555.0143",
      "(202) 555-0143",
      "zero eight zero three one two three four five six seven",
      "oh eight oh three 123 4567",
      "0803 123 4567",
    ]) {
      expect(scrub(`call ${t} now`)).toBe("call now");
      expect(cleanModelText(`call ${t} now`)).toBe(`call ${MARK} now`);
    }
  });
  const stay = [
    "Buses leave at 08:30, 09:30, 10:30.",
    "Results: 0-0, 1-1, 2-0, 3-1, 0-2.",
    "The shifts are 08:00-16:00, 16:00-00:00.",
    "Dates: 01/02/2024 - 05/02/2024.",
    "From 01/03/2024 - 05/03/2024 we are closed.",
    "Inflation: 0.5, 1.2, 0.8, 2.1, 3.0.",
    "Grades 0, 1, 2, 3, 4, 5, 6, 7, 8, 9.",
    "Page 0 1 2 3 4 5 6 7 8 9.",
    "Numbers starting 070, 080, 081, 090, 091 are mobile.",
    "Bags: 120 340 1000.",
    "Votes 123 456 7890.",
    "Votes were 400 500 6000.",
    "234, 235, 236, 237.",
    "Cars: 234 235 236 237.",
    "Buses leave at 08:30.",
    "Sizes 0-5, 6-10, 11-15.",
    "It is 0.5-1.5 percent.",
    "In 2023-2024-2025 we voted.",
    "On 01/02/2024 we met.",
    "At 08:30:15 sharp.",
    "Score 3-2.",
    "100 000 000.",
    "803 123 4567 is a foreign style number.",
    "98765 43210 is left.",
    "44 7911 123456 is left.",
    "7911 123456 is left.",
    "0803 one two three four five six is only ten digits.",
    "double five six seven eight nine zero one two.",
  ];
  for (const t of stay)
    it(`stays: ${t}`, () => {
      expect(scrub(t)).toBe(t);
      expect(cleanModelText(t)).toBe(t);
    });
});

describe("V-FIX-C round 5: N2 a price per unit is never a link", () => {
  const stay = [
    "Petrol now sells at N617.50/litre.",
    "Petrol is N617.5/litre now.",
    "Rice is N5.5k/kg.",
    "Diesel at N1200.00/litre hurts.",
    "Pay NGN617.50/litre at the pump.",
    "It costs USD1.50/kg.",
    "Salary is N1.5m/month.",
    "Fare is N1.5k/trip.",
    "I pay N2.5k/day.",
    "He gets N30.5k/week.",
    "Rent is N2.5m/yr.",
    "N2.5bn/year was voted for roads.",
    "Dr.Ade/Dr.Bola attended.",
    "Mr.Bello/Mrs.Bello came.",
    "Use v1.2/final please.",
    "N617.50 per litre is too much.",
    "₦617.50/litre is too much.",
    "#617.50/litre is too much.",
    "$1.5/kg is too much.",
    "N150k/month is too little.",
    "N1,200.50/litre is high.",
    "22.4%/year is high.",
    "4.5k/day is little.",
    "60km/h is the limit.",
  ];
  for (const t of stay)
    it(`unchanged: ${t}`, () => {
      expect(scrub(t)).toBe(t);
      expect(cleanModelText(t)).toBe(t);
    });
  it("real path links still go", () => {
    for (const g of [
      "bio.link/jane",
      "shop.store/a",
      "linktr.ee/jane",
      "example.biz/x",
    ]) {
      expect(scrub(`see ${g} ok`)).toBe("see ok");
      expect(cleanModelText(`see ${g} ok`)).toBe(`see ${MARK} ok`);
    }
  });
});

describe("V-FIX-C round 5: N4 and the LOW list", () => {
  const stay = [
    "I can handle 10k users.",
    "It can handle 5G.",
    "She will handle 2nd round.",
    "We handle N5,000 each.",
    "Dem go handle N50,000.",
    "Snap 2nd group is full.",
    "I used ig 24x7 last year.",
    "On twitter 2day I saw it.",
    "handle 2023 requests.",
    "x 2023.",
    "ig 2 times.",
    "whatsapp 2.0 is old.",
    "instagram 2.0 is old.",
    "x 24/7.",
    "I met x. Then he left.",
    "Dinner @ home. Net later.",
    "The meeting is @ Ikeja. Info follows.",
  ];
  for (const t of stay)
    it(`unchanged: ${t}`, () => {
      expect(scrub(t)).toBe(t);
      expect(cleanModelText(t)).toBe(t);
    });
  const gone = [
    "ig = jane_doe",
    "ig -> jane_doe",
    "ig — jane_doe",
    "ig => jane_doe",
    "ig ~ jane_doe",
    "ig | jane_doe",
    "ig / jane_doe",
    "ig #jane_doe",
    "ig ➡ jane_doe",
    "ig [jane_doe]",
    'ig "jane_doe"',
    "ig, jane_doe",
    "ig; jane_doe",
    "ig. jane_doe",
    "my ig, jane_doe",
    "on x, jane_doe",
    "tiktok @ jane",
    "find me on tiktok @ jane",
    "ig : @ jane_doe",
    "sc: jane_doe",
    "handles: jane_doe",
    "twitter janedoe99",
    "insta jane_doe",
    "ig: jane.doe",
    "x @jane",
  ];
  for (const g of gone)
    it(`removes ${JSON.stringify(g)}`, () => {
      expect(scrub(`see ${g} ok`)).not.toMatch(/jane|@x|\bx\b.*jane/);
      expect(cleanModelText(`see ${g} ok`)).toContain(MARK);
    });
});

describe("V-FIX-C round 5: ordinary sentences unchanged in both paths", () => {
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
  it("has at least 300 sentences", () =>
    expect(all.length).toBeGreaterThanOrEqual(300));
  it("posts path and model path leave every one whole", () => {
    for (const t of all) {
      expect(scrub(t)).toBe(t);
      expect(cleanModelText(t)).toBe(t);
    }
  });
  it("the 90 separators still remove an 11-digit number whole, in both paths", () => {
    for (const sep of separators) {
      expect(scrub(`call 0803${sep}123${sep}4567 now`)).toBe("call now");
      expect(cleanModelText(`call 0803${sep}123${sep}4567 now`)).toContain(
        MARK,
      );
    }
  });
});

describe("V-FIX-C round 5: still linear", () => {
  const N = 200_000;
  const shapes = [
    "a",
    "1",
    "1-",
    "1 ",
    "0 ",
    "+1 ",
    "(1) ",
    "1.",
    "08:30, ",
    "0-0, ",
    "12 ",
    "N1.5/",
    "Dr.A/",
    "ig ",
    "ig = a_1 ",
    "x.",
    "+",
    "(",
    "–",
    "one ",
    "zero one ",
    "[removed]",
    " @ ",
    "a @ a. Net ",
    "handle 10k ",
    "1,000, ",
  ].map((s) => [s, s.repeat(Math.ceil(N / s.length)).slice(0, N)] as const);
  scrub("warm up 0803 123 4567", 5000, MARK);
  for (const [name, text] of shapes)
    it(`200,000 characters of ${JSON.stringify(name)}: scrub (both paths) under 50 ms`, () => {
      expect(ms(() => scrub(text))).toBeLessThan(50);
      expect(ms(() => cleanModelText(text))).toBeLessThan(50);
    });
});
