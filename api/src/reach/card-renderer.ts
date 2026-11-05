import { execFile } from "node:child_process";
import type { ShareObjectType } from "../generated/prisma/client";

export const CARD_RENDERER = Symbol("CARD_RENDERER");

export type CardSize = "story" | "square";
export const CARD_PIXELS: Record<CardSize, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

/** What a card shows. Text and brand only: never a user photo (CONVENTIONS.md, Share). */
export interface CardSpec {
  objectType: ShareObjectType;
  topicLine: string;
  /** QUESTION and WEEKLY_REPORT: "<voices>|<text>". POLL_RESULT: "<percent>|<label>". ANSWER: [quote]. */
  chips: string[];
  leanLine: string | null;
  basedOnVoices: number | null;
  /** "so far" freshness line, already worded. */
  updatedLine: string;
  newsTag: string | null;
  fallback: boolean;
}

export interface CardRenderer {
  render(spec: CardSpec, size: CardSize): Promise<Buffer>;
}

const COLOURS = {
  bg: "#002b1a",
  panel: "#0e3f2a",
  green: "#0da86a",
  greenText: "#002b1a",
  yellow: "#ffc93c",
  white: "#ffffff",
  soft: "#a9c9b8",
  barBg: "#0e3f2a",
  barRest: "#a9c9b8",
};

const EYEBROW: Record<ShareObjectType, string> = {
  QUESTION: "NIGERIA · QUESTION",
  ANSWER: "NIGERIA · A VOICE",
  POLL_RESULT: "NIGERIA · POLL",
  WEEKLY_REPORT: "NIGERIA · WEEKLY REPORT",
  PROFILE: "NIGERIA · VOICES",
  CATEGORY: "NIGERIA · VOICES",
  RESULT_THREAD: "NIGERIA · RESULTS",
  WHAT_NEXT_SUMMARY: "NIGERIA · WHAT NEXT?",
};

const NEWS_LABEL: Record<string, string> = {
  VERIFIED_NEWS: "VERIFIED NEWS",
  UNVERIFIED_NEWS: "UNVERIFIED NEWS",
  GOSSIP: "GOSSIP",
};

/** Greedy word wrap by an average glyph width. Cuts with "..." past maxLines. */
export function wrap(
  text: string,
  maxWidthPx: number,
  pointSize: number,
  maxLines: number,
): string[] {
  const perLine = Math.max(8, Math.floor(maxWidthPx / (pointSize * 0.56)));
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > perLine ? `${w.slice(0, perLine - 1)}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[ .,;:!?]+$/, "")}...`;
    return kept;
  }
  return lines;
}

/** ImageMagick treats % and \ in text as escapes. Neutralise both so a post can never inject a directive. */
function safe(text: string): string {
  return text.replace(/\\/g, "/").replace(/%/g, "%%");
}

/**
 * Draws cards with ImageMagick's `convert` (no shell: arguments go straight to execFile). Fonts come from the machine:
 * CARD_FONT_DISPLAY, CARD_FONT_BOLD and CARD_FONT_BODY name installed fonts (default Inter).
 */
export class ImageMagickCardRenderer implements CardRenderer {
  private readonly bin = process.env.CARD_CONVERT_BIN ?? "convert";
  private readonly display = process.env.CARD_FONT_DISPLAY ?? "Inter-ExtraBold";
  private readonly bold = process.env.CARD_FONT_BOLD ?? "Inter-Bold";
  private readonly body = process.env.CARD_FONT_BODY ?? "Inter-Medium";

  render(spec: CardSpec, size: CardSize): Promise<Buffer> {
    const args = this.args(spec, size);
    return new Promise((resolve, reject) => {
      execFile(
        this.bin,
        args,
        { encoding: "buffer", timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout) => {
          if (err)
            return reject(new Error(`card render failed: ${err.message}`));
          resolve(stdout);
        },
      );
    });
  }

  args(spec: CardSpec, size: CardSize): string[] {
    const { w, h } = CARD_PIXELS[size];
    const tall = size === "story";
    const left = 72;
    const inner = w - left * 2;
    const a: string[] = ["-size", `${w}x${h}`, `xc:${COLOURS.bg}`];
    const text = (
      font: string,
      pt: number,
      colour: string,
      x: number,
      y: number,
      lines: string[],
    ) => {
      if (lines.length === 0) return;
      a.push(
        "-font",
        font,
        "-pointsize",
        String(pt),
        "-fill",
        colour,
        "-interline-spacing",
        String(Math.round(pt * 0.12)),
        "-gravity",
        "NorthWest",
        "-annotate",
        `+${x}+${y}`,
        safe(lines.join("\n")),
      );
    };
    const rect = (
      colour: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      r: number,
    ) =>
      a.push(
        "-fill",
        colour,
        "-draw",
        `roundrectangle ${x1},${y1} ${x2},${y2} ${r},${r}`,
      );

    // Brand and eyebrow.
    text(this.display, 64, COLOURS.green, left, 72, ["Voices"]);
    const eyebrow = spec.newsTag
      ? `${EYEBROW[spec.objectType]} · ${NEWS_LABEL[spec.newsTag] ?? ""}`
      : EYEBROW[spec.objectType];
    text(this.bold, 28, COLOURS.yellow, left, tall ? 190 : 172, [eyebrow]);

    // Headline.
    const headPt = tall ? 80 : 68;
    const head = wrap(spec.topicLine, inner, headPt, tall ? 6 : 4);
    let y = tall ? 270 : 230;
    text(this.display, headPt, COLOURS.white, left, y, head);
    y += Math.round(head.length * headPt * 1.2) + (tall ? 50 : 30);

    // Body by kind. A flagged post shows nothing but the topic and the call to action.
    if (!spec.fallback) {
      const kind = spec.objectType;
      if (kind === "POLL_RESULT") {
        for (const chip of spec.chips.slice(0, 4)) {
          const { num, label } = split(chip);
          const pct = Math.max(0, Math.min(100, Number(num) || 0));
          text(this.bold, 34, COLOURS.white, left, y, [
            wrap(label, inner - 190, 34, 1)[0] ?? "",
          ]);
          text(this.bold, 34, COLOURS.white, w - left - 170, y, [
            `${Math.round(pct)}%`.padStart(4, " "),
          ]);
          rect(COLOURS.barBg, left, y + 54, w - left, y + 76, 11);
          if (pct > 0)
            rect(
              chip === spec.chips[0] ? COLOURS.yellow : COLOURS.barRest,
              left,
              y + 54,
              left + Math.max(22, Math.round((inner * pct) / 100)),
              y + 76,
              11,
            );
          y += tall ? 130 : 112;
        }
      } else if (kind === "ANSWER") {
        const quote = wrap(spec.chips[0] ?? "", inner - 40, 44, tall ? 9 : 5);
        rect(COLOURS.green, left, y, left + 10, y + quote.length * 54 + 8, 5);
        text(this.body, 44, COLOURS.white, left + 40, y, quote);
        y += quote.length * 54 + 40;
        if (spec.leanLine)
          text(this.bold, 32, COLOURS.soft, left, y, [spec.leanLine]);
        y += 60;
      } else if (spec.chips.length) {
        for (const chip of spec.chips.slice(0, 3)) {
          const { num, label } = split(chip);
          const lines = wrap(label, inner - 70, 36, 2);
          const boxH = lines.length * 44 + 70;
          rect(COLOURS.panel, left, y, w - left, y + boxH, 28);
          text(this.bold, 36, COLOURS.white, left + 35, y + 26, lines);
          if (Number(num) > 0)
            text(
              this.body,
              28,
              COLOURS.soft,
              left + 35,
              y + 26 + lines.length * 44,
              [`${Number(num).toLocaleString("en-NG")} voices`],
            );
          y += boxH + 20;
        }
      }
    }

    // Footer: lean line, freshness, link, and the one call to action.
    const footY = h - 360;
    if (!spec.fallback) {
      let fy = footY;
      if (spec.leanLine && spec.objectType !== "ANSWER") {
        const lean = wrap(spec.leanLine, inner, 34, 2);
        text(this.bold, 34, COLOURS.white, left, fy, lean);
        fy += lean.length * 46 + 12;
      }
      const based =
        spec.basedOnVoices !== null
          ? `Based on ${spec.basedOnVoices.toLocaleString("en-NG")} ${
              spec.objectType === "POLL_RESULT" ? "votes" : "voices"
            } · ${spec.updatedLine}`
          : spec.updatedLine;
      text(this.body, 28, COLOURS.soft, left, fy, [based]);
    }
    text(this.body, 28, COLOURS.soft, left, h - 150, ["wawuafrica.com/voices"]);
    rect(COLOURS.green, w - left - 420, h - 190, w - left, h - 90, 50);
    text(this.display, 38, COLOURS.greenText, w - left - 370, h - 164, [
      "Add your voice",
    ]);

    a.push("png:-");
    return a;
  }
}

function split(chip: string): { num: string; label: string } {
  const i = chip.indexOf("|");
  return i < 0
    ? { num: "0", label: chip }
    : { num: chip.slice(0, i), label: chip.slice(i + 1) };
}
