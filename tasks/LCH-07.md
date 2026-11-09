---
id: LCH-07
title: Share the voice as a short video
area: LAUNCH
priority: after launch day if time is short
tier: T1
repo: api (worker) + web
status: building (bundle E, branch v/lch-e, 9 Nov)
depends_on: [LCH-02, LCH-14]
decisions: [V-31]
boards: [new: VoiceVideo frame 9:16 and 1:1]
---
# LCH-07 · Share the voice as a short video

Source: LAUNCH-SPEC.md §9.

## Build
- Only when the person asks: build an MP4 at 9:16 (1080x1920) and 1:1 (1080x1080): a moving waveform of the voice,
  captions from the stored transcript, the question and the logo. No photos. At most 15 seconds.
- Built in the background with ffmpeg (installed by infra/provision.sh), one or two at a time, with a per-person cap.
- If it is not ready, the share uses the audio link (/s page with the player). The person is told when it is ready.
- Stored in Spaces; removed by the deletion purge and when the answer is removed.

## Done when
- Tests: length cap, both sizes, the queue under 50 requests at once, the purge.
- Pictures of a frame beside the board; a real phone plays it in WhatsApp (phone list).
