import { spawn } from "node:child_process";
import { niceCommand } from "./normalise.js";

/** Waveform bars: decode to 8 kHz mono s16 PCM, take the max abs sample per bucket, scale to 0..255 (peak-normalised). */
export async function peaks(input: Buffer, bars = 48): Promise<number[]> {
  const pcm: Buffer = await new Promise((resolve, reject) => {
    const [c, a] = niceCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      "pipe:1",
    ]);
    const p = spawn(c, a);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error("ffmpeg peaks exit " + code)),
    );
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
  return peaksFromPcm(pcm, bars);
}

export function peaksFromPcm(pcm: Buffer, bars: number): number[] {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return new Array<number>(bars).fill(0);
  const per = Math.max(1, Math.floor(n / bars));
  const raw: number[] = [];
  for (let b = 0; b < bars; b++) {
    let m = 0;
    for (let i = b * per; i < Math.min(n, (b + 1) * per); i++)
      m = Math.max(m, Math.abs(pcm.readInt16LE(i * 2)));
    raw.push(m);
  }
  const top = Math.max(...raw, 1);
  return raw.map((v) => Math.round((v / top) * 255));
}
