import { scrub } from "../../src/reach/weekly-draft";
import { cleanModelText } from "../../src/admin/summary-draft";

const ms = (f: () => unknown): number => {
  const t = process.hrtime.bigint();
  f();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

const platforms = [
  "whatsapp",
  "facebook",
  "instagram",
  "twitter",
  "tiktok",
  "telegram",
  "snapchat",
  "youtube",
  "discord",
  "linkedin",
  "threads",
  "x",
  "snap",
  "ig",
  "fb",
  "tg",
  "wa",
  "yt",
  "insta",
  "handle",
];
const platformTemplates = [
  (p: string) => `I use ${p} daily.`,
  (p: string) => `The school has a ${p} group.`,
  (p: string) => `Everybody talks about ${p} these days.`,
  (p: string) => `He lost his job after a ${p} post.`,
  (p: string) => `They shared it on ${p} widely.`,
  (p: string) => `Dem dey talk about ${p} for office.`,
  (p: string) => `Check the poll on ${p} later.`,
  (p: string) => `My sister no like ${p} at all.`,
  (p: string) => `We heard it first on ${p}.`,
  (p: string) => `${p[0].toUpperCase()}${p.slice(1)} is slow.`,
];
const starters = [
  "Africa",
  "Online",
  "Tech",
  "Shop",
  "Site",
  "Club",
  "Info",
  "Link",
  "Store",
  "Dev",
  "Net",
  "Org",
  "Biz",
  "UK",
  "NG",
  "XYZ",
  "Com",
];

describe("V-FIX-C round 4: M1 a platform word and an ordinary word stay, with and without the full stop", () => {
  const named = [
    "I use whatsapp daily.",
    "Twitter is dead.",
    "Let the police handle that.",
    "Mark the x here.",
    "Dem talk am for wa group.",
    "The school has a whatsapp group.",
    "He lost his job after a facebook post.",
    "They shared it on instagram widely.",
    "I read the news on twitter first.",
    "Instagram is slow.",
    "It was just a snap judgement.",
    "The council did not handle complaints.",
    "That is the x factor.",
    "Rumours spread on telegram fast.",
    "Check the poll on facebook later.",
  ];
  for (const t of named)
    for (const s of [t, t.replace(/\.$/, "")])
      it(`unchanged: ${s}`, () => expect(scrub(s)).toBe(s));
  for (const p of platforms)
    for (const f of platformTemplates) {
      const s = f(p);
      it(`unchanged: ${s}`, () => expect(scrub(s)).toBe(s));
    }
  it("a handle after a platform word still goes: a digit, an underscore or an inner dot", () => {
    for (const t of [
      "ig: jane.doe",
      "insta jane_doe",
      "twitter janedoe99",
      "my handle is jane.doe",
      "x @jane",
      "tg: jane",
      "FB: jane.doe",
      "discord: jane#1234",
    ])
      expect(scrub(`see ${t} ok`)).not.toMatch(/jane/);
  });
});

describe("V-FIX-C round 4: M3 prices, ranges and lists stay", () => {
  const stay = [
    "100,000 - 150,000 naira per year.",
    "Between 100,000-150,000 naira.",
    "I earn 100,000 - 150,000.",
    "Between 10,000 - 15,000 naira per week.",
    "Between 2015, 2016, 2017 and 2018 nothing changed.",
    "In 1999, 2003, 2007, 2011, 2015, 2019 and 2023 we voted.",
    "From 2019 2020 2021 2022 2023 2024 prices doubled every year.",
    "Payments of 10,000, 20,000, 30,000 and 40,000 were delayed.",
    "The levy list was 1000, 2000, 3000, 4000, 5000.",
    "Counting: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and we start again.",
    "Three. Four. Five. Six. Seven. Eight. Nine. Ten.",
    "2 3 4 5 6 7 8 9 10 11 teachers were sacked.",
    "Page 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 are blank.",
    "Bags 12 13 14 15 16 17 18 19 20 21 were delivered.",
    "Sections 1,2,3,4,5,6,7,8,9,10 apply.",
    "Count: one. Two. Three. Four. Five. Six. Seven. Eight. Nine.",
    "It cost 1,000,000,000 naira.",
    "On 2026-11-14 10:30:00 it ended.",
    "On 12/05/2026 we met.",
    "Prices are 5,000 naira.",
    "Born in 1990.",
  ];
  for (const t of stay) it(`unchanged: ${t}`, () => expect(scrub(t)).toBe(t));
  it("each of the four phone rules still removes", () => {
    for (const t of [
      "+2348031234567",
      "+234 803 123 4567",
      "08031234567",
      "0803 123 4567",
      "0803-123-4567",
      "0803.123.4567",
      "234 803 123 4567",
      "8031234567",
      "803 123 4567",
      "0803 one two three four five six",
      "zero eight zero three 123 4567",
      "oh eight oh three one two three four five six",
    ])
      expect(scrub(`call ${t} now`)).toBe("call now");
  });
});

describe("V-FIX-C round 4: M2 any separator between phone groups", () => {
  const seps = [
    "–",
    "—",
    "−",
    "‐",
    "‑",
    "•",
    "·",
    "‧",
    "⁃",
    "∙",
    "、",
    "。",
    "‖",
    "¦",
    "¬",
    "°",
    "!",
    '"',
    "$",
    "%",
    "&",
    "'",
    "*",
    "+",
    ";",
    "<",
    "=",
    ">",
    "?",
    "[",
    "\\",
    "]",
    "^",
    "`",
    "{",
    "}",
    "~",
    "#",
    " -- ",
    " .. ",
    " ... ",
    " ",
    "\t",
    "\n",
    " ",
    " ",
    ",",
    ".",
    "-",
    "/",
    "_",
    ":",
    "|",
    "(",
    ")",
    ", ",
    " / ",
    "--",
    "**",
    "##",
    "..",
    "//",
    "~~",
    " – ",
    " — ",
    " • ",
    " * ",
    " # ",
    " ~ ",
    ") (",
    ") ",
    " (",
    "-.-",
    "––",
    "——",
    "''",
    '""',
    "<>",
    "[]",
    "{}",
    "!!",
    "??",
    "%%",
    "&&",
    "==",
    "++",
    ";;",
    "^^",
    "``",
    "\\\\",
    "$$",
    "··",
    "••",
  ];
  it("has 90 separators", () =>
    expect(new Set(seps).size).toBeGreaterThanOrEqual(90));
  for (const sep of seps)
    it(`0803${JSON.stringify(sep)}123${JSON.stringify(sep)}4567 is removed whole`, () => {
      expect(scrub(`call 0803${sep}123${sep}4567 now`)).toBe("call now");
    });
  it("other shapes", () => {
    expect(scrub("call +234 (0) 803 – 123 – 4567 now")).toBe("call now");
    expect(scrub("call 08o3 one two three 4567 now")).toBe("call now");
    expect(scrub("call 0803#123#4567 now")).toBe("call now");
  });
});

describe("V-FIX-C round 4: M4 and M5 links and emails", () => {
  const sentences = starters.flatMap((s) => [
    `Our people suffer. ${s} should unite.`,
    `I could not go to school. ${s} classes did not work either.`,
  ]);
  it("has 34 sentences", () => expect(sentences.length).toBe(34));
  for (const t of [
    ...sentences,
    "Rice is 85,000 naira. Shop owners are crying.",
    "It cost me 5,000. Biz is slow these days.",
    "I could not go to school. Online classes did not work either.",
    "Nigeria is blessed. Africa watches us.",
    "Hunger is real. Shop prices doubled.",
    "I went home.Then I slept.",
  ])
    it(`unchanged: ${t}`, () => expect(scrub(t)).toBe(t));

  const gone = [
    "evil . com",
    "evil .com",
    "evil. com",
    "evil .\ncom",
    "evil . net",
    "evil . org",
    "evil . ng",
    "evil . info",
    "evil . biz",
    "evil . xyz",
    "evil . io",
    "w w w . evil . com",
    "h t t p s : / / evil . com",
    "h t t p : / / evil . com / x",
    "jane @ example . com",
    "jane @ example.com",
    "jane @ example . ng",
    "evil。com",
    "evil｡com",
    "evil.tk",
    "evil.ru",
    "evil.gh",
    "evil.ke",
    "evil.za",
    "evil.co.za",
    "evil.fr",
    "evil.cn",
    "evil.vip",
    "evil.icu",
    "evil.xxx",
    "evil.click",
    "evil.cloud",
    "192.168.0.1",
    "192.168.0.1/admin",
    "127.0.0.1:8080",
    "10.0.0.1:80/x",
    "discord: jane#1234",
    "jane(at)example.com",
    "example [dot] com",
    "evil dot com",
    "evil[.]com",
  ];
  for (const g of gone)
    it(`removes ${JSON.stringify(g)}`, () =>
      expect(scrub(`see ${g} ok`)).toBe("see ok"));

  it("the endings that are ordinary words after a missing space are not added", () => {
    for (const w of ["in", "de", "work", "so", "am", "is", "by"])
      expect(scrub(`I said it.${w} Done.`)).toContain(w);
  });

  it("the model path: <at> and <dot> are read as at and dot before tags are stripped", () => {
    expect(cleanModelText("jane<at>example<dot>com")).toBe("");
    expect(cleanModelText("mail jane<at>example<dot>com now")).toBe("mail now");
    expect(cleanModelText("pay <b>now</b>")).toBe("pay now");
  });
});

describe("V-FIX-C round 4: left as they are", () => {
  it("bare names with no mark, bit.ly with a space, NFKC of an ellipsis", () => {
    expect(scrub("dm me on janedoe99")).toBe("dm me on janedoe99");
    expect(scrub("whatsapp me on janedoe")).toBe("whatsapp me on janedoe");
    expect(scrub("wait… ok")).toBe("wait... ok");
  });
});

describe("V-FIX-C round 4: ordinary Nigerian English and Pidgin, each ends with a full stop", () => {
  const own = [
    "Salary is gone in a day.",
    "Pay on the 25th, not the 30th.",
    "NEPA took the light again.",
    "We need 24/7 power.",
    "Prices rose 20% since March.",
    "Fuel is ₦1,100 a litre now.",
    "My bus fare is 500 each way.",
    "The meeting is at 3pm at the market.",
    "I want a fair deal, no more no less.",
    "Dot matrix printers still work.",
    "Look at the dot on the map.",
    "It is at least 40 degrees.",
    "We sat at home all day.",
    "Vote on 15.02.2027 please.",
    "Call it what it is. Me, I am tired.",
    "OK. To be honest, I am tired.",
    "She works at Lagos. Me and him live in Abuja.",
    "Three, two, one, go.",
    "Number one is pay on time. Number two is fair rent.",
    "I called 3 times, 4 times, 5 times today.",
    "Room 12 floor 3 block 4.",
    "Me, I no go vote again.",
    "Dem no pay us for three months.",
    "Abeg make government do something.",
    "Wahala dey for this country.",
    "I dey tired of this hustle.",
    "How we go survive this one.",
    "E don tay wey we dey suffer.",
    "No light, no water, no road.",
    "Our roads are bad. Africa should do better.",
    "The x-ray machine is broken.",
    "Dr.Ade and Mr.Bello came.",
    "St.Mary school is closed.",
    "U.S.A is far.",
    "It happened at 9 a.m. sharp.",
    "No. 1 on the list is rent.",
    "The score was 3-2.",
    "I paid ₦50,000 for rent.",
    "Rent went from 150,000 to 200,000.",
    "In 2019 and again in 2024 we voted.",
    "It is 3.5 percent now.",
    "A 10.5/20 score is poor.",
    "Tuesday 10 October 2026 at 9:30.",
    "I earn 2,000,000,000 naira in my dreams.",
    "The levy is 1,500 per month.",
    "Rice is 85,000 naira a bag.",
    "Garri is 1,200 a derica.",
    "Transport from Yaba to Ikeja is 700.",
    "We are 5 in one room.",
    "She has 3 kids and 2 jobs.",
    "Page 3 of 5.",
    "08 September was a Friday.",
    "I was born in 1990 and she in 1995.",
    "Between 8 and 9 in the morning.",
    "The bus left at 6:45.",
    "Chapter 12 starts on page 140.",
    "Tell your people the truth.",
    "Give us light, not promises.",
    "My landlord raised rent again.",
    "We no get money for school fees.",
    "Hospital bills are killing us.",
    "Teachers need better pay.",
    "Nurses are leaving the country.",
    "Our police need training.",
    "The market women are angry.",
    "Okada riders are banned from the road.",
    "Traffic is bad on Third Mainland.",
    "Fuel queues are back.",
    "The naira keeps falling.",
    "Dollar rate is 1,500 now.",
    "Data is too expensive.",
    "Network is bad in my area.",
    "We went to church and then home.",
    "I will call you later.",
    "She is at the bank.",
    "He sent me a message on the group.",
    "Read the rules before you post.",
    "Be kind to each other.",
    "Respect is free.",
  ];
  const all = [
    ...own,
    ...[
      "Prices are too high for us.",
      "The government must listen.",
      "I support free school meals.",
      "We need clean water.",
      "My village has no clinic.",
      "The hospital is far from us.",
      "Our children walk five kilometres to school.",
      "Farmers need roads.",
      "The harvest was poor this year.",
      "Insecurity keeps us at home.",
      "Youth need jobs, not speeches.",
      "Women need safe transport.",
      "Pensioners wait for years.",
      "Civil servants wait for salary.",
      "Contractors are not paid.",
      "Students are on strike again.",
      "Lecturers want better pay.",
      "Doctors are tired.",
      "I pay for light I never get.",
      "Pre-paid meters are a scam.",
      "The bank charged me twice.",
      "POS agents charge too much.",
      "Transfers fail every day.",
      "I lost money on a bad deal.",
      "Fake drugs are everywhere.",
      "Our markets burn every year.",
      "Flood took my shop.",
      "Erosion is eating our road.",
      "Churches and mosques should pay tax.",
      "Elders should mentor youth.",
      "Let us vote and protect our votes.",
      "The election was peaceful here.",
      "Politicians promise and forget.",
      "The senator never came back.",
      "Our councillor is helpful.",
      "The chairman fixed the gutter.",
      "Dem don share rice again.",
      "Who go pay for this one.",
      "Na so e be.",
      "E no easy at all.",
      "Make we hold our leaders accountable.",
      "I no fit cope.",
      "The hustle is real.",
      "God dey.",
      "Common, give us a break.",
      "Nobody is safe on this road.",
      "The traffic light is dead.",
      "We buy water from vendors.",
      "My generator costs more than my rent.",
      "Petrol is scarce again.",
      "Gas is expensive.",
      "Cooking is a luxury now.",
      "Yam is dear in the market.",
      "Beans doubled in price.",
      "Eggs are a luxury.",
      "Bread is smaller than before.",
      "School fees went up again.",
      "Books are too costly.",
      "Uniforms cost a fortune.",
      "Exam fees are high.",
      "Hospital beds are few.",
      "Drugs are not available.",
      "Nurses work double shifts.",
      "Ambulances never come.",
      "The airport is far.",
      "Flights are delayed always.",
      "Train rides are cheap and slow.",
      "Buses are full every morning.",
      "Lagos traffic is a punishment.",
      "Abuja is quiet at night.",
      "Kano markets are busy.",
      "Port Harcourt is humid.",
      "Enugu is cool and green.",
      "Ibadan is old and big.",
      "Benin is rich in history.",
      "Jos has nice weather.",
      "I love my country but it hurts.",
      "We must rebuild trust.",
      "Our culture is strong.",
      "Music keeps us going.",
      "Football gives us joy.",
      "Nollywood tells our story.",
      "Our food is the best.",
      "Jollof wars are silly.",
      "Pepper soup helps a cold.",
      "Suya is life.",
      "Amala and ewedu on Sunday.",
      "Pounded yam and egusi on Monday.",
    ],
    ...starters.map((s) => `Our people suffer. ${s} should unite.`),
    ...platforms.flatMap((p) => platformTemplates.map((f) => f(p))),
  ];
  it("has at least 300 sentences, each ending with a full stop, all unchanged", () => {
    expect(all.length).toBeGreaterThanOrEqual(300);
    for (const t of all) {
      expect(t).toMatch(/\.$/);
      expect(scrub(t)).toBe(t);
    }
  });
});

describe("V-FIX-C round 4: still linear", () => {
  const N = 200_000;
  const shapes = [
    "a",
    "1",
    "1-",
    "1 ",
    "+1 ",
    "0 0 ",
    "–",
    "0–0–",
    "one ",
    "zero one ",
    "ig ",
    "ig a_1 ",
    "x.",
    "a.b.",
    ". com ",
    "evil . ",
    "w w w . ",
    "h t t p : / / ",
    "a @ ",
    "a(at)",
    "<at>",
    "<dot>",
    "1.1.1.1 ",
    "192.168.0.1:80/",
    "o1",
    "O0O",
    "。",
    "#1234 ",
    "discord: a#1 ",
    "a.co.za ",
    "1,000, ",
    "20, ",
    "((((",
    "))))",
    "​",
    "<<<",
    " dot ",
    "[dot]",
    "[.]",
  ].map((s) => [s, s.repeat(Math.ceil(N / s.length)).slice(0, N)] as const);
  for (const [name, text] of shapes)
    it(`200,000 characters of ${JSON.stringify(name)}: scrub and cleanModelText under 50 ms`, () => {
      expect(ms(() => scrub(text))).toBeLessThan(50);
      expect(ms(() => cleanModelText(text))).toBeLessThan(50);
    });
});
