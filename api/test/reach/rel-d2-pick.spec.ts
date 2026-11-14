import { createHash } from "node:crypto";
import {
  ResvgCardRenderer,
  type CardSpec,
} from "../../src/reach/card-renderer";
import { cardSpecFor } from "../../src/reach/share.service";
import type { Subject } from "../../src/reach/share-subject";

const sha = (b: Buffer | string) => createHash("sha1").update(b).digest("hex");
const subject = (moodOptions: string[]): Subject =>
  ({
    topicLine: "What would you fix?",
    countryAndTheme: "Nigeria",
    arguments: [],
    leanLine: null,
    cardLabel: "Today’s question",
    cardHeadline: null,
    cardRows: [],
    cardSummary: null,
    pollOpen: false,
    cardVoices: 3,
    newsTagKey: null,
    fallback: false,
    summaryUpdatedAt: new Date("2026-11-14T00:00:00Z"),
    poll: null,
    question: { hint: "A small line", moodOptions },
  }) as unknown as Subject;

/** V-REL-D2-FIX2 (M3): the pick-one-word picture is only for a question that has word choices. */
describe("M3: a question without word choices gets the plain question picture", () => {
  const r = new ResvgCardRenderer();

  it("the spec has no pick part when the question has no words, and has one when it has words", () => {
    expect(cardSpecFor("QUESTION", subject([]), 60).pick).toBeUndefined();
    expect(
      cardSpecFor("QUESTION", subject(["ANGRY", "TIRED"]), 60).pick,
    ).toEqual({ hint: "A small line", words: ["ANGRY", "TIRED"], seconds: 60 });
  });

  it("the picture for no words is the plain question card (same bytes), not the pick layout", async () => {
    const noWords = cardSpecFor("QUESTION", subject([]), 60);
    const plain: CardSpec = { ...noWords, pick: undefined };
    const forced: CardSpec = {
      ...noWords,
      pick: { hint: "A small line", words: [], seconds: 60 },
    };
    const pickLayout = r.pickSvg(forced);
    expect(sha(await r.render(noWords))).toBe(sha(await r.render(plain)));
    // even a spec that carries an empty pick part is drawn as the plain card
    expect(sha(await r.render(forced))).toBe(sha(await r.render(plain)));
    expect(sha(r.svg(plain))).not.toBe(sha(pickLayout));
    expect(sha(await r.render(plain))).not.toBe(
      sha(
        await r.render({
          ...plain,
          pick: { hint: "A small line", words: ["ANGRY"], seconds: 60 },
        }),
      ),
    );
  });
});
