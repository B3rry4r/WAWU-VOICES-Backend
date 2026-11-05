import { normalise, probe } from "./normalise.js";
import { peaks } from "./peaks.js";
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

/** After the raw upload lands: size check, duration check, normalise, probe, peaks. Throws a named Error on rejection. */
export async function processClip(
  raw: Buffer,
  tier: VoiceTier,
): Promise<ProcessedClip> {
  if (raw.length > RAW_MAX_BYTES[tier]) throw new Error("too_large");
  const before = await probe(raw).catch(() => {
    throw new Error("not_audio");
  });
  const max = MAX_SECONDS[tier];
  const known = Number.isFinite(before.duration);
  if (known && !withinLimit(tier, before.duration)) throw new Error("too_long");
  // Unknown duration (webm from MediaRecorder has no duration header): normalise with a bounded ceiling above the limit,
  // then measure the real length. Never clamp to the limit here, that would silently truncate a long clip.
  const audio = await normalise(
    raw,
    known ? max : max + UNKNOWN_DURATION_HEADROOM,
  );
  const after = await probe(audio);
  if (!withinLimit(tier, after.duration)) throw new Error("too_long");
  return {
    audio,
    durationSeconds: Math.round(after.duration * 10) / 10,
    peaks: await peaks(audio),
    bytes: audio.length,
  };
}
