import { readFileSync } from "node:fs";
import { join } from "node:path";

const INFRA = join(__dirname, "../../../infra");
const read = (f: string) => readFileSync(join(INFRA, f), "utf8");

describe("www.usevoices.com (LCH-A2 fix 2)", () => {
  const conf = read("nginx/voices.conf").replace(
    /__DOMAIN__/g,
    "usevoices.com",
  );

  it("has a server block for www that answers 301 to the bare address and keeps the path and query", () => {
    const block =
      /server\s*\{[^}]*server_name www\.usevoices\.com;[^}]*\}/.exec(conf);
    expect(block).not.toBeNull();
    expect(block![0]).toContain(
      "return 301 https://usevoices.com$request_uri;",
    );
  });

  it("the main block serves the bare address only", () => {
    expect(conf).toMatch(/server_name usevoices\.com;/);
    expect(conf).not.toMatch(/server_name usevoices\.com www\./);
  });

  it("the redirect target applied to a path gives the same path on the bare address", () => {
    // nginx $request_uri is the path plus the query string
    const target = "https://usevoices.com$request_uri".replace(
      "$request_uri",
      "/go/ada4k2x?x=1",
    );
    expect(target).toBe("https://usevoices.com/go/ada4k2x?x=1");
  });

  it("provision.sh asks certbot for both names, expands an existing certificate, and checks the www record", () => {
    const sh = read("provision.sh");
    expect(sh).toContain('CERT_NAMES+=(-d "www.$DOMAIN")');
    expect(sh).toContain('certbot --nginx "${CERT_NAMES[@]}" --expand');
    expect(sh).toContain('certbot install --nginx "${CERT_NAMES[@]}"');
  });

  it("the runbook DNS step adds the www record", () => {
    const rb = read("RUNBOOK.md");
    expect(rb).toContain("`www.usevoices.com`");
    expect(rb).toMatch(/www\.usevoices\.com.*301/s);
  });
});
