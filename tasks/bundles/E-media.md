# Bundle E (media): LCH-13 + LCH-07. Tier T1 (privacy items marked). Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-e` in BOTH repos from origin/main (bundles B, F and C merged). Read
`docs/agents/RULES.md`, the task files LCH-13 and LCH-07, `docs/launch/LAUNCH-SPEC.md` §9 and §10, DECISIONS V-31, V-34,
V-35, and the boards `docs/design/launch/WeeklyInsta-Cover` (1080x1350), `WeeklyInsta-Story` (1080x1920),
`VoiceVideo-916` (1080x1920) and `VoiceVideo-11` (1080x1080). Bundle A (go, address usevoices.com) may merge while you
work: merge origin/main into your branch before you hand back (git merge; regenerate generated files).
Resources: ports 15000-15019, Redis db 12, Postgres databases `lche_*`. ffmpeg 6 is installed (`api/src/audio-ref/`
already uses it).

## Build
- LCH-13 (api card renderer + admin web): when a weekly report is published, Instagram pictures are drawn from its
  approved text: a carousel at 1080x1350 (cover as the board draws it, then the main views, then a closing slide with
  the address) and a 1080x1920 Story. Admin Weekly gets “Download Instagram pictures” (a zip or one file per picture).
  Nothing is posted automatically. The words come only from the approved report (no new text invented); numbers as the
  report shows them.
- LCH-07 (api worker + web): only when the person asks (“Make a video” on their own answer’s share screen): an MP4 at
  9:16 and 1:1 as the boards draw: a moving waveform of the voice, captions from the stored transcript, the question,
  the word chip (mood questions), the logo. No photos. At most 15 seconds. Built in the background by a queue with one
  or two at a time and a per-person cap (for example 5 a day); the person sees “Making your video” and is told when it
  is ready. Until it is ready the share uses the audio link (the /s page). Stored in the storage stand-in like recordings.
  (privacy) Only the answer’s own author can make one; a removed or deleted answer’s videos are deleted with it and are
  never served; the deletion purge removes them; privacy.md and CLAIMS lines (list them for the owner).

## Tests
Instagram: sizes, text from the approved report only, admin-only download. Video: sizes and length, the cap, the queue
under 50 requests, a removed answer’s video gone and 404, the purge, only the author can ask. Pictures: the Instagram
pictures and one frame of each video size beside their boards, the share screen with the video states (making, ready)
at 390 light and dark, in `/tmp/voices-shots/lch-e/`.
Hand back per `docs/agents/RULES.md`.
