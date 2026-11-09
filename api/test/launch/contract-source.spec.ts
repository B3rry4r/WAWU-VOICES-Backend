import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

describe("contract source (LCH-A2 fix 1)", () => {
  it("docs/contract/src regenerates openapi.yaml byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "voices-contract-"));
    try {
      const out = join(dir, "openapi.yaml");
      execFileSync("python3", [join(ROOT, "docs/contract/src/build.py"), out], {
        stdio: "pipe",
      });
      expect(
        readFileSync(out, "utf8") ===
          readFileSync(join(ROOT, "docs/contract/openapi.yaml"), "utf8"),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the invite and friends routes come from the source", () => {
    const routes = readFileSync(
      join(ROOT, "docs/contract/src/routes.py"),
      "utf8",
    );
    for (const op of ["getMyInvite", "claimInvite", "listMyFriends"]) {
      expect(routes).toContain(`"${op}"`);
    }
    const schemas = readFileSync(
      join(ROOT, "docs/contract/src/schemas.py"),
      "utf8",
    );
    for (const s of [
      "MyInvite",
      "ClaimInviteRequest",
      "Friend",
      "FriendsPage",
    ]) {
      expect(schemas).toContain(`obj("${s}"`);
    }
  });
});
