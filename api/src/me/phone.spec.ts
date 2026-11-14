import { createHmac } from "node:crypto";
import { normalisePhone, phoneHashOf, phonePepper } from "./phone";

/** The reading as it was before every country was accepted (api/src/me/phone.ts at dea33c3), kept here as the yardstick. */
const LEGACY_DIAL: Record<string, string> = {
  NG: "234",
  GH: "233",
  KE: "254",
  ZA: "27",
};
function legacyNormalise(raw: unknown, country?: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const dial =
    LEGACY_DIAL[typeof country === "string" ? country.toUpperCase() : "NG"] ??
    LEGACY_DIAL.NG;
  let full: string;
  if (plus) full = digits;
  else if (digits.startsWith("0")) full = `${dial}${digits.slice(1)}`;
  else if (
    Object.values(LEGACY_DIAL).some(
      (d) => digits.startsWith(d) && digits.length >= 11,
    )
  )
    full = digits;
  else full = `${dial}${digits}`;
  for (const d of Object.values(LEGACY_DIAL))
    if (full.startsWith(d)) {
      if (full[d.length] === "0") full = d + full.slice(d.length + 1);
      break;
    }
  return `+${full}`;
}

const hash = (e164: string) =>
  createHmac("sha256", phonePepper()).update(e164).digest("hex");

describe("normalisePhone, Nigerian numbers (unchanged)", () => {
  // Recorded from the code before the change, with the test pepper.
  const NG_HASH =
    "fd1edecde3b0904b4df8bde434c3022e9ad40049188414222a8d62f25a80d614";
  const forms = [
    "08099990001",
    "+2348099990001",
    "+234 809 999 0001",
    "+234-809-999-0001",
    "2348099990001",
    "00234 809 999 0001",
    "8099990001",
    "809 999 0001",
    "0809 999 0001",
    "(0809) 999-0001",
    "+234 (0) 809 999 0001",
    "+2340809 999 0001",
    "+234 08099990001",
    "234 0809 999 0001",
    "0 809 999 0001",
    "+234.809.999.0001",
    "  08099990001 ",
    " +2348099990001",
  ];
  it.each(forms)("%s is +2348099990001 with the same hash as before", (f) => {
    expect(normalisePhone(f)).toBe("+2348099990001");
    expect(normalisePhone(f, "NG")).toBe("+2348099990001");
    expect(normalisePhone(f, "ng")).toBe("+2348099990001");
    expect(phoneHashOf(f)).toBe(NG_HASH);
    expect(hash("+2348099990001")).toBe(NG_HASH);
  });
  it("gives what the old code gave for a spread of Nigerian numbers in every typed form", () => {
    const national = [
      "7031234567",
      "8123456789",
      "9012345678",
      "8099990001",
      "7000000000",
      "9099999999",
    ];
    const shapes = (n: string): string[] => [
      `0${n}`,
      n,
      `+234${n}`,
      `234${n}`,
      `00234${n}`,
      `+234 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`,
      `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`,
      `+234 (0) ${n}`,
      `+2340${n}`,
      `(0${n.slice(0, 3)}) ${n.slice(3)}`,
      `+234-${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`,
      ` 0${n} `,
    ];
    let checked = 0;
    for (const n of national)
      for (const f of shapes(n))
        for (const c of [undefined, "NG", "ng", "XX", 5, null]) {
          expect(normalisePhone(f, c)).toBe(legacyNormalise(f, c));
          expect(phoneHashOf(f, c)).toBe(
            legacyNormalise(f, c)
              ? hash(legacyNormalise(f, c) as string)
              : null,
          );
          checked++;
        }
    expect(checked).toBeGreaterThan(400);
  });
  it("still reads Ghana, Kenya and South Africa the way it did", () => {
    const typed = [
      "0201234567",
      "+233201234567",
      "233201234567",
      "0712345678",
      "254712345678",
      "+254 712 345678",
      "0821234567",
      "27821234567",
      "+27 (0) 82 123 4567",
      "+233 (0) 20 123 4567",
    ];
    for (const f of typed)
      for (const c of ["GH", "KE", "ZA", "za", undefined])
        expect(normalisePhone(f, c)).toBe(legacyNormalise(f, c));
  });
  it("refuses what it refused", () => {
    for (const bad of [
      "",
      "123",
      "abc",
      "1234567",
      "1234567890123456",
      null,
      undefined,
      8099990001,
      {},
    ])
      expect(normalisePhone(bad)).toBeNull();
    expect(phoneHashOf("123")).toBeNull();
  });
});

describe("normalisePhone, any country", () => {
  it("keeps a number in full international form as it is", () => {
    expect(normalisePhone("+44 7400 123456")).toBe("+447400123456");
    expect(normalisePhone("+1 (201) 555-0123")).toBe("+12015550123");
    expect(normalisePhone("+233 20 123 4567")).toBe("+233201234567");
    expect(normalisePhone("0044 7400 123456", "NG")).toBe("+447400123456");
    expect(normalisePhone("+39 02 1234 5678")).toBe("+390212345678");
    expect(normalisePhone("+81 90 1234 5678", "GB")).toBe("+819012345678");
  });
  it("reads a national number with a leading 0 in the country the request names", () => {
    expect(normalisePhone("07400 123456", "GB")).toBe("+447400123456");
    expect(normalisePhone("07400 123456", "gb")).toBe("+447400123456");
    expect(normalisePhone("0201234567", "GH")).toBe("+233201234567");
    expect(normalisePhone("0901234567", "JP")).toBe("+81901234567");
    expect(normalisePhone("0612345678", "FR")).toBe("+33612345678");
  });
  it("reads a US number, which has no trunk 0, in the country the request names", () => {
    expect(normalisePhone("(201) 555-0123", "US")).toBe("+12015550123");
    expect(normalisePhone("12015550123", "US")).toBe("+12015550123");
  });
  it("falls back to Nigeria for a country it does not know", () => {
    expect(normalisePhone("08099990001", "ZZ")).toBe("+2348099990001");
    expect(normalisePhone("08099990001", 42)).toBe("+2348099990001");
  });
  it("hashes a foreign number by its full international form, whichever way it was typed", () => {
    const want = hash("+447400123456");
    expect(phoneHashOf("+44 7400 123456")).toBe(want);
    expect(phoneHashOf("07400 123456", "GB")).toBe(want);
    expect(phoneHashOf("00447400123456")).toBe(want);
    expect(phoneHashOf("07400 123456", "GB")).not.toBe(
      phoneHashOf("07400 123456"),
    );
  });
  it("refuses a bad number", () => {
    expect(normalisePhone("12345", "GB")).toBeNull();
    expect(normalisePhone("+44 12", "GB")).toBeNull();
    expect(normalisePhone("+1234567890123456")).toBeNull();
    expect(normalisePhone("phone me", "GB")).toBeNull();
    expect(normalisePhone("0123456789012345", "GB")).toBeNull();
    expect(phoneHashOf("12345", "GB")).toBeNull();
  });
});
