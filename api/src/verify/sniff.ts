/** V-46: the real type of an uploaded document, read from its first bytes. The file name and the declared type are never trusted. */
export type DocMime =
  "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "heif",
]);

export const DOC_MAX_BYTES = 10 * 1024 * 1024;

export function sniffDocument(b: Buffer): DocMime | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b[0] === 0x89 &&
    b.toString("latin1", 1, 4) === "PNG" &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  if (
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    return null;
  }
  if (b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}
