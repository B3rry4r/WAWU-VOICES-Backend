import { textWidth, wrapText } from "./card-renderer";
import type { CardSize, CardSpec } from "./card-renderer";

/**
 * LCH-03: the mood share card in its three sizes, drawn as SVG from the boards ShareCardMood (1200 x 630),
 * ShareCardMood-Square (1080 x 1080) and ShareCardMood-Story (1080 x 1920). Colours are the design-system tokens in
 * their dark theme, as the boards set data-theme="dark" on the word.
 */
const C = {
  forest: "#002b1a",
  forest2: "#0e3f2a",
  onForest: "#f5f5f5",
  onForest2: "#a9c9b8",
  sun: "#ffc845",
  onSun: "#002b1a",
  green: "#0da86a",
  onGreen: "#002b1a",
};
export const MOOD_TONE: Record<string, string> = {
  ANGRY: "#ff9b92",
  TIRED: "#ffc870",
  PROUD: "#6edda8",
  HOPEFUL: "#9cc8ff",
};

export interface MoodCardParts {
  word: string; // ANGRY, TIRED, PROUD or HOPEFUL
  /** The where-you-sit line in sentence form ("You’re with the 38% who feel hopeful." or "You’re one of the first."). */
  line: string;
  /** Only when the person turned "Show my name on the card" on. */
  name: string | null;
  place: string | null;
}

type Font = "bagel" | "regular" | "medium" | "bold" | "extrabold";
const FAMILY: Record<Font, string> = {
  bagel: `font-family="Bagel Fat One" font-weight="400"`,
  regular: `font-family="Archivo" font-weight="400"`,
  medium: `font-family="Archivo" font-weight="500"`,
  bold: `font-family="Archivo" font-weight="700"`,
  extrabold: `font-family="Archivo" font-weight="800"`,
};

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const MOOD_SIZES: Record<
  Exclude<CardSize, never>,
  { w: number; h: number }
> = {
  card: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

interface Layout {
  padL: number;
  padT: number;
  padB: number;
  labelPx: number;
  labelLh: number;
  labelSpacing: number;
  h1Px: number;
  h1Lh: number;
  askPx: number;
  askLh: number;
  gap: number;
  ctaH: number;
  ctaPx: number;
  ctaPadX: number;
  urlPx: number;
  linePx: number;
  nameBlock: boolean;
  namePx: number;
  avatar: number;
  logoH: number;
}

const LAYOUT: Record<CardSize, Layout> = {
  card: {
    padL: 72,
    padT: 60,
    padB: 52,
    labelPx: 22,
    labelLh: 28,
    labelSpacing: 2.64,
    h1Px: 92,
    h1Lh: 96,
    askPx: 40,
    askLh: 48,
    gap: 18,
    ctaH: 56,
    ctaPx: 24,
    ctaPadX: 26,
    urlPx: 20,
    linePx: 22,
    nameBlock: true,
    namePx: 26,
    avatar: 44,
    logoH: 44,
  },
  square: {
    padL: 84,
    padT: 88,
    padB: 80,
    labelPx: 28,
    labelLh: 34,
    labelSpacing: 3.36,
    h1Px: 112,
    h1Lh: 116,
    askPx: 48,
    askLh: 56,
    gap: 28,
    ctaH: 72,
    ctaPx: 30,
    ctaPadX: 34,
    urlPx: 26,
    linePx: 30,
    nameBlock: true,
    namePx: 30,
    avatar: 64,
    logoH: 56,
  },
  story: {
    padL: 88,
    padT: 200,
    padB: 220,
    labelPx: 32,
    labelLh: 40,
    labelSpacing: 3.84,
    h1Px: 136,
    h1Lh: 140,
    askPx: 60,
    askLh: 68,
    gap: 36,
    ctaH: 96,
    ctaPx: 40,
    ctaPadX: 44,
    urlPx: 32,
    linePx: 34,
    nameBlock: true,
    namePx: 34,
    avatar: 72,
    logoH: 64,
  },
};

/** Baseline y for a line box of height lh whose top is at `top`. */
const base = (top: number, lh: number, px: number): number =>
  top + lh / 2 + 0.34 * px;

/** Greedy wrap of the headline words with the mood word kept as its own coloured run. */
function headlineLines(
  word: string,
  px: number,
  max: number,
): { text: string; hl: boolean }[][] {
  const words: { t: string; hl: boolean }[] = [
    { t: "I", hl: false },
    { t: "feel", hl: false },
    { t: word, hl: true },
    { t: "about", hl: false },
    { t: "Nigeria.", hl: false },
  ];
  const sp = -0.01 * px;
  const lines: { t: string; hl: boolean }[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    const joined = [...cur, w].map((x) => x.t).join(" ");
    if (cur.length && textWidth(joined, "bagel", px, sp) > max) lines.push([w]);
    else cur.push(w);
  }
  return lines.map((l) => {
    const runs: { text: string; hl: boolean }[] = [];
    l.forEach((w, i) => {
      const t = i === 0 ? w.t : ` ${w.t}`;
      const last = runs[runs.length - 1];
      if (last && last.hl === w.hl) last.text += t;
      else runs.push({ text: t, hl: w.hl });
    });
    return runs;
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

export function moodCardSvg(
  spec: CardSpec,
  size: CardSize,
  motifB64: string,
  logoB64: string,
): string {
  const m = spec.mood as MoodCardParts;
  const L = LAYOUT[size];
  const { w: W, h: H } = MOOD_SIZES[size];
  const innerW = W - L.padL * 2;
  const tone = MOOD_TONE[m.word] ?? C.sun;
  const out: string[] = [];
  const text = (
    font: Font,
    px: number,
    fill: string,
    x: number,
    y: number,
    s: string,
    extra = "",
  ) =>
    out.push(
      `<text x="${x}" y="${y.toFixed(1)}" ${FAMILY[font]} font-size="${px}" fill="${fill}" ${extra}>${esc(s)}</text>`,
    );
  const rect = (
    x: number,
    y: number,
    rw: number,
    rh: number,
    r: number,
    fill: string,
  ) =>
    out.push(
      `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${r}" fill="${fill}"/>`,
    );
  const logoW = (L.logoH * 700) / 253;
  const logo = (x: number, y: number) =>
    out.push(
      `<image x="${x}" y="${y}" width="${logoW.toFixed(1)}" height="${L.logoH}" filter="url(#white)" href="data:image/png;base64,${logoB64}"/>`,
    );

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><filter id="white" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`,
  );
  rect(0, 0, W, H, 0, C.forest);
  // The faint motif, placed as each board places it.
  const mw = size === "card" ? 520 : size === "square" ? 640 : 760;
  const mh = (mw * 439) / 700;
  const mx =
    size === "card"
      ? W - mw + 110
      : size === "square"
        ? W - mw + 140
        : W - mw + 180;
  const my = size === "card" ? -120 : size === "square" ? H - mh + 160 : 120;
  out.push(
    `<image x="${mx}" y="${my}" width="${mw}" height="${mh.toFixed(1)}" opacity="0.08" href="data:image/png;base64,${motifB64}"/>`,
  );

  let y = L.padT;
  if (size === "story") {
    logo(L.padL, y);
    y += L.logoH + L.gap + 80;
  }
  text(
    "bold",
    L.labelPx,
    C.onForest2,
    L.padL,
    base(y, L.labelLh, L.labelPx),
    "MY VOICE. MY NIGERIA.",
    `letter-spacing="${L.labelSpacing}"`,
  );
  y += L.labelLh + L.gap;

  // Headline: the biggest size at which it takes at most 3 lines.
  let px = L.h1Px;
  let lh = L.h1Lh;
  let lines = headlineLines(m.word, px, innerW);
  while (lines.length > 3 && px > 60) {
    px -= 4;
    lh = Math.round((px * L.h1Lh) / L.h1Px);
    lines = headlineLines(m.word, px, innerW);
  }
  // The 1200 card breaks after the word, as drawn: "I feel HOPEFUL" / "about Nigeria."
  if (size === "card") {
    const first = `I feel ${m.word}`;
    lines = [
      [
        { text: "I feel ", hl: false },
        { text: m.word, hl: true },
      ],
      [{ text: "about Nigeria.", hl: false }],
    ];
    void first;
  }
  for (const runs of lines) {
    const spans = runs
      .map(
        (r) =>
          `<tspan${r.hl ? ` fill="${tone}"` : ""}>${esc(r.text).replace(/ /g, " ")}</tspan>`,
      )
      .join("");
    out.push(
      `<text x="${L.padL}" y="${base(y, lh, px).toFixed(1)}" ${FAMILY.bagel} font-size="${px}" fill="${C.onForest}" letter-spacing="${(-0.01 * px).toFixed(2)}" xml:space="preserve">${spans}</text>`,
    );
    y += lh;
  }
  y += L.gap;
  text(
    "extrabold",
    L.askPx,
    C.onForest,
    L.padL,
    base(y, L.askLh, L.askPx),
    "What about you?",
  );
  y += L.askLh + L.gap;

  // Story: the line sits in a pill under the question, as drawn.
  if (size === "story") {
    const pillH = 72;
    const pw = textWidth(m.line, "bold", L.linePx) + 60;
    rect(L.padL, y, pw, pillH, 36, C.forest2);
    text(
      "bold",
      L.linePx,
      C.onForest,
      L.padL + 30,
      base(y, pillH, L.linePx),
      m.line,
    );
    y += pillH + L.gap;
  }

  if (m.name) {
    const label = m.place ? `${m.name} · ${m.place}` : m.name;
    const maxW = innerW - L.avatar - 18;
    const fitted = wrapText(label, "bold", L.namePx, maxW, 1)[0];
    const cy = y + L.avatar / 2;
    out.push(
      `<circle cx="${L.padL + L.avatar / 2}" cy="${cy}" r="${L.avatar / 2}" fill="${C.sun}"/>`,
    );
    text(
      "bold",
      Math.round(L.avatar * 0.38),
      C.onSun,
      L.padL + L.avatar / 2,
      cy + L.avatar * 0.13,
      initials(m.name),
      `text-anchor="middle"`,
    );
    text(
      "bold",
      L.namePx,
      C.onForest,
      L.padL + L.avatar + 18,
      cy + 0.34 * L.namePx,
      fitted,
    );
  }

  // Footer, anchored to the bottom padding.
  const bottom = H - L.padB;
  const url = spec.url;
  if (size === "card") {
    const ctaY = bottom - L.ctaH;
    logo(L.padL, ctaY + (L.ctaH - L.logoH) / 2);
    const ctaX = L.padL + logoW + 24;
    const ctaW =
      L.ctaPadX * 2 + textWidth("Add your voice", "extrabold", L.ctaPx);
    rect(ctaX, ctaY, ctaW, L.ctaH, L.ctaH / 2, C.green);
    text(
      "extrabold",
      L.ctaPx,
      C.onGreen,
      ctaX + L.ctaPadX,
      base(ctaY, L.ctaH, L.ctaPx),
      "Add your voice",
    );
    const right = W - L.padL;
    // two right-aligned lines: the where-you-sit line, then the link
    text(
      "medium",
      L.urlPx,
      C.onForest2,
      right,
      bottom - 3 - 0.0,
      url,
      `text-anchor="end"`,
    );
    text(
      "bold",
      L.linePx,
      C.onForest,
      right,
      bottom - 26 - 8,
      m.line,
      `text-anchor="end"`,
    );
  } else if (size === "square") {
    const urlY = bottom;
    text("medium", L.urlPx, C.onForest2, L.padL, urlY - 6, url);
    const ctaY = urlY - 32 - 22 - L.ctaH;
    logo(L.padL, ctaY + (L.ctaH - L.logoH) / 2);
    const ctaX = L.padL + logoW + 28;
    const ctaW =
      L.ctaPadX * 2 + textWidth("Add your voice", "extrabold", L.ctaPx);
    rect(ctaX, ctaY, ctaW, L.ctaH, L.ctaH / 2, C.green);
    text(
      "extrabold",
      L.ctaPx,
      C.onGreen,
      ctaX + L.ctaPadX,
      base(ctaY, L.ctaH, L.ctaPx),
      "Add your voice",
    );
    text("bold", L.linePx, C.onForest, L.padL, ctaY - 22 - 8, m.line);
  } else {
    text("medium", L.urlPx, C.onForest2, L.padL, bottom - 8, url);
    const ctaY = bottom - 40 - 24 - L.ctaH;
    const ctaW =
      L.ctaPadX * 2 + textWidth("Add your voice", "extrabold", L.ctaPx);
    rect(L.padL, ctaY, ctaW, L.ctaH, L.ctaH / 2, C.green);
    text(
      "extrabold",
      L.ctaPx,
      C.onGreen,
      L.padL + L.ctaPadX,
      base(ctaY, L.ctaH, L.ctaPx),
      "Add your voice",
    );
  }
  out.push("</svg>");
  return out.join("");
}
