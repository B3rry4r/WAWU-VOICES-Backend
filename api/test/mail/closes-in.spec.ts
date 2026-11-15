import { closesIn } from "../../src/mail/topic-mail.service";
import { renderMail } from "../../src/mail/mail-render";

/** V-MAIL-CLOSES-IN: pure unit spec, no database, nothing left behind. */
const H = 3_600_000;
const M = 60_000;

describe("closesIn", () => {
  it.each([
    [1 * M, "1 minute"],
    [59 * M, "59 minutes"],
    [60 * M, "1 hour"],
    [20 * H, "20 hours"],
    [47.5 * H, "48 hours"],
    [48 * H, "48 hours"],
    [48.6 * H, "2 days"],
    [49 * H, "2 days"],
    [71 * H, "2 days"],
    [72 * H, "3 days"],
    [185 * H, "7 days"],
    [0, "1 minute"],
    [-5 * H, "1 minute"],
  ])("%d ms -> %s", (ms, out) => {
    expect(closesIn(ms)).toBe(out);
  });
});

describe("C01 with a question closing in 185 hours", () => {
  it("says 7 days in the HTML and the text part", () => {
    const r = renderMail("C01", "Today’s question: {{question_short}}", {
      first_name: "Ada",
      question_text: "Q?",
      question_short: "Q?",
      voice_count: "5",
      closes_in: closesIn(185 * H),
      topic_url: "https://x/q/1/speak",
      listen_url: "https://x/q/1",
      preferences_url: "https://x/p",
      unsubscribe_url: "https://x/u",
    });
    if (!r.ok) throw new Error(r.missing.join());
    expect(r.html).toContain("closes in 7 days");
    expect(r.text).toContain("closes in 7 days");
  });
});
