# Verifier report, bundle E (LCH-13, LCH-07), v/lch-e (backend b96ac9e, web 4d83773)
VERDICT: FIX

## Findings
HIGH-1  VoiceVideoService.sweep()/sweepGone() deadlocks (40P01) with other writes; full `npm test` on a fresh DB FAILS twice
  (run 1: 36 failed in feed.spec, wf-calendar, weekly-instagram; run 2: 53 failed in wf6a, share.spec, weekly.spec). All failures are
  "deadlock detected" thrown inside sweepGone (voice-video.service.ts:358) or its victims. Each file passes alone (feed 25/25,
  wf-calendar 7/7, weekly-instagram 4/4). Cause: sweep runs on bootstrap and every 30 s (not disabled in specs that leave MEDIA_WORKER on, and
  Nest apps of earlier files stay alive), and sweepGone is a two-statement tx that row-locks StoredFile/VoiceVideo via a join.
  Also `void this.sweep()` has no .catch: any sweep error is an unhandled rejection (can kill the process in prod).
  Fix: .catch(log) on both calls; in sweepGone first do a plain SELECT for rows to remove and return if none (no locks on the idle path);
  lock in one fixed order (VoiceVideo FOR UPDATE SKIP LOCKED, then StoredFile) with a lock_timeout; not run from StoragePurgeService.run unless
  needed. Re-run the full suite 2x on a fresh DB.
MEDIUM-1 Known gap, contract: docs/contract/openapi.yaml hand-edited; docs/contract/src (routes.py, schemas.py) not touched. Regenerating
  (python3 docs/contract/src/build.py out.yaml) drops the 4 new paths AND /me/invite, /me/invite/claim, /me/friends (drift already on main from bundle C).
  Fix: add the 4 routes + MakeVideoRequest/VoiceVideo/VoiceVideoList to routes.py/schemas.py (and the three invite/friends routes), regenerate, copy to web contract/ and regenerate web types; add a check that build output == committed file.
MEDIUM-2 Known gap, data export: me/export.service.ts does not list videos. Fix: add `videos: [{id, answerId, shape, status, durationMs, createdAt, readyAt}]` (no file bytes, ids only, never a URL) from VoiceVideo where authorId=me and status<>REMOVED; add to the export schema and privacy.md "your data" line.
MEDIUM-3 Known gap, ready notice: nothing tells the person unless the share screen polls. Fix: on READY create a Notification (new NotificationType VIDEO_READY, additive enum value, targetType ANSWER, targetId answerId, dedupe key video id) in process(); web shows it in the list and the share screen note stays.
MEDIUM-4 Video does not match board waveform: boards VoiceVideo-916/-11 draw discrete rounded bars (about 20, left part), the build draws ffmpeg showwaves "cline" dense full-width blob (see /tmp/voices-shots/ve/video-9x16-frame.png vs boards/VoiceVideo-916.png). Clock reads a static "0:10" where the board shows "0:06 / 0:10". Everything else (logo, chip, question wrap, caption plate, name line, address, sizes) matches. Decide: accept or draw bars (showfreqs/avectorscope or per-frame SVG bars) and a running clock.
LOW-1 Failed-build retry is uncapped: the same FAILED row can be re-asked unlimited times (8 of 8 returned 202); createdAt reset keeps the day count at 1. Fix: count attempts (attempts column) or charge a retry.
LOW-2 Cap is a rolling 24 h, not a Lagos day: 5 made 1 minute before Lagos midnight give 429 just after it; message says "Try again tomorrow". Fix: either count since Lagos midnight or reword ("later today").
LOW-3 An answer removed then restored: its REMOVED video row is never re-queued (request returns 202 with status FAILED and nothing runs). Fix: treat REMOVED like FAILED in request().
LOW-4 ffmpeg and resvg run un-niced in the API process host; with 6 real builds queued a normal request took max 227 ms (median 23, baseline 10-13, event-loop lag max 79 ms): acceptable, but prefix `nice -n 10`.
LOW-5 Instagram fixed labels (HOW PEOPLE FEEL, WHAT PEOPLE SAID, THE WEEK'S POLL, A VOICE, "N voices") are not on the two boards; they are builder lines. Ask owner to accept. Admin share rounding: share 61.4 shows 61%.
LOW-6 web client.ts: apiBlob inserted between the "only place raw fetch lives" comment and apiFetch (comment now sits on the wrong function). Share panel polls every 3 s forever if a row stays MAKING (server re-queues after 10 min).
INFO  Panel copy "It takes about a minute": real time about 6 s per 10 s clip. No em-dashes, curly quotes, "Rant" or "wallet" in new user copy (plain() strips them from report text).

## Checks
1 Instagram: PASS. 6 carousel PNGs 1080x1350 + story 1080x1920 (drawn from real code, pictures in /tmp/voices-shots/ve/insta-*.png beside boards/). Words only from report plus fixed lines (test + read). Published report cannot be edited (edit throws 409), so text cannot change after approval; draft/held/approved = 409 (test); editor and admin 200; plain, moderator, ad manager 403; guest 401. No posting code.
2 Video privacy: PASS. Matrix run: guest 401 (make, list, file); other person, admin, editor, moderator: make 403, list 404, file 404; random/non-uuid id 404; StoredFile id used as video id 404; /files, /media, /me/files routes 404; owner 200. Held, removed, deleted, banned answer: file 404 and make 404; removal while building leaves REMOVED row and file deleted at once; purge and account-deletion purge covered by builder tests (pass alone). Anonymous answer: name line null even with card switch. Never public (private, no-store, API-proxied). privacy.md and CLAIMS lines match code.
3 Video build: PASS with MEDIUM-4. 9x16 1080x1920 and 1x1 1080x1080 h264+aac; 30 s clip made 15 s; captions only from READY transcript (none when missing); mood chip only on mood answers; name line only with switch, never anonymous (1x1 has no name line, board has none). Queue: 50 at once, peak 2 (builder test); 6 real builds responsive (LOW-4). Cap 5: 8 concurrent requests gave 5x202 and 3x429 (5 rows); double tap x3 gave one row; failed build counted once; edges LOW-1/2.
4 Share screen: PARTIAL. States read in code (none, making, ready, failed, 429 text); web unit tests pass. NOT RUN: browser pictures at 390 light and dark (needs web build against local stand-ins and a seeded signed-in session; not done in this pass).
5 Existing tests changed: none edited. Only test/talk/harness.ts gains MemoryStore.putVideo (needed by the interface). ObjectStore.putVideo, enum value FileKind VOICE_VIDEO, table VoiceVideo, migration 20261110080000_voice_video: additive; applied cleanly on 5 fresh DBs and via test runs (data from main not separately loaded: NOT RUN beyond additive read).
6 Regression A, B, C, F: covered by the full suite (specs of those bundles pass except the deadlock victims in HIGH-1).
7 EXIT lines: api eslint 0, tsc 0, build 0; api npm test: EXIT 1 twice (36 and 53 failed, 855/838 passed of 892, all deadlocks); reruns alone of feed, wf-calendar, weekly-instagram EXIT 0; web lint 0, typecheck 0, npm test 0 (650/650, 63 files), build 0, sync:shared --check 0. ranking.spec latency: not the failing cause.
