import { convertOnePass } from "./normalise.js";
import { peaks, peaksFromPcm } from "./peaks.js";
import {
  withinLimit,
  MAX_SECONDS,
  RAW_MAX_BYTES,
  type VoiceTier,
} from "./limits.js";

// For a clip with no duration header: encode up to this many seconds past the tier limit so an over-long clip is seen and refused.
const UNKNOWN_DURATION_HEADROOM = 5;

export interface ProcessedClip {
  audio: Buffer;
  durationSeconds: number;
  peaks: number[];
  bytes: number;
}

/**
 * After the raw upload lands: size check, then ONE ffmpeg pass that converts, measures and makes the waveform samples
 * (LCH-09, DECISIONS V-39; it was probe, convert, probe, waveform: four processes). Throws a named Error on rejection.
 *
 * Nothing is probed first, because nothing before the conversion needs it: a file that is not audio makes ffmpeg fail, which
 * is "not_audio" as before; the over-long answer needs only the converted length, and the conversion is cut at the tier's
 * limit plus headroom so an over-long file costs at most that much work. The headroom is the one the old code used for a file
 * with no length in its header (it never truncates a clip that is within the limit, and an over-long one is still refused).
 */
export async function processClip(
  raw: Buffer,
  tier: VoiceTier,
): Promise<ProcessedClip> {
  if (raw.length > RAW_MAX_BYTES[tier]) throw new Error("too_large");
  const done = await convertOnePass(
    raw,
    MAX_SECONDS[tier] + UNKNOWN_DURATION_HEADROOM,
  ).catch((e: unknown) => {
    // ffmpeg could not read it: not_audio. ffmpeg that exited 0 with nothing usable (an MP4 whose header is at the end cannot
    // be read from a pipe) is the old chain's unnamed failure, so the person gets the same reason as before (processing_error).
    throw new Error(
      e instanceof Error && e.message === "no movie header"
        ? "no_output"
        : "not_audio",
    );
  });
  if (!(done.durationSeconds > 0)) throw new Error("no_output");
  if (!withinLimit(tier, done.durationSeconds)) throw new Error("too_long");
  return {
    audio: done.audio,
    durationSeconds: Math.round(done.durationSeconds * 10) / 10,
    // The waveform is read from the stored file, so it is exactly what it was before (down to the start-up overshoot the AAC
    // encoder puts on the first 100 ms, which the levelled sound before encoding does not have). That is one small extra
    // ffmpeg run; PEAKS_FROM_FILE=0 takes the waveform from the levelled sound in the same pass instead (no extra run, a
    // different waveform: see docs/launch/LOAD-REPORT.md).
    peaks:
      process.env.PEAKS_FROM_FILE === "0"
        ? peaksFromPcm(done.pcm, 48)
        : await peaks(done.audio),
    bytes: done.audio.length,
  };
}
