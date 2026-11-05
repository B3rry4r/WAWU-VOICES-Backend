import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalise, probe, OUTPUT } from '../src/audio-ref/normalise.js';
import { processClip } from '../src/audio-ref/pipeline.js';
import { peaksFromPcm } from '../src/audio-ref/peaks.js';
import { makeClient, presignRawUpload, playbackUrl, checkRawObject } from '../src/audio-ref/spaces.js';
import { withinLimit, MAX_SECONDS } from '../src/audio-ref/limits.js';
import { makeGeminiTranscriber } from '../src/audio-ref/transcribe.js';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n));

for (const name of ['sample.webm', 'sample.mp4']) {
  test(`normalise ${name} to mono AAC mp4 about 32 kbps`, async () => {
    const inp = fx(name);
    const before = await probe(inp);
    assert.equal(before.channels, 2);
    const out = await normalise(inp, 10);
    const p = await probe(out);
    assert.equal(p.codec, 'aac');
    assert.equal(p.channels, 1);
    assert.equal(p.sampleRate, OUTPUT.sampleRate);
    assert.ok(p.container.includes('mp4'));
    assert.ok(Math.abs(p.duration - 3.2) < 0.3, 'duration ' + p.duration);
    assert.ok(p.bitRate > 20_000 && p.bitRate < 48_000, 'bitrate ' + p.bitRate);
    // faststart: moov before mdat, so it streams on iOS
    assert.ok(out.indexOf('moov') > 0 && out.indexOf('moov') < out.indexOf('mdat'));
    assert.ok(out.length < 4_500 * p.duration + 2000, 'size ' + out.length);
  });
}

test('processClip returns peaks, duration and size for a webm', async () => {
  const c = await processClip(fx('sample.webm'), 'free');
  assert.equal(c.peaks.length, 48);
  assert.equal(Math.max(...c.peaks), 255);
  assert.ok(c.durationSeconds > 3 && c.durationSeconds < 3.6);
});

test('free tier rejects a 15 s clip, voice30 accepts it', async () => {
  await assert.rejects(processClip(fx('long15.webm'), 'free'), /too_long/);
  const c = await processClip(fx('long15.webm'), 'voice30');
  assert.ok(c.durationSeconds > 14 && c.durationSeconds < 16);
});

test('normalise clamps to the tier limit', async () => {
  const out = await normalise(fx('long15.webm'), MAX_SECONDS.free);
  assert.ok((await probe(out)).duration <= 10.7);
});

test('limits', () => {
  assert.ok(withinLimit('free', 10.2));
  assert.ok(!withinLimit('free', 11));
  assert.ok(withinLimit('voice60', 60));
  assert.ok(!withinLimit('voice60', 0.1));
});

test('peaksFromPcm on silence and on a ramp', () => {
  assert.deepEqual(peaksFromPcm(Buffer.alloc(0), 4), [0, 0, 0, 0]);
  const b = Buffer.alloc(8 * 2);
  for (let i = 0; i < 8; i++) b.writeInt16LE((i + 1) * 1000, i * 2);
  assert.deepEqual(peaksFromPcm(b, 4).at(-1), 255);
});

test('presigned PUT and GET are well formed (offline, fake keys)', async () => {
  const s3 = makeClient({ SPACES_ENDPOINT: 'https://lon1.digitaloceanspaces.com', SPACES_REGION: 'lon1', SPACES_KEY: 'k', SPACES_SECRET: 's' } as NodeJS.ProcessEnv);
  const put = await presignRawUpload(s3, 'voices-test', 'free', 'audio/webm;codecs=opus', 12345);
  const u = new URL(put.url);
  assert.ok(u.hostname.startsWith('voices-test.lon1'));
  assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
  assert.ok(put.key.startsWith('raw/'));
  const get = new URL(await playbackUrl(s3, 'voices-test', 'voice/x.m4a'));
  assert.equal(get.searchParams.get('X-Amz-Expires'), '900');
  assert.ok(get.searchParams.get('response-content-disposition') === 'inline');
});

test('transcriber refuses to start without a key', () => {
  assert.throws(() => makeGeminiTranscriber({} as NodeJS.ProcessEnv), /GEMINI_API_KEY/);
});

const fakeS3 = (len: number) => ({ send: async () => ({ ContentLength: len }) }) as never;
const realS3 = () => makeClient({ SPACES_ENDPOINT: 'https://lon1.digitaloceanspaces.com', SPACES_REGION: 'lon1', SPACES_KEY: 'k', SPACES_SECRET: 's' } as NodeJS.ProcessEnv);

test('presign refuses a size over the tier cap', async () => {
  await assert.rejects(presignRawUpload(realS3(), 'b', 'free', 'audio/webm', 400_001), /too_large/);
  await assert.rejects(presignRawUpload(realS3(), 'b', 'free', 'audio/webm', 0), /too_large/);
  await presignRawUpload(realS3(), 'b', 'voice60', 'audio/mp4', 2_000_000);
});

test('presign refuses a non-audio Content-Type', async () => {
  for (const t of ['text/html', 'application/octet-stream', 'video/webm', 'image/png', '']) await assert.rejects(presignRawUpload(realS3(), 'b', 'free', t, 1000), /bad_type/);
  for (const t of ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg', 'audio/mpeg', 'audio/aac']) await presignRawUpload(realS3(), 'b', 'free', t, 1000);
});

test('HEAD check refuses an object over the cap or different from the signed size', async () => {
  await assert.rejects(checkRawObject(fakeS3(500_000), 'b', 'raw/x', 'free', 500_000), /too_large/);
  await assert.rejects(checkRawObject(fakeS3(2000), 'b', 'raw/x', 'free', 1000), /size_mismatch/);
  assert.equal(await checkRawObject(fakeS3(1000), 'b', 'raw/x', 'free', 1000), 1000);
});

test('webm with no duration header: 15 s refused on free, accepted on voice30', async () => {
  const inp = fx('long15-nodur.webm');
  assert.ok(Number.isNaN((await probe(inp)).duration));
  await assert.rejects(processClip(inp, 'free'), /too_long/);
  const c = await processClip(inp, 'voice30');
  assert.ok(c.durationSeconds > 14 && c.durationSeconds < 16);
});
