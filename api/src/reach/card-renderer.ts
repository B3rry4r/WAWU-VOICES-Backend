import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { ADVANCE } from "./font-metrics";

export const CARD_RENDERER = Symbol("CARD_RENDERER");

/** The one card: 1200 x 630, drawn on the share boards and used as og:image (V-22). */
export const CARD_W = 1200;
export const CARD_H = 630;

export const STORY_W = 1080;
export const STORY_H = 1920;
export type CardSize = "card" | "story";

export type CardKind = "question" | "poll" | "voice" | "weekly" | "plain";

/** What a card shows. Text and brand only: never a user photo (CONVENTIONS.md, Share). */
export interface CardSpec {
  kind: CardKind;
  /** Top right, before upper-casing: "Nigeria · Today's question". */
  label: string;
  headline: string;
  /** question kind: up to 3 argument tiles, the first one filled green. */
  args: { text: string; voices: number }[];
  /** poll and weekly kinds: bars. */
  rows: { label: string; pct: number }[];
  /** an open poll says "so far" on its leading row. */
  pollOpen: boolean;
  /** voice kind. */
  quote: string | null;
  /** The bold line in the footer, already worded ("so far", never "agree"). */
  summary: string | null;
  basedOnVoices: number | null;
  updated: string;
  newsTag: "verified" | "unverified" | "gossip" | null;
  /** A flagged post: the topic and the call to action only. */
  fallback: boolean;
  /** The real address, from PUBLIC_WEB_BASE, without the scheme. */
  url: string;
}

export interface CardRenderer {
  /** size: "story" is the 1080 x 1920 Instagram Stories card; the default is the 1200 x 630 card. */
  render(spec: CardSpec, size?: CardSize): Promise<Buffer>;
}

// Colours are the VOICES tokens the share card uses (design system tokens.css, light card on forest).
const C = {
  forest: "#002b1a",
  forest2: "#0e3f2a",
  onForest: "#f5f5f5",
  onForest2: "#a9c9b8",
  sun: "#ffc845",
  green: "#0da86a",
  onGreen: "#002b1a",
};
const TAGS = {
  verified: {
    fg: "#1450a8",
    bg: "#ddebfb",
    label: "Verified News",
    icon: [
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
      '<path d="m9 12 2 2 4-4"/>',
    ],
  },
  unverified: {
    fg: "#8a4600",
    bg: "#ffedc9",
    label: "Unverified News",
    icon: [
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
      '<path d="M12 8v4"/>',
      '<path d="M12 16h.01"/>',
    ],
  },
  gossip: {
    fg: "#9a1b63",
    bg: "#fbe0ef",
    label: "Gossip",
    icon: [
      '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/>',
      '<path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    ],
  },
} as const;
const MIC = [
  '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>',
  '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>',
  '<line x1="12" x2="12" y1="19" y2="22"/>',
];

type FontKey = "bagel" | "regular" | "medium" | "bold" | "extrabold";
const FAMILY: Record<FontKey, string> = {
  bagel: `font-family="Bagel Fat One" font-weight="400"`,
  regular: `font-family="Archivo" font-weight="400"`,
  medium: `font-family="Archivo" font-weight="500"`,
  bold: `font-family="Archivo" font-weight="700"`,
  extrabold: `font-family="Archivo" font-weight="800"`,
};

/** Width in px of text set in a shipped font (glyphs the font lacks count as an average one). */
export function textWidth(
  text: string,
  font: FontKey,
  px: number,
  spacing = 0,
): number {
  const table = ADVANCE[font];
  let w = 0;
  for (const ch of text) w += (table[ch] ?? 0.55) * px + spacing;
  return w;
}

/** A word wider than the line is cut into pieces that each fit it (a 280 character unbroken quote, a long link). */
function breakLongWord(
  word: string,
  font: FontKey,
  px: number,
  maxWidth: number,
  spacing: number,
): string[] {
  if (textWidth(word, font, px, spacing) <= maxWidth) return [word];
  const pieces: string[] = [];
  let cur = "";
  for (const ch of word) {
    if (cur && textWidth(cur + ch, font, px, spacing) > maxWidth) {
      pieces.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** Greedy word wrap by real glyph widths. Cuts the last line with "..." past maxLines. */
export function wrapText(
  text: string,
  font: FontKey,
  px: number,
  maxWidth: number,
  maxLines: number,
  spacing = 0,
): string[] {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => breakLongWord(w, font, px, maxWidth, spacing));
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, font, px, spacing) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1].replace(/[ .,;:!?]+$/, "");
  // lead ruling WF, 6 Nov (B-M2): the ellipsis goes after a whole word. Letters are dropped only for one long word.
  while (
    last.length > 1 &&
    textWidth(`${last}...`, font, px, spacing) > maxWidth
  ) {
    const space = last.lastIndexOf(" ");
    last =
      space > 0
        ? last.slice(0, space).replace(/[ .,;:!?]+$/, "")
        : last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = `${last}...`;
  return kept;
}

/**
 * The headline of the 1200x630 card: the biggest size (down to minPx) at which all of it fits in the lines the room
 * allows; only then an ellipsis, after a whole word (B-M2).
 */
export function fitHeadline(
  text: string,
  font: FontKey,
  o: {
    px: number;
    lh: number;
    width: number;
    room: number;
    maxLines: number;
    minPx: number;
  },
): { px: number; lh: number; lines: string[] } {
  let { px, lh } = o;
  const cap = () => Math.max(1, Math.min(o.maxLines, Math.floor(o.room / lh)));
  while (
    px > o.minPx &&
    wrapText(text, font, px, o.width, 99, -0.01 * px).length > cap()
  ) {
    px -= 2;
    lh = Math.round(px * 1.07);
  }
  return {
    px,
    lh,
    lines: wrapText(text, font, px, o.width, cap(), -0.01 * px),
  };
}

/** 12480 -> "12.5K"; 6900 -> "6,900" (the design system's short()). */
export function short(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assetsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "assets", "fonts"))) return join(dir, "assets");
    dir = dirname(dir);
  }
  throw new Error("api/assets not found (fonts and logo)");
}

const FONT_FILES = [
  "BagelFatOne-Regular.ttf",
  "Archivo-Regular.ttf",
  "Archivo-Medium.ttf",
  "Archivo-Bold.ttf",
  "Archivo-ExtraBold.ttf",
];

function makeDraw(out: string[]) {
  const text = (
    font: FontKey,
    px: number,
    fill: string,
    x: number,
    baseline: number,
    s: string,
    extra = "",
  ) =>
    out.push(
      `<text x="${x}" y="${baseline.toFixed(1)}" ${FAMILY[font]} font-size="${px}" fill="${fill}" ${extra}>${esc(s)}</text>`,
    );
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
  ) =>
    out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`,
    );
  const icon = (
    paths: readonly string[],
    x: number,
    y: number,
    size: number,
    stroke: string,
    sw: number,
  ) =>
    out.push(
      `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</g>`,
    );
  return { text, rect, icon };
}

/**
 * Draws the card as SVG and rasterises it in process with resvg (no shell, no system fonts: Bagel Fat One and Archivo
 * ship in api/assets/fonts, OFL). Measurements come from the shipped fonts, so wrapping matches what is drawn.
 */
export class ResvgCardRenderer implements CardRenderer {
  private assets = resolve(assetsDir());
  private fontFiles = FONT_FILES.map((f) => join(this.assets, "fonts", f));
  private logo = readFileSync(
    join(this.assets, "logo-wordmark-green.png"),
  ).toString("base64");
  private motif = readFileSync(
    join(this.assets, "logo-icon-white.png"),
  ).toString("base64");

  render(spec: CardSpec, size: CardSize = "card"): Promise<Buffer> {
    try {
      const svg = size === "story" ? this.storySvg(spec) : this.svg(spec);
      const png = new Resvg(svg, {
        fitTo: { mode: "original" },
        font: {
          fontFiles: this.fontFiles,
          loadSystemFonts: false,
          defaultFontFamily: "Archivo",
        },
      })
        .render()
        .asPng();
      return Promise.resolve(Buffer.from(png));
    } catch (e) {
      return Promise.reject(new Error(`card render failed: ${String(e)}`));
    }
  }

  /**
   * The Instagram Stories card, 1080 x 1920: the same parts and colours as the 1200 x 630 card, stacked for a tall frame.
   * Logo and label at the top, the headline, the body (tiles, bars or the quote), the footer lines, then the button
   * across the full width, kept clear of Stories' top and bottom UI strips.
   */
  storySvg(spec: CardSpec): string {
    const W = STORY_W;
    const H = STORY_H;
    const out: string[] = [];
    const { text, rect, icon } = makeDraw(out);
    const SAFE = 250; // Instagram covers the top and bottom 250 px with its own UI
    const PAD = 80;
    const RIGHT = W - PAD;
    const INNER = W - 2 * PAD;
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    );
    rect(0, 0, W, H, 0, C.forest);
    const mw = 900;
    const mh = (mw * 439) / 700;
    out.push(
      `<image x="${W - mw + 200}" y="${H + 240 - mh}" width="${mw}" height="${mh}" opacity="0.08" href="data:image/png;base64,${this.motif}"/>`,
    );

    const groupAt = out.length;
    // Top: Stories covers the first ~250 px with its own bar, so the logo starts at 250.
    const logoH = 96;
    const logoY = SAFE;
    const logoW = (logoH * 700) / 253;
    out.push(
      `<image x="${PAD}" y="${logoY}" width="${logoW}" height="${logoH}" href="data:image/png;base64,${this.logo}"/>`,
    );
    if (spec.newsTag && !spec.fallback) {
      const t = TAGS[spec.newsTag];
      const tx = PAD + logoW + 28;
      const w = 16 + 32 + 10 + textWidth(t.label, "bold", 26, 0.52) + 22;
      rect(tx, logoY + 20, w, 56, 14, t.bg);
      icon(t.icon, tx + 16, logoY + 32, 32, t.fg, 2.5);
      text(
        "bold",
        26,
        t.fg,
        tx + 16 + 32 + 10,
        logoY + 58.5,
        t.label,
        `letter-spacing="0.52"`,
      );
    }
    text(
      "bold",
      26,
      C.sun,
      PAD,
      logoY + logoH + 62,
      spec.label.toUpperCase(),
      `letter-spacing="2.08"`,
    );

    // Bottom stack (from the bottom up): 220 px clear for Stories, the 120 px button, a gap, three 40 px lines.
    const ctaH = 120;
    const ctaY = H - SAFE - ctaH;
    const footTop = ctaY - 48 - 120;
    let cursor = logoY + logoH + 62 + 56;
    const midLimit = footTop - 40;

    const hPx = spec.kind === "voice" ? 52 : 88;
    const hLh = spec.kind === "voice" ? 60 : 94;
    const hColour = spec.kind === "voice" ? C.onForest2 : C.onForest;

    let bodyH = 0;
    let bodyDraw: ((y: number) => void) | null = null;
    if (!spec.fallback && spec.kind === "question" && spec.args.length) {
      const args = spec.args.slice(0, 3);
      const gap = 20;
      const wrapped = args.map((a) =>
        wrapText(a.text, "bold", 36, INNER - 72, 2),
      );
      const tileHs = wrapped.map((l) => 40 + l.length * 46 + 4 + 36 + 4);
      bodyH = tileHs.reduce((a, b) => a + b, 0) + gap * (args.length - 1);
      bodyDraw = (y) => {
        let ty = y;
        args.forEach((a, i) => {
          const first = i === 0;
          rect(PAD, ty, INNER, tileHs[i], 32, first ? C.green : C.forest2);
          const fg = first ? C.onGreen : C.onForest;
          wrapped[i].forEach((line, j) =>
            text("bold", 36, fg, PAD + 36, ty + 20 + j * 46 + 34, line),
          );
          const sy = ty + 20 + wrapped[i].length * 46 + 4;
          text(
            "medium",
            30,
            fg,
            PAD + 36,
            sy + 29,
            `${short(a.voices)} voices`,
            `opacity="0.85"`,
          );
          ty += tileHs[i] + gap;
        });
      };
    } else if (
      !spec.fallback &&
      (spec.kind === "poll" || spec.kind === "weekly") &&
      spec.rows.length
    ) {
      const rows = spec.rows.slice(0, 4);
      const rowH = 96;
      bodyH = rows.length * rowH + (rows.length - 1) * 20;
      bodyDraw = (y) =>
        rows.forEach((r, i) => {
          const ry = y + i * (rowH + 20);
          const pct = Math.max(0, Math.min(100, r.pct));
          text("bold", 36, C.onForest, PAD, ry + 34, r.label);
          text(
            "bold",
            36,
            C.onForest,
            RIGHT,
            ry + 34,
            `${Math.round(pct)}%${i === 0 && spec.kind === "poll" && spec.pollOpen ? " so far" : ""}`,
            `text-anchor="end"`,
          );
          rect(PAD, ry + 54, INNER, 30, 15, C.forest2);
          if (pct > 0)
            rect(
              PAD,
              ry + 54,
              Math.max(30, (INNER * pct) / 100),
              30,
              15,
              i === 0 ? C.sun : C.onForest2,
            );
        });
    } else if (!spec.fallback && spec.kind === "voice" && spec.quote) {
      // The quote takes the largest size that fits the room above the footer, so a short one is big and a 280
      // character one still fits.
      const quote = `“${spec.quote}”`;
      const roomQ = midLimit - cursor - (2 * hLh + 40) - 40;
      let qPx = 40;
      let lines = wrapText(quote, "regular", qPx, INNER, 99);
      for (let px = 68; px >= 40; px -= 4) {
        const l = wrapText(quote, "regular", px, INNER, 99);
        if (l.length * Math.round(px * 1.3) <= roomQ) {
          qPx = px;
          lines = l;
          break;
        }
      }
      const qLh = Math.round(qPx * 1.3);
      const maxQ = Math.max(1, Math.floor(roomQ / qLh));
      if (lines.length > maxQ)
        lines = wrapText(quote, "regular", qPx, INNER, maxQ);
      bodyH = lines.length * qLh;
      bodyDraw = (y) =>
        lines.forEach((l, i) =>
          text("regular", qPx, C.onForest, PAD, y + i * qLh + qPx * 0.95, l),
        );
    }

    const room = midLimit - cursor - (bodyH ? bodyH + 40 : 0);
    const maxHead = Math.max(1, Math.min(6, Math.floor(room / hLh)));
    const head = wrapText(
      spec.headline,
      "bagel",
      hPx,
      INNER,
      maxHead,
      -0.01 * hPx,
    );
    head.forEach((l, i) =>
      text(
        "bagel",
        hPx,
        hColour,
        PAD,
        cursor + i * hLh + hLh / 2 + 0.34 * hPx + 3.5,
        l,
        `letter-spacing="${(-0.01 * hPx).toFixed(2)}"`,
      ),
    );
    cursor += head.length * hLh + 40;
    if (bodyDraw) bodyDraw(cursor);
    // Centre the main group (logo, label, title, body) between the top safe zone and the footer.
    const groupTop = logoY;
    const groupBottom = cursor + bodyH;
    const zoneBottom = footTop - 60;
    const dy = Math.max(
      0,
      Math.round(
        SAFE + (zoneBottom - SAFE - (groupBottom - groupTop)) / 2 - groupTop,
      ),
    );
    out.splice(groupAt, 0, `<g transform="translate(0 ${dy})">`);
    out.push("</g>");

    if (spec.fallback) {
      text("medium", 30, C.onForest2, PAD, footTop + 80 + 30, spec.url);
    } else {
      // A profile (a plain card) has no split line: only polls, questions and reports speak of what people think.
      const summary =
        spec.summary ??
        (spec.kind === "plain" ? null : "People are split so far.");
      if (summary) text("bold", 30, C.onForest, PAD, footTop + 30, summary);
      const based =
        spec.basedOnVoices !== null
          ? `Based on ${short(spec.basedOnVoices)} voices · updated ${spec.updated}`
          : `Updated ${spec.updated}`;
      text("medium", 30, C.onForest2, PAD, footTop + 40 + 30, based);
      text("medium", 30, C.onForest2, PAD, footTop + 80 + 30, spec.url);
    }
    const ctaText = "Add your voice";
    const contentW = 48 + 20 + textWidth(ctaText, "extrabold", 42);
    rect(PAD, ctaY, INNER, ctaH, 60, C.green);
    const startX = PAD + (INNER - contentW) / 2;
    icon(MIC, startX, ctaY + 36, 48, C.onGreen, 2.5);
    text(
      "extrabold",
      42,
      C.onGreen,
      startX + 48 + 20,
      ctaY + ctaH / 2 + 15,
      ctaText,
    );

    out.push("</svg>");
    return out.join("");
  }

  svg(spec: CardSpec): string {
    const out: string[] = [];
    const { text, rect, icon } = makeDraw(out);

    const PAD_X = 64;
    const RIGHT = CARD_W - PAD_X;
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">`,
    );
    rect(0, 0, CARD_W, CARD_H, 0, C.forest);
    // The faint V watermark: right -120, bottom -150, 560 wide, 8% opacity.
    const mw = 560;
    const mh = (mw * 439) / 700;
    out.push(
      `<image x="${CARD_W - mw + 120}" y="${CARD_H + 150 - mh}" width="${mw}" height="${mh}" opacity="0.08" href="data:image/png;base64,${this.motif}"/>`,
    );

    // Top row: logo, optional news tag, label on the right (64 high).
    const logoW = (64 * 700) / 253;
    out.push(
      `<image x="${PAD_X}" y="56" width="${logoW}" height="64" href="data:image/png;base64,${this.logo}"/>`,
    );
    if (spec.newsTag && !spec.fallback) {
      const t = TAGS[spec.newsTag];
      const tx = PAD_X + logoW + 20;
      const w = 12 + 22 + 8 + textWidth(t.label, "bold", 18, 0.36) + 16;
      rect(tx, 68, w, 40, 10, t.bg);
      icon(t.icon, tx + 12, 77, 22, t.fg, 2.5);
      text(
        "bold",
        18,
        t.fg,
        tx + 12 + 22 + 8,
        94.3,
        t.label,
        `letter-spacing="0.36"`,
      );
    }
    text(
      "bold",
      18,
      C.sun,
      RIGHT,
      94.3,
      spec.label.toUpperCase(),
      `text-anchor="end" letter-spacing="1.44"`,
    );

    // Foot geometry is fixed: three 28 px lines ending 56 px above the bottom, and the 76 px button.
    const FOOT_TOP = CARD_H - 56 - 84;
    let cursor = 56 + 64 + 22;
    const midLimit = FOOT_TOP - 22;

    const headlineFont: FontKey = "bagel";
    let hPx = spec.kind === "voice" ? 36 : 60;
    let hLh = spec.kind === "voice" ? 42 : 64;
    const hColour = spec.kind === "voice" ? C.onForest2 : C.onForest;
    const hMax = 17 * textWidth("0", headlineFont, hPx, -0.01 * hPx);

    // Body first, so the headline can give up a line when the body needs the room.
    let bodyH = 0;
    let bodyDraw: ((y: number) => void) | null = null;

    if (!spec.fallback && spec.kind === "question" && spec.args.length) {
      const args = spec.args.slice(0, 3);
      const gap = 14;
      const tileW =
        (CARD_W - 2 * PAD_X - gap * (args.length - 1)) / args.length;
      const wrapped = args.map((a) =>
        wrapText(a.text, "bold", 22, tileW - 44, 3),
      );
      const maxLines = Math.max(...wrapped.map((l) => l.length));
      const tileH = 28 + maxLines * 28 + 2 + 24;
      bodyH = tileH;
      bodyDraw = (y) =>
        args.forEach((a, i) => {
          const x = PAD_X + i * (tileW + gap);
          const first = i === 0;
          rect(x, y, tileW, tileH, 22, first ? C.green : C.forest2);
          const fg = first ? C.onGreen : C.onForest;
          wrapped[i].forEach((line, j) =>
            text("bold", 22, fg, x + 22, y + 14 + j * 28 + 20.3, line),
          );
          const sy = y + 14 + wrapped[i].length * 28 + 2;
          text(
            "medium",
            19,
            fg,
            x + 22,
            sy + 17.7,
            `${short(a.voices)} voices`,
            `opacity="0.85"`,
          );
        });
    } else if (
      !spec.fallback &&
      (spec.kind === "poll" || spec.kind === "weekly") &&
      spec.rows.length
    ) {
      const rows = spec.rows.slice(0, 4);
      bodyH = rows.length * 48 + (rows.length - 1) * 10;
      bodyDraw = (y) =>
        rows.forEach((r, i) => {
          const ry = y + i * 58;
          const pct = Math.max(0, Math.min(100, r.pct));
          text("bold", 24, C.onForest, PAD_X, ry + 22.4, r.label);
          text(
            "bold",
            24,
            C.onForest,
            PAD_X + 760,
            ry + 22.4,
            `${Math.round(pct)}%${i === 0 && spec.kind === "poll" && spec.pollOpen ? " so far" : ""}`,
            `text-anchor="end"`,
          );
          rect(PAD_X, ry + 30, 760, 18, 9, C.forest2);
          if (pct > 0)
            rect(
              PAD_X,
              ry + 30,
              Math.max(18, (760 * pct) / 100),
              18,
              9,
              i === 0 ? C.sun : C.onForest2,
            );
        });
    } else if (!spec.fallback && spec.kind === "voice" && spec.quote) {
      const qFont: FontKey = "regular";
      const qMax = 31.5 * textWidth("0", qFont, 34);
      const lines = wrapText(`“${spec.quote}”`, qFont, 34, qMax, 6);
      bodyH = lines.length * 44;
      bodyDraw = (y) =>
        lines.forEach((l, i) =>
          text(qFont, 34, C.onForest, PAD_X, y + i * 44 + 30.4, l),
        );
    }

    const room = midLimit - cursor - (bodyH ? bodyH + 22 : 0);
    // lead ruling WF, 6 Nov (B-M2): shrink the headline a step at a time until every word fits in the lines there
    // are, before any ellipsis. The line width stays the one the full size was drawn for.
    const fit = fitHeadline(spec.headline, headlineFont, {
      px: hPx,
      lh: hLh,
      width: hMax,
      room,
      maxLines: 3,
      minPx: spec.kind === "voice" ? 26 : 34,
    });
    hPx = fit.px;
    hLh = fit.lh;
    const head = fit.lines;
    head.forEach((l, i) =>
      text(
        headlineFont,
        hPx,
        hColour,
        PAD_X,
        cursor + i * hLh + hLh / 2 + 0.34 * hPx + 3.5,
        l,
        `letter-spacing="${(-0.01 * hPx).toFixed(2)}"`,
      ),
    );
    cursor += head.length * hLh + 22;
    if (bodyDraw) bodyDraw(cursor);

    // Footer: summary, "Based on", address; the call to action on the right.
    if (spec.fallback) {
      text("medium", 20, C.onForest2, PAD_X, FOOT_TOP + 56 + 21, spec.url);
    } else {
      const summary =
        spec.summary ??
        (spec.kind === "plain" ? null : "People are split so far.");
      if (summary) text("bold", 20, C.onForest, PAD_X, FOOT_TOP + 21, summary);
      const based =
        spec.basedOnVoices !== null
          ? `Based on ${short(spec.basedOnVoices)} voices · updated ${spec.updated}`
          : `Updated ${spec.updated}`;
      text("medium", 20, C.onForest2, PAD_X, FOOT_TOP + 28 + 21, based);
      text("medium", 20, C.onForest2, PAD_X, FOOT_TOP + 56 + 21, spec.url);
    }
    const ctaText = "Add your voice";
    const ctaW = 40 + 32 + 12 + textWidth(ctaText, "extrabold", 30) + 40;
    const ctaX = RIGHT - ctaW;
    const ctaY = CARD_H - 56 - 76;
    rect(ctaX, ctaY, ctaW, 76, 38, C.green);
    icon(MIC, ctaX + 40, ctaY + 22, 32, C.onGreen, 2.5);
    text(
      "extrabold",
      30,
      C.onGreen,
      ctaX + 40 + 32 + 12,
      ctaY + 38 + 10.5,
      ctaText,
    );

    out.push("</svg>");
    return out.join("");
  }
}
