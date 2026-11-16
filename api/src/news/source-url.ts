import { UnprocessableEntityException } from "@nestjs/common";

/** A news source link is a full http(s) address (the same rule the editors' queue applies). */
export function checkSourceUrl(url: string | undefined): void {
  if (!url?.trim()) return;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    throw new UnprocessableEntityException({
      code: "VALIDATION_FAILED",
      message: "Some details need fixing.",
      details: {
        fields: [
          {
            path: "newsSourceUrl",
            message: "Use a full link that starts with https://.",
          },
        ],
      },
    });
  }
}
