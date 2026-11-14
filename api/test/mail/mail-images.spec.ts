import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The only picture addresses a mail template may carry. Both reach the same hosted file. */
const KNOWN_GOOD = new Set([
  "https://id.wawuafrica.com/assets/voices/logo-wordmark-white.png",
  "{{asset_base}}/logo-wordmark-white.png",
]);

const dir = join(__dirname, "../../src/mail/templates");

describe("mail images", () => {
  it("every image address in every template is a known-good hosted asset", () => {
    const seen: string[] = [];
    for (const sub of ["html", "text"]) {
      for (const f of readdirSync(join(dir, sub))) {
        const body = readFileSync(join(dir, sub, f), "utf8");
        const urls = [
          ...body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi),
          ...body.matchAll(/url\(\s*['"]?([^'")]+)/gi),
          ...body.matchAll(
            /https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|gif|svg|webp)/gi,
          ),
        ].map((m) => m[1] ?? m[0]);
        for (const u of urls) {
          seen.push(`${f}: ${u}`);
          expect(KNOWN_GOOD.has(u)).toBe(true);
        }
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(70);
  });
  it("nothing points at the website's email-assets folder", () => {
    for (const f of readdirSync(join(dir, "html"))) {
      expect(readFileSync(join(dir, "html", f), "utf8")).not.toContain(
        "email-assets",
      );
    }
  });
  it("no template carries a [UPPER CASE] placeholder", () => {
    const found: string[] = [];
    for (const sub of ["html", "text"]) {
      for (const f of readdirSync(join(dir, sub))) {
        const body = readFileSync(join(dir, sub, f), "utf8");
        for (const m of body.matchAll(/\[[A-Z][A-Z0-9 _/-]{2,}\]/g))
          found.push(`${f}: ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
  it("the footer carries the registered address", () => {
    for (const f of readdirSync(join(dir, "html"))) {
      const body = readFileSync(join(dir, "html", f), "utf8");
      if (body.includes("Voices by WAWU"))
        expect(body).toContain("5 Ikoyi Crescent, Lagos, Nigeria");
    }
  });
});
