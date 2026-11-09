import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { wrapText } from "../reach/card-renderer";
import { assetFonts, assetPng, plain } from "../reach/weekly-insta";

/**
 * LCH-07: the voice made into a short video, drawn from the boards VoiceVideo-916 (1080 x 1920) and VoiceVideo-11
 * (1080 x 1080): the VOICES logo, the mood word chip (mood questions only), the question, a moving waveform of the
 * voice, captions from the stored transcript, the address. No photos. At most MAX_SECONDS. The still parts are drawn with
 * resvg (the same fonts as the cards); ffmpeg draws the moving waveform and the progress bar and joins the audio.
 */
export const MAX_SECONDS = 15;
export type VideoShape = "9x16" | "1x1";
export const SHAPES: VideoShape[] = ["9x16", "1x1"];
const FPS = 30;

export interface VideoInput {
  shape: VideoShape;
  question: string;
  /** ANGRY, TIRED, PROUD or HOPEFUL, on a mood answer only. */
  mood: string | null;
  /** "@handle" or the display name with the place, only when the person turned "Show my name on the card" on. */
  who: string | null;
  /** The stored transcript text; null while there is none (no captions are made up). */
  transcript: string | null;
  audio: Buffer;
  /** The clip's length in ms (null when unknown: ffmpeg's own reading is used). */
  durationMs: number | null;
  /** Without the scheme, e.g. usevoices.com */
  host: string;
}

const C = {
  forest: "#002b1a",
  forest2: "#0e3f2a",
  forestLine: "#2d6a4f",
  onForest: "#f5f5f5",
  onForest2: "#a9c9b8",
  green: "#0da86a",
};
const TONE: Record<string, string> = {
  ANGRY: "#ff9b92",
  TIRED: "#ffc870",
  PROUD: "#6edda8",
  HOPEFUL: "#9cc8ff",
};
const FAM = {
  bagel: `font-family="Bagel Fat One" font-weight="400"`,
  semibold: `font-family="Archivo" font-weight="600"`,
  bold: `font-family="Archivo" font-weight="700"`,
  extrabold: `font-family="Archivo" font-weight="800"`,
};

interface Spec {
  w: number;
  h: number;
  padL: number;
  padT: number;
  padB: number;
  logoH: number;
  chipH: number;
  chipPx: number;
  chipPadX: number;
  gap: number;
  h1Top: number;
  h1Px: number;
  h1Lh: number;
  wave: number;
  barGap: number;
  platePadX: number;
  platePadY: number;
  plateR: number;
  platePx: number;
  plateLh: number;
  rowPx: number;
  rowLh: number;
  finalLine: boolean;
}
const SPEC: Record<VideoShape, Spec> = {
  "9x16": {
    w: 1080, h: 1920, padL: 88, padT: 180, padB: 200, logoH: 60, chipH: 64, chipPx: 30, chipPadX: 26, gap: 48,
    h1Top: 40, h1Px: 84, h1Lh: 90, wave: 260, barGap: 10, platePadX: 40, platePadY: 36, plateR: 36, platePx: 50, plateLh: 64,
    rowPx: 32, rowLh: 40, finalLine: true,
  },
  "1x1": {
    w: 1080, h: 1080, padL: 76, padT: 72, padB: 72, logoH: 48, chipH: 54, chipPx: 26, chipPadX: 22, gap: 34,
    h1Top: 0, h1Px: 64, h1Lh: 70, wave: 170, barGap: 8, platePadX: 30, platePadY: 26, plateR: 28, platePx: 38, plateLh: 48,
    rowPx: 26, rowLh: 32, finalLine: false,
  },
};

const esc = (s: string): string =>
  plain(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = (top: number, lh: number, px: number): number => top + lh / 2 + 0.34 * px;
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export interface Layout {
  spec: Spec;
  waveX: number;
  waveY: number;
  waveW: number;
  plateX: number;
  plateY: number;
  plateW: number;
  plateMaxH: number;
  progX: number;
  progY: number;
  progW: number;
  bgSvg: (seconds: number) => string;
}

/** Positions and the still layer of one shape (the board's flex column, worked out). */
export function layoutFor(input: VideoInput): Layout {
  const S = SPEC[input.shape];
  const W = S.w;
  const inner = W - 2 * S.padL;
  const logo = assetPng("logo-wordmark-green.png");
  const hdrH = Math.max(S.logoH, S.chipH);
  let y = S.padT + hdrH + S.gap + S.h1Top;
  // the question: the biggest size that keeps it to three lines
  let px = S.h1Px;
  let lh = S.h1Lh;
  while (px > 48 && wrapText(plain(input.question), "bagel", px, inner, 99, -0.01 * px).length > 3) {
    px -= 4;
    lh = Math.round(px * 1.07);
  }
  const qLines = wrapText(plain(input.question), "bagel", px, inner, 3, -0.01 * px);
  const qTop = y;
  y += qLines.length * lh + S.gap;
  const waveY = y;
  y += S.wave + S.gap;
  const plateY = y;
  const rowTop = S.h - S.padB - (S.finalLine ? 42 + S.gap : 0) - S.rowLh;
  const finalTop = S.h - S.padB - 42;
  const plateMaxH = rowTop - S.gap - plateY;
  const progY = S.h - S.padB - (S.finalLine ? 42 + S.gap : 0) - S.rowLh - 18;
  void progY;
  const url = `${input.host}/go`;
  const bgSvg = (seconds: number): string => {
    const o: string[] = [];
    o.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${S.h}" viewBox="0 0 ${W} ${S.h}">`,
      `<defs><filter id="white" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`,
      `<rect width="${W}" height="${S.h}" fill="${C.forest}"/>`,
      `<image x="${S.padL}" y="${S.padT + (hdrH - S.logoH) / 2}" width="${((S.logoH * 700) / 253).toFixed(1)}" height="${S.logoH}" filter="url(#white)" href="data:image/png;base64,${logo}"/>`,
    );
    if (input.mood) {
      const word = input.mood.toUpperCase();
      const tone = TONE[word] ?? C.onForest;
      const cw = word.length * S.chipPx * 0.72 + 2 * S.chipPadX;
      o.push(
        `<rect x="${W - S.padL - cw}" y="${S.padT + (hdrH - S.chipH) / 2}" width="${cw}" height="${S.chipH}" rx="${S.chipH / 2}" fill="${tone}" fill-opacity="0.18"/>`,
        `<text x="${W - S.padL - cw / 2}" y="${base(S.padT + (hdrH - S.chipH) / 2, S.chipH, S.chipPx)}" text-anchor="middle" ${FAM.extrabold} font-size="${S.chipPx}" letter-spacing="${(S.chipPx * 0.06).toFixed(2)}" fill="${tone}">${esc(word)}</text>`,
      );
    }
    qLines.forEach((l, i) =>
      o.push(
        `<text x="${S.padL}" y="${base(qTop + i * lh, lh, px).toFixed(1)}" ${FAM.bagel} font-size="${px}" letter-spacing="${(-0.01 * px).toFixed(2)}" fill="${C.onForest}">${esc(l)}</text>`,
      ),
    );
    // the track of the waveform bars sits on the still layer; the moving waveform is drawn over it by ffmpeg
    o.push(
      `<text x="${S.padL}" y="${base(rowTop, S.rowLh, S.rowPx)}" ${FAM.semibold} font-size="${S.rowPx}" fill="${C.onForest2}">${esc(S.finalLine ? (input.who ?? "") : url)}</text>`,
      `<text x="${W - S.padL}" y="${base(rowTop, S.rowLh, S.rowPx)}" text-anchor="end" ${FAM.semibold} font-size="${S.rowPx}" fill="${C.onForest2}">${clock(seconds)}</text>`,
    );
    if (S.finalLine)
      o.push(
        `<text x="${S.padL}" y="${base(finalTop, 42, 34)}" ${FAM.bold} font-size="34" fill="${C.onForest}">${esc(`Add your voice: ${url}`)}</text>`,
      );
    o.push("</svg>");
    return o.join("");
  };
  return {
    spec: S,
    waveX: S.padL,
    waveY,
    waveW: inner,
    plateX: S.padL,
    plateY,
    plateW: inner,
    plateMaxH,
    progX: S.padL,
    progY: rowTop - 24,
    progW: inner,
    bgSvg,
  };
}

/** Caption chunks: whole lines grouped so each group fits the plate, with the share of the time each one is shown. */
export function captionChunks(
  text: string,
  L: Layout,
): { lines: string[]; share: number }[] {
  const S = L.spec;
  const width = L.plateW - 2 * S.platePadX;
  const perPlate = Math.max(1, Math.floor((L.plateMaxH - 2 * S.platePadY) / S.plateLh));
  const lines = wrapText(plain(text), "bold", S.platePx, width, 999);
  const groups: string[][] = [];
  for (let i = 0; i < lines.length; i += perPlate) groups.push(lines.slice(i, i + perPlate));
  const kept = groups.slice(0, 8);
  const total = kept.reduce((a, g) => a + g.join(" ").length, 0) || 1;
  return kept.map((g) => ({ lines: g, share: g.join(" ").length / total }));
}

function plateSvg(lines: string[], L: Layout): { svg: string; h: number } {
  const S = L.spec;
  const h = lines.length * S.plateLh + 2 * S.platePadY;
  const t = lines
    .map(
      (l, i) =>
        `<text x="${S.platePadX}" y="${base(S.platePadY + i * S.plateLh, S.plateLh, S.platePx).toFixed(1)}" ${FAM.bold} font-size="${S.platePx}" fill="${C.onForest}">${esc(l)}</text>`,
    )
    .join("");
  return {
    h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${L.plateW}" height="${h}" viewBox="0 0 ${L.plateW} ${h}"><rect width="${L.plateW}" height="${h}" rx="${S.plateR}" fill="${C.forest2}"/>${t}</svg>`,
  };
}

const png = (svg: string): Buffer =>
  Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: "original" },
      font: { fontFiles: assetFonts(), loadSystemFonts: false, defaultFontFamily: "Archivo" },
    })
      .render()
      .asPng(),
  );

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    let out = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", reject);
    p.on("close", (c) => {
      clearTimeout(t);
      c === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${c}: ${err.slice(-400)}`));
    });
  });
}

/** The length of an audio file, in seconds. */
async function probeSeconds(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(out.trim()) || 0;
}

export interface MadeVideo {
  mp4: Buffer;
  durationMs: number;
}

export async function renderVoiceVideo(input: VideoInput): Promise<MadeVideo> {
  const dir = await mkdtemp(join(tmpdir(), "voices-video-"));
  try {
    const audioFile = join(dir, "voice.m4a");
    await writeFile(audioFile, input.audio);
    const known = input.durationMs && input.durationMs > 0 ? input.durationMs / 1000 : await probeSeconds(audioFile);
    const dur = Math.max(1, Math.min(MAX_SECONDS, known || 1));
    const D = dur.toFixed(2);
    const L = layoutFor(input);
    await writeFile(join(dir, "bg.png"), png(L.bgSvg(dur)));
    const chunks = input.transcript?.trim() ? captionChunks(input.transcript, L) : [];
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", String(FPS), "-t", D, "-i", join(dir, "bg.png"), "-i", audioFile];
    const filters: string[] = [];
    const wv = `${L.waveW}x${L.spec.wave}`;
    filters.push(
      `[1:a]atrim=0:${D},asplit=2[aw][ao]`,
      `[aw]showwaves=s=${wv}:mode=cline:rate=${FPS}:colors=0x0da86a:scale=sqrt:draw=full,format=rgba,colorkey=0x000000:0.25:0.1[wv]`,
      `color=c=0x2d6a4f:s=${L.progW}x8:r=${FPS}:d=${D}[tr]`,
      `color=c=0x0da86a:s=${L.progW}x8:r=${FPS}:d=${D}[pb]`,
      `[tr][pb]overlay=x='-w+w*t/${D}':y=0:shortest=1,format=rgba[pg]`,
      `[0:v]format=rgba[b0]`,
      `[b0][wv]overlay=${L.waveX}:${L.waveY}:shortest=1[b1]`,
      `[b1][pg]overlay=${L.progX}:${L.progY}:shortest=1[b2]`,
    );
    let last = "b2";
    let at = 0;
    for (const [i, c] of chunks.entries()) {
      const { svg } = plateSvg(c.lines, L);
      const f = join(dir, `cap${i}.png`);
      await writeFile(f, png(svg));
      args.push("-loop", "1", "-framerate", String(FPS), "-t", D, "-i", f);
      const from = at;
      at += c.share * dur;
      const to = i === chunks.length - 1 ? dur + 1 : at;
      filters.push(`[${last}][${i + 2}:v]overlay=${L.plateX}:${L.plateY}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})':shortest=1[c${i}]`);
      last = `c${i}`;
    }
    filters.push(`[${last}]format=yuv420p[v]`);
    const out = join(dir, "out.mp4");
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "[ao]",
      "-t", D,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out,
    );
    await run("ffmpeg", args);
    return { mp4: await readFile(out), durationMs: Math.round(dur * 1000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
