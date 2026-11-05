import { normalise, probe } from './normalise.js';
import { peaks } from './peaks.js';
import { withinLimit, MAX_SECONDS, RAW_MAX_BYTES, type VoiceTier } from './limits.js';

export interface ProcessedClip { audio: Buffer; durationSeconds: number; peaks: number[]; bytes: number }

/** After the raw upload lands: size check, duration check, normalise, probe, peaks. Throws a named Error on rejection. */
export async function processClip(raw: Buffer, tier: VoiceTier): Promise<ProcessedClip> {
  if (raw.length > RAW_MAX_BYTES[tier]) throw new Error('too_large');
  const before = await probe(raw).catch(() => { throw new Error('not_audio'); });
  // webm from MediaRecorder often has no duration header; treat NaN as unknown and trust the clamp in normalise()
  if (Number.isFinite(before.duration) && !withinLimit(tier, before.duration)) throw new Error('too_long');
  const audio = await normalise(raw, MAX_SECONDS[tier]);
  const after = await probe(audio);
  return { audio, durationSeconds: Math.round(after.duration * 10) / 10, peaks: await peaks(audio), bytes: audio.length };
}
