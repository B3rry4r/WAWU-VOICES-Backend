/**
 * The one country list (PRICES.md countries.list: NG live; GH, KE, ZA coming). GET /countries serves it and the me module
 * validates a person's countryCode against it. A person may pick a country that is "coming" (PATCH /me/profile).
 */
export interface CountryEntry {
  code: string;
  name: string;
  currency: string;
  status: "live" | "coming";
}

export const COUNTRIES: readonly CountryEntry[] = [
  { code: "NG", name: "Nigeria", currency: "NGN", status: "live" },
  { code: "GH", name: "Ghana", currency: "GHS", status: "coming" },
  { code: "KE", name: "Kenya", currency: "KES", status: "coming" },
  { code: "ZA", name: "South Africa", currency: "ZAR", status: "coming" },
];

/** Every code a profile may hold. */
export const COUNTRY_CODES: readonly string[] = COUNTRIES.map((c) => c.code);
