import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { wrapText } from "./card-renderer";

/**
 * LCH-13: the weekly report as Instagram pictures, drawn as SVG from the boards WeeklyInsta-Cover (1080 x 1350) and
 * WeeklyInsta-Story (1080 x 1920). Every word comes from the approved report (headline, mood line, themes, quotes,
 * poll line, emotions and counts as the report shows them); the only other words are the boards' own fixed lines.
 */
export interface InstaReport {
  weekNumber: number;
  topicTitle: string;
  headline: string;
  mood: string | null;
  themes: { label: string; count: number }[];
  emotions: { name: string; share: number }[];
  poll: { pct: number; text: string } | null;
  quotes: { excerpt: string; placeLabel: string }[];
  basedOnVoices: number;
  basedOnVotes: number;
  /** Without the scheme, e.g. usevoices.com */
  host: string;
}

export interface InstaPicture {
  name: string;
  width: number;
  height: number;
  png: Buffer;
}

const C = {
  forest: "#002b1a",
  forest2: "#0e3f2a",
  forestLine: "#2d6a4f",
  onForest: "#f5f5f5",
  onForest2: "#a9c9b8",
  sun: "#ffc845",
  ink: "#f5f5f5",
};
const TONES: Record<string, string> = {
  hopeful: "#9cc8ff",
  angry: "#ff9b92",
  anger: "#ff9b92",
  tired: "#ffc870",
  proud: "#6edda8",
};
const SPARE = ["#9cc8ff", "#ff9b92", "#ffc870", "#6edda8", "#d6b4ff"];
type Font = "bagel" | "regular" | "medium" | "bold" | "extrabold";
const FAMILY: Record<Font, string> = {
  bagel: `font-family="Bagel Fat One" font-weight="400"`,
  regular: `font-family="Archivo" font-weight="400"`,
  medium: `font-family="Archivo" font-weight="500"`,
  bold: `font-family="Archivo" font-weight="700"`,
  extrabold: `font-family="Archivo" font-weight="800"`,
};
const FONT_FILES = [
  "BagelFatOne-Regular.ttf",
  "Archivo-Regular.ttf",
  "Archivo-Medium.ttf",
  "Archivo-Bold.ttf",
  "Archivo-ExtraBold.ttf",
];

/** No em-dashes, no curly quotes or apostrophes on a picture (house rules), whatever the report text holds. */
export function plain(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}
const esc = (s: string): string =>
  plain(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const n = (v: number): string => Math.round(v).toLocaleString("en-US");

function assetsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "assets", "fonts"))) return join(dir, "assets");
    dir = dirname(dir);
  }
  throw new Error("api/assets not found");
}
export const assetFonts = (): string[] =>
  FONT_FILES.map((f) => join(assetsDir(), "fonts", f));
export const assetPng = (f: string): string =>
  readFileSync(join(assetsDir(), f)).toString("base64");

class Canvas {
  out: string[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
    logo: string,
    motif: string | null,
  ) {
    this.out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
      `<defs><filter id="white" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`,
    );
    this.rect(0, 0, w, h, 0, C.forest);
    if (motif)
      this.out.push(
        `<image x="${w - 470}" y="-150" width="620" height="${((620 * 439) / 700).toFixed(0)}" opacity="0.08" href="data:image/png;base64,${motif}"/>`,
      );
    this.logoB64 = logo;
  }
  logoB64: string;
  rect(x: number, y: number, w: number, h: number, r: number, fill: string) {
    this.out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`,
    );
  }
  text(
    font: Font,
    px: number,
    fill: string,
    x: number,
    y: number,
    s: string,
    extra = "",
  ) {
    this.out.push(
      `<text x="${x}" y="${y.toFixed(1)}" ${FAMILY[font]} font-size="${px}" fill="${fill}" ${extra}>${esc(s)}</text>`,
    );
  }
  /** Wrapped lines from top y with line height lh; returns the y after the block. */
  block(
    font: Font,
    px: number,
    lh: number,
    fill: string,
    x: number,
    top: number,
    s: string,
    width: number,
    maxLines: number,
    spacing = 0,
  ): number {
    const lines = wrapText(plain(s), font, px, width, maxLines, spacing);
    lines.forEach((l, i) =>
      this.text(
        font,
        px,
        fill,
        x,
        top + i * lh + lh / 2 + 0.34 * px,
        l,
        spacing ? `letter-spacing="${spacing}"` : "",
      ),
    );
    return top + lines.length * lh;
  }
  logo(x: number, y: number, h: number) {
    this.out.push(
      `<image x="${x}" y="${y}" width="${((h * 700) / 253).toFixed(1)}" height="${h}" filter="url(#white)" href="data:image/png;base64,${this.logoB64}"/>`,
    );
  }
  svg(): string {
    return this.out.join("") + "</svg>";
  }
}

function tone(name: string, i: number): string {
  return TONES[name.toLowerCase()] ?? SPARE[i % SPARE.length];
}

/** The fitted Bagel headline: the biggest size, down to minPx, that fits maxLines. */
function headline(
  c: Canvas,
  s: string,
  x: number,
  top: number,
  width: number,
  px: number,
  lh: number,
  maxLines: number,
  minPx: number,
): number {
  let p = px;
  let l = lh;
  while (
    p > minPx &&
    wrapText(plain(s), "bagel", p, width, 99, -0.01 * p).length > maxLines
  ) {
    p -= 4;
    l = Math.round(p * 1.05);
  }
  return c.block(
    "bagel",
    p,
    l,
    C.onForest,
    x,
    top,
    s,
    width,
    maxLines,
    -0.01 * p,
  );
}

function bar(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  rows: InstaReport["emotions"],
) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.share), 0) || 1;
  let cx = x;
  rows.forEach((r, i) => {
    const rw = Math.max(0, ((w - 4 * (rows.length - 1)) * r.share) / total);
    if (rw > 0) c.rect(cx, y, rw, 36, i === 0 ? 18 : 6, tone(r.name, i));
    cx += rw + 4;
  });
}

function chrome(c: Canvas, r: InstaReport, page: string) {
  c.logo(84, 84, 52);
  c.text(
    "bold",
    26,
    C.sun,
    996,
    84 + 32,
    page,
    `text-anchor="end" letter-spacing="2.6"`,
  );
  void r;
}

function cover(r: InstaReport, logo: string, motif: string): Canvas {
  const c = new Canvas(1080, 1350, logo, motif);
  chrome(c, r, "THE WEEKLY REPORT");
  let y = 84 + 52 + 34;
  y = c.block(
    "bold",
    28,
    36,
    C.onForest2,
    84,
    y,
    `Week ${r.weekNumber} · ${r.topicTitle}`,
    912,
    2,
  );
  y += 34;
  y = headline(c, r.headline, 84, y, 912, 96, 100, 4, 56);
  y += 34;
  const rows = [...r.emotions].sort((a, b) => b.share - a.share).slice(0, 4);
  if (rows.length) {
    bar(c, 84, y, 912, rows);
    y += 36 + 16;
    rows.forEach((e, i) => {
      const x = 84 + (i % 2) * 468;
      const yy = y + Math.floor(i / 2) * 52;
      c.rect(x, yy + 11, 20, 20, 6, tone(e.name, i));
      c.text(
        "bold",
        34,
        C.onForest,
        x + 34,
        yy + 21 + 0.34 * 34,
        `${e.name} ${n(e.share)}%`,
      );
    });
  }
  c.text(
    "bold",
    34,
    C.onForest,
    84,
    1184 + 21 + 0.34 * 34,
    `${n(r.basedOnVoices)} voices \u00B7 ${n(r.basedOnVotes)} votes`,
  );
  c.block(
    "medium",
    28,
    36,
    C.onForest2,
    84,
    1238,
    `Swipe for what Nigerians said. Full report: ${r.host}/weekly`,
    912,
    1,
  );
  return c;
}

function slide(
  r: InstaReport,
  logo: string,
  label: string,
  idx: number,
  total: number,
): Canvas {
  const c = new Canvas(1080, 1350, logo, null);
  chrome(c, r, label);
  c.text(
    "bold",
    26,
    C.onForest2,
    996,
    1350 - 76,
    `${idx} / ${total}`,
    `text-anchor="end"`,
  );
  return c;
}

export function buildCarousel(
  r: InstaReport,
  logo: string,
  motif: string,
): Canvas[] {
  const body: ((c: Canvas) => void)[] = [];
  const labels: string[] = [];
  const emo = [...r.emotions].sort((a, b) => b.share - a.share).slice(0, 5);
  if (emo.length) {
    labels.push("THE MOOD");
    body.push((c) => {
      let y =
        headline(c, r.mood ?? r.headline, 84, 240, 912, 76, 82, 4, 48) + 50;
      bar(c, 84, y, 912, emo);
      y += 36 + 44;
      emo.forEach((e, i) => {
        c.rect(84, y + 14, 24, 24, 7, tone(e.name, i));
        c.text("bold", 44, C.onForest, 130, y + 26 + 0.34 * 44, e.name);
        c.text(
          "extrabold",
          44,
          C.onForest,
          996,
          y + 26 + 0.34 * 44,
          `${n(e.share)}%`,
          `text-anchor="end"`,
        );
        y += 76;
      });
    });
  }
  const themes = r.themes.slice(0, 4);
  if (themes.length) {
    labels.push("MAIN ARGUMENTS");
    body.push((c) => {
      let y = 250;
      for (const t of themes) {
        c.rect(84, y, 912, 190, 32, C.forest2);
        const e = c.block(
          "bold",
          42,
          52,
          C.onForest,
          124,
          y + 34,
          t.label,
          832,
          2,
        );
        c.text(
          "medium",
          28,
          C.onForest2,
          124,
          e + 12 + 18 + 0.34 * 28,
          `${n(t.count)} voices`,
        );
        y += 214;
      }
    });
  }
  if (r.poll) {
    labels.push("THE POLL IN FULL");
    const p = r.poll;
    body.push((c) => {
      c.text("bagel", 300, C.sun, 84, 520, `${n(p.pct)}%`);
      c.block("bold", 56, 68, C.onForest, 84, 580, p.text, 912, 5);
    });
  }
  for (const q of r.quotes.slice(0, 2)) {
    labels.push("IN THEIR OWN WORDS");
    body.push((c) => {
      const e = c.block(
        "bold",
        54,
        68,
        C.onForest,
        84,
        260,
        q.excerpt,
        912,
        10,
      );
      c.text("medium", 30, C.onForest2, 84, e + 40 + 0.34 * 30, q.placeLabel);
    });
  }
  labels.push("THE WEEKLY REPORT");
  body.push((c) => {
    headline(c, r.headline, 84, 300, 912, 96, 100, 4, 56);
    c.block(
      "bold",
      40,
      50,
      C.onForest,
      84,
      880,
      "Read it all and add your voice",
      912,
      2,
    );
    c.text("extrabold", 52, C.sun, 84, 1010, `${r.host}/weekly`);
  });
  const total = body.length + 1;
  const out = [cover(r, logo, motif)];
  body.forEach((fn, i) => {
    const c = slide(r, logo, labels[i], i + 2, total);
    fn(c);
    out.push(c);
  });
  return out;
}

export function buildStory(r: InstaReport, logo: string): Canvas {
  const c = new Canvas(1080, 1920, logo, null);
  c.logo(88, 200, 60);
  c.text(
    "bold",
    30,
    C.sun,
    88,
    200 + 60 + 40 + 38 / 2 + 0.34 * 30,
    `THE WEEKLY REPORT · WEEK ${r.weekNumber}`,
    `letter-spacing="3"`,
  );
  let y =
    headline(c, r.headline, 88, 200 + 60 + 40 + 38 + 40, 904, 112, 116, 4, 64) +
    40;
  for (const t of r.themes.slice(0, 3)) {
    c.rect(88, y, 904, 130 + 20, 32, C.forest2);
    const e = c.block("bold", 38, 46, C.onForest, 122, y + 30, t.label, 836, 2);
    c.text(
      "medium",
      28,
      C.onForest2,
      122,
      e + 6 + 18 + 0.34 * 28,
      `${n(t.count)} voices`,
    );
    y += 150 + 20 + (e - (y + 30) > 46 ? 46 : 0);
  }
  c.text(
    "bold",
    34,
    C.onForest,
    88,
    1602 + 22 + 0.34 * 36,
    `${n(r.basedOnVoices)} voices this week`,
  );
  c.block(
    "medium",
    30,
    38,
    C.onForest2,
    88,
    1662,
    `Read it all and add your voice: ${r.host}/weekly`,
    904,
    1,
  );
  return c;
}

/** The SVG of every picture, in the order drawInstagram renders them (tests read the words from it). */
export function instagramSvgs(r: InstaReport): string[] {
  const logo = assetPng("logo-wordmark-green.png");
  const motif = assetPng("logo-icon-white.png");
  return [...buildCarousel(r, logo, motif), buildStory(r, logo)].map((c) =>
    c.svg(),
  );
}

export function drawInstagram(r: InstaReport): InstaPicture[] {
  const logo = assetPng("logo-wordmark-green.png");
  const motif = assetPng("logo-icon-white.png");
  const fontFiles = assetFonts();
  const render = (name: string, c: Canvas): InstaPicture => ({
    name,
    width: c.w,
    height: c.h,
    png: Buffer.from(
      new Resvg(c.svg(), {
        fitTo: { mode: "original" },
        font: {
          fontFiles,
          loadSystemFonts: false,
          defaultFontFamily: "Archivo",
        },
      })
        .render()
        .asPng(),
    ),
  });
  const slides = buildCarousel(r, logo, motif);
  return [
    ...slides.map((c, i) => render(`carousel-${i + 1}.png`, c)),
    render("story.png", buildStory(r, logo)),
  ];
}

/** A zip with stored (uncompressed) entries: the pictures are PNGs already. */
export function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
