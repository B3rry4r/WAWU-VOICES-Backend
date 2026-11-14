import { Views } from "../../src/talk/views";

describe("a nameless reply shows no writer", () => {
  it("has no author and no picture, even when a picture is passed", () => {
    const views = new Views({} as never);
    const row = {
      id: "r1",
      answerId: "a1",
      anonymous: true,
      stance: null,
      kind: "TEXT",
      body: "hi",
      clip: null,
      createdAt: new Date(0),
      authorId: "u1",
      author: { id: "u1", handle: "h", displayName: "N", state: "ACTIVE" },
    } as never;
    const out = views.reply(row, "u2", "https://x/p.jpg");
    expect(out.author).toBeNull();
    expect(JSON.stringify(out)).not.toContain("p.jpg");
  });
});
