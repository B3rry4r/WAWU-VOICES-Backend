# VOICES lead log

The lead's running record: what is merged, what is running, what waits on whom. Newest at the bottom. Any account can
continue from here: read this file, `tasks/README.md`, `DECISIONS.md` and `docs/agents/RULES.md`.

## How work runs (the Fable workflow)
- The lead orchestrates, rules and merges; it writes no feature code (the owner allowed the lead to do the repo split
  and the launch design himself, 9 Nov).
- Each bundle: one Sonnet builder on branches `v/<id>` in the repo(s) it changes, then one separate Sonnet verifier
  (T2 bundles get the money and privacy attacks), at most two fix rounds (the builder is resumed for its own fixes), then
  the lead runs `scripts/lead/fullcheck.sh <backend-ref> <web-ref> <tag>` on the joined code and merges only on every
  EXIT 0. Keep agents low (one or two at a time).
- Records: task files carry their status; this log carries the timeline; `docs/lead/polish.md` holds accepted lows;
  `docs/lead/phone-list.md` holds the checks only a real phone can prove.
- Build machine setup (fresh container): `scripts/dev/services.sh up` (installs nothing; Postgres 16 and Redis must be
  present: `apt-get install -y postgresql-16 redis-server` if not), `npm ci` in backend `api/` and in the web repo.

## Where it stands
- 5 to 7 Nov: first plan built in one repo (36 of 41 tasks; 724 server and 585 web tests; final walks passed).
- 8 Nov: the two repos created and the history split; the joint history is on the backend branch `archive/monorepo`.
- 9 Nov: REPO-SPLIT done (web stands alone, checks pass). Launch designs drawn (canvas v43, sources in
  `docs/design/launch/`). Owner answers: usevoices.com (V-35), tokens (V-36), AI fix 5 tokens (V-37, owner delegated);
  lead defaults V-38. Owner: build the launch features on this account with the Fable workflow, records in the repos.

## Timeline
- 9 Nov: baseline full check on both mains, new build machine: all 10 EXIT 0 (724 api, 585 web).
- 9 Nov 00:31 UTC: bundle B (mood: LCH-02, 04, 03) and bundle F (money: LCH-10, 12) builders started (Sonnet), branches
  v/lch-b and v/lch-f in both repos. Next: a separate verifier for each, then merge on fullcheck. A wake-up is set for
  05:33 UTC (the owner's 5-hour usage window) to resume.
- 9 Nov 01:03 UTC: bundle B built (backend 94c2df7, web 0d9bea2 on v/lch-b): migration 20261110000000_mood_words, mood
  required on mood questions, word on every answer shape and ?mood= filter, where-you-sit in Redis (50 floor, Nigeria and
  World), mood card in 3 sizes (/share/{code}/square new), name only with the switch, seed:launch puts the question on
  15 Nov (replaced question kept in the spare bank). 743 api, 599 web, all EXIT 0; 13 pictures. Builder defaults to
  check: Posted keeps old share buttons (LCH-05), no Share-my-word switch yet (LCH-06), web base address on the card
  (LCH-08). Verifier V-LCH-B started (Sonnet; brief tasks/bundles/B-mood-verify.md).
- 9 Nov (early hours) UTC: both agents (bundle F builder, bundle B verifier) stopped at the owner's 5-hour usage limit (reset
  04:50 UTC). F's uncommitted work survived in /home/user/wt/lch-f-{backend,web}. 05:34 UTC: both resumed with
  their saved context; F told to commit and push v/lch-f after each working step.
- 9 Nov 05:36 UTC: V-LCH-B verdict FIX (report docs/lead/reports/v-lch-b-round1.md): MEDIUM explain-my-vote
  posts a wordless answer on a mood question; MEDIUM toggling the card name does not redraw the stored 1200x630 card.
  Lows to polish.md; the domain (LCH-08) and the Posted tab bar (LCH-05) belong to later bundles. All checks EXIT 0.
  Fix round 1 sent to the B builder.
- 9 Nov 05:37 UTC: bundle F built (backend abeff18, web 5781c5e on v/lch-f): 7 packs, text 5 per 150
  characters, voice 78/100, 20 a Lagos day (429 DAILY_LIMIT_REACHED), extra voice no longer sold, POST /text/fix 5
  tokens once per Idempotency-Key with a meaning guard. All EXIT 0. Legal lines changed in terms, refunds, privacy (owner
  to approve). Many existing tests changed by the price and name rulings: the verifier reads each. V-LCH-F (T2) started
  (brief tasks/bundles/F-money-verify.md).
- 9 Nov 05:48 UTC: bundle B fix round 1 back (backend 519760a, web 5643b40): explain-my-vote needs a word on
  a mood question (api + web picker); the name switch resets every stored card at once (no re-POST needed); 745 api,
  all EXIT 0. Builder noted a draw-in-flight race that could store a named card after the switch: lead ruled to close
  it in the same round (store only if the card setting is unchanged). Then the verifier re-checks (round 2).
- 9 Nov 05:55 UTC: V-LCH-F (T2) verdict FIX (report docs/lead/reports/v-lch-f-round1.md). Money held under
  every attack (ledger, 20 a day under 20 parallel, Lagos midnight, idempotency, refunds, payments, books balanced);
  774 api, 593 web, all EXIT 0; test changes all follow V-36/V-38. Must fix: F1 30.0-30.5 s voice shown 78 charged 100;
  F2 fix results kept 24 h, not purged; F3 "Voice Units" left in privacy.md; F4 meaning guard weak both ways. Lead
  rulings LF (one cost function with a 500 ms grace both sides; fix results 10 min + cleanup + purge + privacy line;
  guard rebuilt on a 40-pair labelled set) and 8 lows; fix round 1 sent to the F builder.
- 9 Nov: owner asked about launching Who Made This (the WAWU Expo app) as a web app by Wednesday. Lead checked:
  the web export (expo export --platform web) on wawu-wmt-mobile main 446ed24 builds (EXIT 0, 8.9 MB main bundle) and the welcome
  screen renders at 390 and 1440 with no errors (phone layout stretched at 1440). Answer given: Expo web by Wednesday
  is feasible (quick desktop layout; designed desktop after); upgrading the old WAWU website is weeks. Waiting on the
  owner: address, desktop choice, which account.
- 9 Nov 05:56 UTC: bundle B card race closed (backend 19f79d7; row lock in the storing transaction, redraw up
  to 3 tries; test holds a draw, flips the name, asserts the unnamed card). 746 api, EXIT 0. V-LCH-B round 2 started.
- 9 Nov: V-LCH-B round 2 MERGE (report docs/lead/reports/v-lch-b-round2.md; 12 racing rounds, 0 mismatches). Merged
  v/lch-b: backend 107b031, web 7245463. Full check on the joined heads: all 10 EXIT 0 (746 api, 601 web). Pushed.
  Bundle F builder stopped at the usage limit (reset 10:30 UTC) mid fix round; resumed after it.
- 9 Nov 10:42 UTC: bundle F fix round 1 back and main (B) merged in: backend 29a9012, web 72c4e3c. LF rulings
  done with tests (shared voice price + grace; fix results 10 min + cleanup + purge; guard 21 must-fix / 24 must-refuse;
  F5, F11, F12 and others). Legal lines for the owner: terms free-posts line, privacy 10-minute line, "Unspent tokens
  are lost." 846 api, 610 web, all EXIT 0. V-LCH-F round 2 (last) started.
- 9 Nov: owner pricing talk for the WAWU web app: client budget ₦1M; lead advised two phases (Phase 1 ₦1M web app by
  Wednesday with a centred laptop view; Phase 2 desktop design ₦500k-700k a week later). Waiting on the client's yes
  and the address (wawuafrica.com or app.wawuafrica.com).
- 9 Nov 10:43 UTC: bundle C (share: LCH-06 invites and friends, LCH-05 You're live) builder started (Sonnet), brief tasks/bundles/C-share.md.
- 9 Nov 10:55 UTC: V-LCH-F round 2 MERGE (report docs/lead/reports/v-lch-f-round2.md). Merged v/lch-f:
  backend 36939f0, web ea860b6. Full check on the joined heads: all 10 EXIT 0 (846 api, 610 web). Pushed. Lows to
  polish.md, one marked BEFORE LAUNCH (the privacy 10-minute line vs a 5-minute cleanup).
- 9 Nov 10:56 UTC: bundle A (go: LCH-01 landing words, LCH-08 /go and usevoices.com, plus the before-launch cleanup interval) builder started (Sonnet), brief tasks/bundles/A-go.md. Bundle C owns /go/<code>, A owns /go.
- 9 Nov 11:06 UTC: bundle C built (backend d42b105, web 7272910 on v/lch-c, main with F merged in): invite
  codes (7 chars), /me/invite, /me/friends, /me/invite/claim, shareMyWord (default on), You're live, /friends,
  /go/<code> (30 days, first wins, redirects to /go), export and purge. 870 api, 632 web, all EXIT 0. Privacy lines for
  the owner (3 bullets + the deletion phrase). V-LCH-C (T2) started (brief tasks/bundles/C-share-verify.md).
- 9 Nov 11:18 UTC: V-LCH-C (T2) FIX (report docs/lead/reports/v-lch-c-round1.md): HIGH an anonymous mood
  answer leaked the friend's handle and word to the inviter; MEDIUM claim limit per IP loses friends on shared
  networks. Passed: nobody else reads a friend's word, switch off hides at once, claim abuse holds, 20 parallel claims
  1 row, export and purge both ways, message and links right, QR decodes, no contacts API. 870 api, all EXIT 0.
  Rulings LC: anonymous answers never count or show; claim limit per user + high IP ceiling, web keeps the code until a
  claim succeeds; only the mood Posted screen is full screen. Fix round 1 sent.
- 9 Nov 11:24 UTC: bundle A built (backend 6314808, web 7949a14 on v/lch-a): landing words, /go, the address
  moved to usevoices.com (nginx and certbot from VOICES_DOMAIN, apex), Fix my text cleanup every 60 s. 848 api, all
  EXIT 0. Lead rulings: the invited-by line is a follow-up after C merges; the /go footer keeps Privacy. V-LCH-A started.
- 9 Nov 11:29 UTC: bundle C fix round 1 back (backend 5b41dc8, web 662f983): named answers only
  (NAMED_ANSWER) in friends, claim and export; claim limit 10/min per person + 300/min per IP, web keeps the code and
  retries; only the mood Posted screen hides the tab bar (hideTabs). 875 api, 634 web, EXIT 0. One new privacy line.
  V-LCH-C round 2 (last) started on ports 15060-15079, Redis db 10.
- 9 Nov 11:43 UTC: V-LCH-C round 2 MERGE (report docs/lead/reports/v-lch-c-round2.md). Merged v/lch-c:
  backend a128b2d, web ba591a9. Full check on the joined heads: all 10 EXIT 0 (875 api, 634 web). Pushed.
- 9 Nov 11:43 UTC: bundle E (media: LCH-13 weekly Instagram pictures, LCH-07 voice video) builder started (Sonnet), brief tasks/bundles/E-media.md. Bundle D (LCH-09 load test) waits until the other bundles are merged so its numbers are not skewed.
- 9 Nov 11:44 UTC: V-LCH-A MERGE (report docs/lead/reports/v-lch-a.md). Found: www.usevoices.com does not work, guest
  Write has no Sign in button (MEDIUM, old behaviour /go now makes common), /join slide still says "Nigeria is talking".
  All three go to bundle A2 with the contract-source fix (bundle C hand-edited openapi.yaml) and the invited-by line.
- 9 Nov 13:48 UTC: merged v/lch-a: backend 6140714, web b12a833. Full check on the joined heads: all 10 EXIT 0 (877 api,
  643 web). Pushed. Owner back on the Ultra plan: finish VOICES on this account with the Fable workflow including the
  full walk, then Who Made This as a web app at usewmt.com (owner, 9 Nov). Status split into two tracks: coding and
  deploy (tasks/README.md).
- 9 Nov 14:00 UTC: bundle E builder resumed after the usage limit (services restarted after a machine restart; main
  with A merged in). Bundle A2 builder started (Sonnet, brief tasks/bundles/A2-followup.md).
- 9 Nov 14:58 UTC: bundle A2 built (backend a1a4d78, web 7112ab2 on v/lch-a2): contract source holds the invite and
  friends routes and Settings.shareMyWord, build.py regenerates openapi.yaml exactly (new spec); www.usevoices.com 301
  to the apex with path kept, certbot for both names (config spec, no live nginx); guest Write has Sign in returning to
  Write with the word kept; /join slide 1 uses the landing words; GET /invites/{code} returns the handle only (or null),
  60 a minute per address, and /go draws "@handle asked how you feel." web 651 tests EXIT 0; api 887 passed with one
  failure (ranking.spec latency 248 ms vs 200 ms while bundle E's tests ran; alone 13/13, 95 ms). Privacy lines for the
  owner: a friend's invite link shows that friend's handle on /go; the browser sends the kept code to get it.
  V-LCH-A2 started (brief tasks/bundles/A2-verify.md).
- 9 Nov 15:20 UTC: bundle E built (backend b96ac9e, web 4d83773 on v/lch-e, main with A merged in): weekly Instagram
  carousel (cover, views, closing slide) and Story from a published report's approved text only, admin and editor
  download (zip or PNGs); voice video 9:16 and 1:1 on the author's request, a 2-at-a-time queue, 5 a day, at most 15 s,
  served to the author only, removed or deleted answer gives 404 and the purge deletes the file. 891 api, 650 web, all
  EXIT 0; 15 pictures. Gaps seen by the lead: openapi.yaml hand-edited again (contract source must hold the routes once
  A2 merges); the data export does not list videos; no alert when a video is ready (the brief says the person is told).
  Legal lines for the owner: privacy.md "Videos" bullet, storage and retention lines. Boards can now be rendered here:
  the Design canvas runtime and the VOICES design-system bundle are in docs/design, and scripts/design/render-boards.cjs
  draws any launch board (RULES.md PICTURES). V-LCH-E started (brief tasks/bundles/E-verify.md).
- 9 Nov: V-LCH-A2 MERGE (report docs/lead/reports/v-lch-a2.md): contract regenerates exactly; guest Write sign-in
  returns with the word; invite lookup gives the handle only, 429 at the 61st a minute, no enumeration; no old slide
  words anywhere. Merged v/lch-a2: backend c77874f, web 1479a3b. Full check on the joined heads: all 10 EXIT 0 (888 api,
  651 web). Pushed. The contract-regenerates-identical check is now a spec inside APITEST, so fullcheck covers it.
- 9 Nov: V-LCH-E FIX (report docs/lead/reports/v-lch-e-round1.md). HIGH the video sweeps deadlock (40P01) and break
  the full api suite (36 and 53 failures in two fresh runs). Privacy held everywhere (author-only, removed answers 404,
  no public link). Lead rulings LE sent as fix round 1: sweeps never throw, lock in order or skip locked, full suite twice;
  merge main (A2) and put E's routes in the contract source; videos in the data export; "Your video is ready." and a
  failure notice; waveform bars and the counting clock as the boards draw; Lagos day for the 5 a day, failures count,
  restored answers can make a new video, ffmpeg nice 10; Instagram slide labels from the Weekly screen's own headings.
- 9 Nov: bundle E fix round 1 back (backend 7fe967c, web 6430c7c, main with A2 merged in): sweeps catch and log, select
  first, lock VoiceVideo then StoredFile with SKIP LOCKED, the purge in the same order; full api suite EXIT 0 twice (908
  passed); E's routes in the contract source; videos in the export; "Your video is ready." and the failure notice; 34
  bars and the counting clock; Lagos day, failures count; restored answers can make a new video; ffmpeg nice 10; slide
  labels from the Weekly screen's headings; 659 web tests. New additive migration 20261110090000_voice_video_attempts.
  Lead concern: the periodic sweep is now off under NODE_ENV=test, which could hide the cause; V-LCH-E round 2 must prove
  the sweeps run concurrently with the old deadlocking writes with no 40P01.
- 9 Nov: V-LCH-E round 2 MERGE (report docs/lead/reports/v-lch-e-round2.md): 40 rounds of concurrent sweeps against
  removals, purges and builds, zero 40P01 (the old failure was the sweep racing a test TRUNCATE); contract regenerates
  exactly; both migrations apply on main-shaped data; export, notices, Lagos-day cap and restore all as ruled; the 34 bars
  and counting clock match the boards. Merged v/lch-e: backend 1b10fb6, web 5816801. Full check on the joined heads: all
  10 EXIT 0 (908 api, 659 web). Pushed. Next: bundle D (load test); it builds its harness now and measures when the
  machine is quiet (three Who Made This web builders run at the same time).
- 9 Nov 16:10 UTC: bundle D part 1 (backend 79f841c on v/lch-d): load harness in scripts/load/ (production builds behind
  the repo's nginx, app pinned to 2 CPUs, 30k people seeded, open-loop broadcast mix), `scripts/load/run.sh full` (~30
  min); busy page (nginx 502/503/504 as 503 with Retry-After, the API sheds over 800 in flight or 1.5 s lag); guest cache
  (5 s in process, nginx shared copies, never a token request; spec and check PASS); 923 api, 659 web, all EXIT 0. Dry run
  only (not a result). Finding before any measurement: per-address limits trip first for a shared carrier address
  (handle check at ~0.5 new people a second, POST /me ~1.2, nginx ~1.7, guest listens ~2.2, invite lookup ~3.3); the db
  pool is 19 of 20 at 2 people a second. Part 2 (measured ramp, values from numbers, LOAD-REPORT) waits until the Who Made
  This verifiers finish and the machine is quiet.
- 9 Nov 19:35 UTC: bundle D part 2 handed back (backend d778965, web 8e4dfe1 on v/lch-d; report docs/launch/LOAD-REPORT.md).
  Measured on a quiet machine: the 2-CPU, 4 GB droplet holds 10 new people a second (36,000 an hour, about 900 at once)
  with the slowest path 309 ms at p95; 15 a second fails (3.0 s). Voice processing (ffmpeg, about 0.4 CPU-seconds a
  recording) breaks first; memory about 1 GB; the db pool is not the limit. Fixes with numbers: the question page read
  every answer (now the newest 40 with a real LIMIT; 5.2 s to 0.3 s at 10 a second), category counts kept 30 s, share
  cards off the main thread, transcription independent of the voice queue, ffmpeg at nice 10, nginx 4096 connections.
  Per-address limits raised from the numbers (nginx 200 a second, burst 400; POST /me and handle check 300 a minute; guest
  listens 3,000; invite lookup 300); abuse from one address still stopped. Five existing limit tests changed (values
  only, listed in the report: the verifier checks each). Recommendation for the owner: waves of 60,000 every 30 minutes
  on 2 CPUs (about 9 hours for a million), or 4 CPUs, 8 GB and waves of 120,000 (about 4 hours, an estimate). Ranking job
  to every 15 minutes during the broadcast (admin config). Not done: one ffmpeg pass instead of four (about 25% less
  voice cost), dropping loudnorm (a sound change, the owner's). All checks EXIT 0 (927 api, 659 web). The lead stopped
  two orphaned web servers left by the A2 and E verifiers. D verifier (T2) started: brief tasks/bundles/D-verify.md; it
  has the machine to itself for its replay, then the Who Made This web walk starts beside it.
- 9 Nov 20:00 UTC: D verifier (T2) FIX, nothing serious (docs/lead/reports/v-lch-d-round1.md). Replay on the quiet
  machine: same verdicts (10 a second passes, 15 fails on posting; numbers 5 to 55% slower), shared addresses no 429.
  PASS: guest copies never carry a person's data, faces and counts as main, share cards byte-identical, recordings
  byte-identical, limits match and refuse at the next request, busy page right. Findings: M1 nginx keeps non-mood share
  cards an hour (a deleted person's card stays); M2 upstream keepalive against Node's 5 s timeout resets a POST about 1 in
  50,000; M3 LS9 sets the config to 300 to keep its meaning (lead: accepted); recordings ready at 10 a second p95 15.2 s on
  the replay against 5.8 s in the report. Lead accepts guest staleness after a deletion (about 30 s share data, 6 s
  answers). Owner ruling V-39 (keep levelling; one-pass voice processing before launch). Builder resumed on
  `v/lch-d-onepass`: the one pass, M1, M2, the voice limit stated from the worse run, and the busy words on /s/<code>
  when the API is busy (verifier low, taken because launch traffic comes through share links). Then round 2.
- 9 Nov 20:24 UTC: D fix round 1 and the one pass handed back (`v/lch-d-onepass`: backend 3b3edfb, web 57b066e; all EXIT 0,
  939 api, 662 web). One pass: 4 ffmpeg/ffprobe runs a recording became 2 (conversion, then a small decode of the stored
  file so the waveform matches main exactly); stored files byte-identical to main on 11 inputs; CPU 0.525 to 0.426
  seconds a recording (19% less; the 30% variant changes the waveform and is off). F1 cards kept 30 s by nginx (a purged
  person's card 404 after 30.1 s); F2 keepAliveTimeout 65 s, headersTimeout 66 s, nginx upstream keepalive 60 s; F3 the
  runs differed by 18% more recordings and both CPUs at 98.8%: the honest limit with recordings ready under 10 s is about
  8 people a second (about 9 with the one pass, an estimate); waves corrected to 50,000 every 30 minutes on 2 vCPU (about
  10 hours) or 100,000 on 4 vCPU (about 5 hours); WAWU ID about 115 and 230 sign-ups a minute. F4 /s/<code> says the
  busy words when the API is busy. Incident: the builder ran `git stash -u` in its own worktree (against the rules) and
  restored it at once; nothing lost, the stash list is empty; repeated in the rules for the next brief. Verifier round 2
  started (shared machine: no ramp, CPU time only).
- 9 Nov 20:58 UTC: bundle D merged with the one pass (backend fc9e6a4, web e457dea). Verifier round 2: FIX on one item (M4,
  an MP4 with its header at the end said too_long instead of main's processing_error; both refuse it); everything else
  PASS (28 recordings byte-identical to main, 34 of 35 failure labels as main, CPU 22 to 25% less on the verifier's run,
  card 404 through nginx at 30.1 s, keepalive 65/66 s against nginx 60 s, the report's numbers trace). M4 fixed in 11
  lines (9d7867f, a test red before and green after), accepted on the lead's diff read. Full check on the joined code:
  all ten EXIT 0 (940 api, 662 web). LCH-09 done. Polish: an MP4 with its header at the end cannot be read over a pipe
  (main too); only matters for an upload from outside the browser recorder, which VOICES does not offer. Next: the full
  Fable walk (tasks/bundles/WALK-launch.md), three walkers on these exact heads.
- 9 Nov 21:27 UTC: full walk, walkers A and C PASS (reports /tmp/voices-reports/walk-a.md, walk-c.md; kept in
  docs/lead/reports/ with B's). A (arrival): /go and /go/<code>, the word, voice held through sign-up and sign-in, where you
  sit at 48 and 50 answers, You're live, vote, explain, search, busy pages. Medium "a guest cannot type before signing in"
  is as ruled in A2 item 3 (Sign in, then back to Write with the word): no change. Low taken for the fix batch: with the
  API down or busy, pages say "Something went wrong on our side", not the busy words (launch traffic). C (team): 53 admin
  routes x 7 identities, 371 calls, 0 mismatches; moderation, appeals, weekly report, Instagram zip, token corrections all
  right. Mediums for the fix batch: a result sent to moderation shows as a raw "Result_review / text" row; Suspend left a
  reported post public (lead ruling V-40: suspending from a post also takes it down). Waiting on walker B (money).
- 9 Nov 21:36 UTC: full walk walker B (money and sharing) PASS: every pack, every money attack (double taps, two tabs, 12
  parallel verifies credited once, forged and foreign ids refused, under and over pay, late and expired payments, the
  reconcile job), the ledger balanced after about 80 payments; text and voice prices, 10 free posts, 20 a day, Fix my
  text, invites and friends, cards, video, export and deletion all right. Mediums: the receipt says "Units" and "VU-"
  (V-36); Fix my text's limit counts same-key replays; the payment-start limit is not atomic (12 of 10 through). The full
  walk passes (A, B, C: no SERIOUS). Bundle G (tasks/bundles/G-walkfix.md, T2) is the fix batch: G1 busy words on every
  page, G2 moderation row, G3 V-40, G4 tokens on receipts, G5 and G6 the limits, G7 card link line, G8 404 status, G9 lows.
  Ruled no change: guest typing (A2), deletion grace (V-16), curly quotes (RULES), the Adverts label. After G merges: a
  last walk on the release heads.
- 9 Nov 22:10 UTC: bundle G built (`v/walk-fix`: backend 972afd8, web c199532; 952 api, 674 web, all EXIT 0). G1 busy words on
  502/503/504 (a 500 keeps its words); G2 "Result check" rows with the place and numbers; G3 V-40 ("Suspend and take it
  down"); G4 tokens on receipts, new references VT- (old VU- still open); G5 replays not counted; G6 payment start under
  one lock per person (20 at once: exactly 10); G7 the card link line usevoices.com/go/<code> (anonymous keeps the host);
  G9 the lows. G8 not reproduced: /s/<removed> answers 404 on a production build; pinned with tests. Existing tests
  changed only where a row changed the value (listed). Verifier (T2) started: tasks/bundles/G-verify.md.
