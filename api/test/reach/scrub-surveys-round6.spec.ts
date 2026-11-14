import { scrub } from "../../src/reach/scrub";

/** V-SURVEYS round 6 (L1): the scrub leaves ordinary sentences alone. The 25 sentences of the round 5 check. */
describe("scrub: ordinary sentences", () => {
  const unchanged = [
    "I love it.Me too o.",
    "Thanks.Us too.",
    "The food was great.Live music too.",
    "We did it.Top class service.",
    "See the shop.Page after page of goods.",
    "Buy it.Online is cheaper.",
    "That is nice.Pro tip, bring cash.",
    "Take it.Link me when you reach.",
    "It is hot.Co-workers sweat too.",
    "Oga.Me I no go.",
    "Sorry.Us na friends.",
    "Wait.Me I am coming.",
    "I dey.Me too.",
    "Money.Me no get.",
    "Love.Us dey together.",
    "Yes.To you too.",
    "Done.Net is bad now.",
    "Fine.Top of the morning.",
    "Jollof.Live and let live.",
    "Pay now.Pro rata for the rest.",
    "He said yes.To be honest I doubt it.",
    "The budget is 1000000000 naira",
    "Account type is 0123456789 savings?",
  ];
  it.each(unchanged)("%s stays", (t) => {
    expect(scrub(t)).toBe(t);
    expect(scrub(t, 5000, "[removed]")).toBe(t);
  });

  // "dot com" is left as it is today: the spoken form is still taken out.
  it("the two spoken dot com sentences behave as before", () => {
    expect(scrub("He is a dot com millionaire")).toBe("He is millionaire");
    expect(scrub("Amaka at home dot com is a joke name")).toBe(
      "is a joke name",
    );
  });

  it("real addresses still go", () => {
    for (const t of [
      "visit mybrand.me",
      "visit mybrand.co",
      "mybrand.co/shop",
      "www.x.live",
      "http://a.to/b",
      "visit MYBRAND.ME",
      "go to MYBRAND.CO now",
      "see mybrand.live now",
      "mybrand.shop",
      "find us at Mybrand.me",
    ])
      expect(scrub(t)).not.toMatch(/mybrand|\.me|\.co|\.live|x\.live|a\.to/i);
    expect(scrub("visit mybrand.me")).toBe("visit");
    expect(scrub("visit MYBRAND.ME")).toBe("visit");
  });

  it("a plain 10 digit number is a phone only in a mobile shape", () => {
    expect(scrub("call 8031234567 now")).toBe("call now");
    expect(scrub("call 7031234567 now")).toBe("call now");
    expect(scrub("call 9031234567 now")).toBe("call now");
    expect(scrub("call 08031234567 now")).toBe("call now");
    expect(scrub("call 07012345678 now")).toBe("call now");
    expect(scrub("call 09112345678 now")).toBe("call now");
    expect(scrub("call +2348031234567 now")).toBe("call now");
    expect(scrub("call 2348031234567 now")).toBe("call now");
    expect(scrub("call 08O3I234567 now")).toBe("call now");
    expect(scrub("code 12345678901 ok")).toBe("code 12345678901 ok");
  });
});
