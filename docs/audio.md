# VOICES audio path (V-AUDIO)

Reference code, not wired: `api/src/audio-ref/`, `web/src/lib/audio-ref/`. Tests: `cd api && npm test`, `cd web && npm run test:e2e`.

## Decisions

| Topic | Decision |
|---|---|
| Record (browser) | `MediaRecorder`, mime picked by `pickMime()`: `audio/webm;codecs=opus` (Chrome, Edge, Firefox, Android), else `audio/mp4` AAC (Safari, iOS). Mono, 32 kbps at source. Started from a tap. |
| Stored format | ONE format: MP4 container, AAC-LC, mono, 24 kHz, 32 kbps, `+faststart`, loudness-normalised (-16 LUFS). Plays on every browser including iOS. Opus/webm is not stored because older iOS Safari cannot play it. |
| Size | Measured: 3.2 s = 14 KB, 10 s = 44 KB (v4.0 says about 30 KB at 24 kbps; at the 32 kbps the owner asked for, about 40 KB). 60 s is about 240 KB. |
| Normalise | Server, ffmpeg, after upload: raw in, stored out, raw deleted. Clamped to the tier limit plus 0.5 s. Metadata stripped. |
| Upload | Presigned PUT to the VOICES Spaces bucket (S3 API, AWS SDK v3, `forcePathStyle` off). 5 minute URL, `Content-Type` and `Content-Length` signed, key `raw/<uuid>`. Phone retries 3 times with backoff and shows XHR progress. Server HEADs the object, rejects over the tier byte cap, downloads, processes, writes `voice/<uuid>.m4a`, deletes the raw. |
| Guest recording | Record and preview before sign-up (addendum); the blob stays in the page. The presign call is made after sign-in, at Send. |
| Playback | Bucket is private. API mints a 15 minute signed GET only for a post the viewer can see, `inline` disposition. Player has no download control (`controlsList=nodownload`, no context menu) and re-signs once on a 403. The CDN is optional and only for the signed URL host. |
| "Never downloadable" (v4.0) | Met as far as any browser can: no download UI, private bucket, short URLs. A person who captures network traffic can still save a clip they were allowed to hear. Say so to the owner; true DRM does not exist for web audio. |
| Waveform | Server decodes the stored file to 8 kHz PCM, takes the max per bucket, 48 bars scaled 0..255, stored as a JSON int array on the clip. The client draws it with `barHeights()`. No client decode needed on playback. |
| Limits | 10 s free, 30 s (Voice 30), 60 s (Voice 60). The recorder auto-stops at the limit with a visible countdown (`onTick`). The server re-checks duration and bytes and clamps; never trust the client. Raw byte caps 400 KB / 1.2 MB / 2.4 MB. |
| Transcription | Gemini through `@google/genai`, inline audio (clips are far under 20 MB), key `GEMINI_API_KEY`, model `GEMINI_MODEL` (default `gemini-2.5-flash`). Run as a queued job after the clip is stored; the result feeds moderation, search and captions. |

## Env (names only, never committed)
`SPACES_ENDPOINT SPACES_REGION SPACES_BUCKET SPACES_KEY SPACES_SECRET SPACES_CDN_BASE GEMINI_API_KEY GEMINI_MODEL`
Server needs `ffmpeg` and `ffprobe` on PATH (V-DEPLOY-PREP installs them).

## Proven here
- ffmpeg turns a stereo webm/opus and a stereo mp4/aac sample into mono AAC mp4 at about 35 kbps (3.2 s file is 14 KB), moov before mdat. (api test, 9 of 9 pass)
- A 15 s clip is refused on the free tier and accepted on voice30; normalise clamps to the limit.
- Presigned PUT and GET are well formed (5 and 15 minute expiry) with fake keys, offline.
- Playwright Chromium with a fake microphone: tap, record 3 s through `VoiceRecorder` (webm/opus, 2.8 to 3.6 s, live ticks), the blob goes through the server normaliser, auto-stop at a 2 s limit, mic permission denied returns `permission_denied`.

## Not proven (needs real credentials or a real phone)
Not proven here, no keys: a live PUT to Spaces and a signed GET from Spaces/CDN, CORS on the bucket (must allow PUT from the VOICES origin with `Content-Type`), a live Gemini transcription call (the transcriber is only checked to refuse to start without a key).

Only a real iPhone (Safari and an installed home-screen app) can prove:
1. The mic permission prompt appears on tap, and the second visit remembers it; denied once, the settings path text is clear.
2. `pickMime()` returns `audio/mp4` and the recording is valid AAC with a duration (iOS webm and mp4 blobs can lack a duration header; the server clamp covers it).
3. The recording stops cleanly when the screen locks, a call arrives, the tab goes to the background or Siri takes the mic (`cancel()` path, no stuck mic indicator).
4. The normalised m4a plays through the `<audio>` element on tap, with the silent switch on and off, through speaker and Bluetooth, and a second clip does not overlap the first.
5. `playsinline` playback stays in the page, no fullscreen takeover, and the 15 minute URL re-sign works after a long idle.
6. Upload over a weak mobile network and offline: the retry, the progress bar, and the draft surviving a reload.
7. The Android back button during recording (Android Chrome, also real-phone only) and the keyboard not covering the recorder.
8. Wake lock or timer throttling: the countdown stays accurate when the screen dims (iOS throttles timers in background tabs).
