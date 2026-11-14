import { REMOVED_MARK, scrub } from "../../src/reach/scrub";

/**
 * V-SURVEYS round 5, M2: more shapes of contact details in the shared scrub, and ordinary words that must stay.
 * Not caught on purpose: number words split by commas, and "snap me at chidi" (a platform name with no mark). A person on
 * the team reads every free survey answer before release.
 */
const s = (t: string) => scrub(t, 5000, REMOVED_MARK);

describe("scrub round 7: look-alike digits, spaced-out and spoken emails, bare domains", () => {
  it.each([
    ["call 08O3I234567 now", "call [removed] now"],
    ["call 0BO3I2345S7 now", "call [removed] now"],
    ["c h i d i @ g m a i l . c o m", "[removed]"],
    ["mail c h i d i @ g m a i l . c o m please", "mail [removed] please"],
    ["chidi dot okafor at gmail dot com", "[removed]"],
    ["write chidi dot okafor at gmail dot com now", "write [removed] now"],
    ["visit mybrand.studio", "visit [removed]"],
    ["mybrand dot studio", "[removed]"],
    ["see mybrand.shop today", "see [removed] today"],
    ["t . me / chidi", "[removed]"],
    ["go to t . me / chidi now", "go to [removed] now"],
  ])("%s", (input, out) => {
    expect(s(input)).toBe(out);
  });

  it.each([
    "handle with care",
    "at the dot of noon",
    "studio",
    "io",
    "I like the studio and the io game",
    "Rice costs N5,000 and beans N1,200.50",
    "Meet on 14.11.2026 at 5 pm",
    "He scored 3.5 out of 10 in Room 12",
    "I a m @ h o m e",
    "BOOLEAN SBOIOIO 12",
    "see wa.me/2348031234567 ok".replace("wa.me/2348031234567", "the shop"),
    "Dinner at home. Studio later",
    "my sister at the studio dot",
  ])("ordinary words stay: %s", (t) => {
    expect(s(t)).toBe(t);
  });

  it("known gaps stay gaps (documented): comma-split number words and a platform with no mark", () => {
    expect(s("snap me at chidi")).toBe("snap me at chidi");
    expect(s("eight zero three, one two three, four five six seven")).toBe(
      "eight zero three, one two three, four five six seven",
    );
  });

  it("the empty mark still deletes", () => {
    expect(scrub("call 08O3I234567 now")).toBe("call now");
  });

  it("stays fast on long runs of single letters", () => {
    const t0 = Date.now();
    scrub("a ".repeat(2500) + "@ " + "b ".repeat(2000), 5000, REMOVED_MARK);
    scrub("a.".repeat(2500), 5000, REMOVED_MARK);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
