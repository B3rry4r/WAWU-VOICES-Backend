# LCH-09: ready for a 1-million-person broadcast

Measured 9 Nov 2026 on a quiet machine, production builds behind nginx on two CPUs. Plain words first, tables after.
Every number here came from `scripts/load/run.sh full` (results kept in `/tmp/voices-load/lch-d`); where a number
is an estimate or an assumption it says so.

## In plain words

- **The 2-CPU, 4 GB droplet holds 10 new people every second (36,000 an hour) with every page and API call under 1 second
  (p95), but only about 8 a second with recordings ready within 10 seconds.** At 10 a second the slowest path was 309 ms
  (verifier's replay: 479 ms). At 15 a second it breaks: the slowest path took 3 seconds and recordings waited 20 seconds or
  more. Recordings are the sensitive measure at 10 a second: the box is 91% to 99% busy there, and two runs of the same test
  gave recordings ready at p95 in 5.8 s (mine) and 15.2 s (the verifier's). People at once: 118 measured in the test (its
  people pause a third as long as real ones), which is about 900 real people at once (10 a second times a 90-second visit).
- **What breaks first is voice recordings, not the pages.** Each recording is converted by ffmpeg, about 0.4 CPU-seconds
  each. In the test 19 in every 100 arrivals post a voice answer, and that alone uses about one of the two CPUs. With voice
  posting switched off, 20 people a second used 44% of both CPUs and the slowest path was 273 ms. Memory is not a limit: the
  whole stack used about 1 GB of the 4 GB.
- **The first fixes made a bigger difference than any hardware would have.** At 10 people a second the slowest path went from
  5.2 s to 0.3 s. The cause was two database reads that got slower with every answer posted (the launch question had 25,000
  answers and the question page read all of them each time), not CPU or the pool.
- **Many phones behind one carrier address used to be refused.** Three addresses between 20 people a second gave 15% errors
  (429). The per-address limits are now set from the numbers: one address with 5 new people a second through it (the planned
  rate) got no 429 at all in the test (the 0.3% of errors were recordings still waiting after 40 seconds, because that run
  was at the CPU limit); a single address hammering one route is still
  stopped (the table says where).
- **Recommendation:** send in waves of **50,000 every 30 minutes on the 2-CPU droplet** (about 10 hours for 1 million), or
  move launch day to a **4-CPU, 8 GB droplet and send 100,000 every 30 minutes** (about 5 hours). The 4-CPU figure is an
  estimate (CPU scales close to linearly here); this machine has only 4 CPUs, so I could not measure it. Assumptions are in
  "Wave size" below. The owner's question for WAWU ID is at the end.
- **When it is full people see a plain page:** "We are busy. Try again in a minute." (pictures: `/tmp/voices-shots/lch-d/`).
  Restarting the API under load costs about 3 seconds of that page and nothing else.

## What was measured

Setup (details and what it does not copy are in "How the test stands in for the droplet"): the ramp starts people at 5, 10,
15 ... a second, 90 seconds each, along the broadcast path (the mix is under "The broadcast mix"). A stage fails when the
slowest page or API path is over 1,000 ms at p95, or more than 1% of requests fail. The ramp stops at the first failing stage.

| People starting a second | Requests a second | People at once (test / real) | Slowest path, p95 | Errors | CPU busy (both CPUs) | Verdict |
|---|---|---|---|---|---|---|
| 5 | 212 | 50 / 450 | 112 ms (share page) | 0% | 43% | passes |
| **10** | **516** | **118 / 900** | **309 ms (post an answer)** | **0%** | **91%** | **passes, the limit** |
| 15 | 710 | 307 / 1,350 | 3,033 ms (post an answer) | 0% | 98% | fails |

p95 per path in ms (stage 5, 10, 15 a second): go page 15, 21, 34; today's question 3, 2, 2; answers 24, 67, 412; listen
report 23, 63, 826; sign-up profile 53, 221, 1,929; post an answer 93, 309, 3,033; share card 26, 92, 1,052; share page 112, 299,
2,036; built files 3, 3, 4. Voice recording ready (typical, p95): 0.7 s and 1.5 s; 2.1 s and 5.8 s; 20 s and 38 s.

Resources at 10 a second (average): API process tree 126% of one CPU (most of it ffmpeg), web server 27%, Postgres 22%,
nginx 5%, Redis under 1%. Memory: API 391 MB, web 142 MB, Postgres 254 MB (all five together about 1 GB). Database
connections 21 (the pool is 20). Redis: one client, about 50 commands a second.

The numbers are for this machine's CPUs. On the real droplet scale them by its CPU speed; the shape (what breaks first)
will not change.

## What breaks first, and the fixes (before and after)

Each fix was measured on its own. "Before" is the code of the merge of main into this branch; "after" is this branch.

| # | What was wrong | Evidence | Fix | Before | After |
|---|---|---|---|---|---|
| 1 | The question was read together with its newest 40 answerers, and Prisma read **every answer of the question** to cut that list in memory | Postgres statistics: 202 calls returned 5,060,864 rows, 13.1 s | The newest 40 are read on their own with a real LIMIT (`FeedService.faces`) | 25,000 rows and about 65 ms per question read, growing with every answer | 40 rows |
| 2 | Category counts beside every question scanned all answers of the week (37 ms at 35,000 answers) on every question read | 396 calls, 14.7 s | Kept 30 seconds (`CATEGORY_STATS_TTL_MS`) | 396 calls | 4 calls |
| 3 | A share card was drawn on the main thread (about 50 ms each, nothing else ran meanwhile) | CPU profile: 5.5 s of 60 s | `renderAsync` (thread pool) | blocking | not blocking |
| 4 | Voice processing waited for Gemini transcription before freeing its place (the test has no Gemini, the droplet does) | code | Transcription runs on its own in production | voice limited to Gemini's pace | independent |
| 5 | ffmpeg took CPU from pages | 20 a second: sign-up p95 3.8 s | ffmpeg and ffprobe at `nice 10` in production (`FFMPEG_NICE`) | 3.8 s | 2.5 s |
| 6 | nginx ran out of connections: "768 worker_connections are not enough" from about 120 people at once, 289 warnings in one ramp | nginx error log | 4096 per worker and a higher file limit (`provision.sh`) | 289 warnings | 0 |
| 7 | One address with a few people got 429 | shared-address run | per-address limits (below) | 15.3% errors (429) | 0 refusals (429) |

Together, fixes 1 to 3 took the slowest path at 10 people a second from 5,165 ms to 666 ms (a 45-second run after each);
the full ramp after all of them gives 309 ms. Before fix 1 the whole ramp stopped at 10 a second (5 a second passed at 299 ms);
now 10 passes and 15 fails.

Measured and **not** changed:

- **Database pool (20).** Raising it to 40 changed nothing at 20 a second: the limit was CPU (98% busy), not connections.
  Postgres allows 100; the pool stays 20.
- **Next page caching.** The web server used 27% of one CPU at 10 a second and every page was under 100 ms at p95 up to
  15 a second, so no page cache is added. (Shared copies of the guest API reads, built in part 1, stay: they take the
  question reads off the database.)
- **Redis** is used only for vote counters and the word counts: about 50 commands a second, one client. Nothing to do.
- **The ranking job** runs in the API process every 5 minutes. At 30,000 answers one run took 5.9 s under load (database
  work, in batches of 4,000), and it grows with the number of answers. It did not show as a spike in the numbers above.
  During the broadcast set `ranking.interval_minutes` to 15 in the admin config (no code change), or 30 if the answer count
  passes 100,000.
- **Restart under load and the JWKS fetch limit** (`jwksRequestsPerMinute: 5`). Restarting the API at 8 people a second
  took 3 seconds. In that window 1.1% of requests got the busy answer (503) and no request got a 4xx: the signing key is
  fetched once, and nothing asked for it more than 5 times a minute. A deploy during the broadcast is therefore safe if
  it is done between waves.

### Voice cost, and the one-pass change (owner ruling V-39: levelling stays as built)

Why the two runs differ at 10 a second (read from both result files, not rerun): same mix and think time, but the verifier's
run happened to post 18% more recordings (159 against 135 in the same 90 seconds, 1.8 a second against 1.5) and ran the two
CPUs at 98.8% against 91.1% (API tree 139% against 126% of a CPU), on a shared machine. A queue with two job places and the
CPUs near 100% grows steeply, so a few percent more work moves the p95 recording-ready time from 6 s to 15 s while every
page stays under 0.5 s. So the 10 a second "limit" is a knife edge for recordings. **Honest voice limit: recordings stay under
10 s at about 8 new people a second (80% busy), not 10.** Plan on 8.

One-pass (`convertOnePass`, `processClip`): a recording used to start four processes (ffprobe, ffmpeg, ffprobe, ffmpeg for
the waveform); now it starts two (one ffmpeg that converts and writes the length's source, and a small decode of the stored
file for the waveform) and no ffprobe. Nothing is probed first because nothing needs it before the conversion: a file ffmpeg
cannot read is "not_audio" as before, and an over-long file is cut at the tier limit plus 5 s and refused by its converted
length (same answer, at most that much work). The loudness chain is unchanged (`loudnorm=I=-16:TP=-1.5:LRA=11`).

Proof on 11 varied inputs (a 1.2 s clip, 9.8 s stereo, 28 s noise, very quiet, very loud, 5 s of silence, a speech sample, an
MP4 stereo, a 14 s MP4, a fragmented MP4, a 15 s WebM with no length): the stored file is **byte-identical** to main's on all
11 (SHA-1 compared), the length is identical (rounded to 0.1 s; the header-read length is within 1 ms of ffprobe's), and the
waveform is identical. CPU time per recording (user plus system CPU-seconds including ffmpeg, measured as CPU time not wall
time because the machine is shared, 5 runs each, averaged): main 0.525, one-pass **0.426, 19% less** (per input: 15% for the 28 s
clip, 61% for the 1.2 s clip, 40% for ordinary 3 to 6 s recordings). Tests: `api/test/load/onepass.spec.ts` (equality with the
old chain, two processes and no ffprobe, the failure paths: broken, empty, too long, too large).

A second variant (`PEAKS_FROM_FILE=0`) draws the waveform from the levelled sound inside the same single ffmpeg run: 0.365 per
recording, **30% less**, but it is not the old waveform. The old waveform is read from the encoded file, and the AAC encoder
overshoots in the first 100 ms (up to 1.75 times), which the peak scaling then treats as the loudest point: old waveforms of a
steady voice are about half height after the first bar, the new ones are full height. That is a visible change to every
waveform, so it is off and the owner may choose it.

Effect on people a second (an estimate, not a measured run: the ramp was not rerun): at 10 a second recordings are about 1.8 a
second and about 0.9 of the 2 CPUs; a 19% cut in that is about 0.17 CPU, about 9% of the box. So the limit with recordings under
10 s moves from about 8 to about 9 a second. The wave sizes below keep the 8 a second figure until a quiet-machine run confirms it.

## Shared addresses: the limits, and what they are now

Many Nigerian phones reach us from one carrier address. The limits are per address (nginx and the API). The planned rate for
one carrier address is **5 new people a second** (300 a minute) through it, with each person doing what the mix does
(about 11.5 API calls). Values were changed only after the run showed the old ones refused real people.

| Limit | Was | Now | One address stopped at | Why this value |
|---|---|---|---|---|
| nginx, every `/api/` request | 20 a second, burst 40 | **200 a second, burst 400** | 400 at once, then 200 a second | 5 people a second use about 75 a second on average and bursts above 100 a second were refused at 100 |
| Routes with no value of their own, each | 600 a minute | **1,200** | 1,200 | 2 question reads a person |
| Sign-up profile `POST /me` | 20 a minute | **300** | 300 | 0.38 a person; each needs a new WAWU ID account |
| Handle check | 30 a minute | **300** | 300 | three a sign-up |
| Guest listen reports, whole address | 300 a minute | **3,000** | 3,000 | 2.7 a person; one visitor is still held to 120 a minute |
| Invite lookup | 60 a minute | **300** | 300 | the code is 7 letters or digits, 300 a minute cannot walk 78 billion |
| Share page, card | 300 a minute | **900** | 900 | the web server makes 3 calls a view |
| Share link create | 60 a minute | **300** | 300 | |
| Config (public) | 300 a minute | **900** | 900 | |
| Unchanged | story and square 60, search 60, home 300, invite claim 300 (and 10 a person), per-person limits | | | not on the path, or already per person |

**A carrier address at the planned rate passes:** in the test, 15 people a second spread over 3 addresses (5 a second each)
gave no 429 from nginx or the app (0.3% errors, all recordings still waiting after 40 s at that CPU-bound rate) and the slowest
path was 239 ms; the unit test `test/load/shared-address.spec.ts` sends 300 people's worth of every route through one address with no 429.
**Abuse from one address is still stopped:** the unit test checks that the 301st invite lookup and handle check and the
1,201st call to any one route in a minute are refused; nginx refused 1,997 of 2,996 requests sent in 3 seconds from one
address (999 got through: the burst of 400 plus 200 a second). What it cannot stop is a very large number of real people
on one address, which is the point.

Existing tests that changed because a limit changed (value only, listed here as the rules require): `test/talk/rt-limits.spec.ts`
(share page 300 to 900), `test/talk/listen-limits.spec.ts` (guest listens per address 300 to 3,000), `test/talk/listen.spec.ts`
(LS9 now sets the config value back to 300 so it does not need 3,000 rows), `test/me/me.spec.ts` (handle check 31st to 301st),
`test/reach/share.spec.ts` (link makes 60 to 300). Nothing else was edited.

## Wave size and droplet size

Assumptions (change them and the answer changes; the formula is below the table):

- Click-through: **10% of those sent to** (SMS and email together; this is the number most likely to be wrong).
- Arrival timing: **60% of a send's clicks arrive in the first 10 minutes**, the rest over the next hour.
- Each arrival does what the mix does (see below); 19% post a voice answer.

Peak arrivals a second for a send of W people = W x 10% x 60% / 600 seconds = W / 10,000.

| Droplet | Safe peak (60% of the 8 a second recordings limit) | Send in waves of | Every | 1 million takes |
|---|---|---|---|---|
| 2 vCPU, 4 GB (planned, measured) | 5 a second | **50,000** | 30 minutes | about 10 hours |
| 4 vCPU, 8 GB, CPU-optimised (estimate, not measured) | 10 a second | **100,000** | 30 minutes | about 5 hours |
| 2 vCPU, 4 GB, all at once | 100 a second | 1,000,000 | - | the droplet would be 10 times over its limit: the busy page for most people for hours |

The 100,000-an-hour wave in the brief is a peak of 10 a second at these assumptions: above the 8 a second recordings limit of the 2-CPU droplet,
so too tight, and right at the safe peak on 4 CPUs. If the click-through turns out at 5% every figure doubles; at 20% they halve. After the first
wave read the real click-through off the share and `/go` counts and resize the next wave.

**Recommendation: the 4 vCPU droplet for launch day** (the cost is hours, and it is resized down afterwards), with
waves of 100,000 every 30 minutes, starting smaller (30,000) to read the real click-through. Memory needs nothing beyond 4 GB.

## What to watch on the day

- `pg_stat_activity` count (the pool is 20; it sat at 21 at the limit), `top` for ffmpeg processes piling up, and the
  recording "ready" time (typical 0.7 s at 5 a second; over 10 s means the box is full, and it was already 5 to 15 s at 10 a second).
- nginx: `grep -c "worker_connections are not enough"` and `grep -c "limiting requests"` in `/var/log/nginx/error.log` (both 0 in the test).
- The busy answer: any 503 with `"We are busy"` in the API log or the nginx access log means a wave is too big: pause the next one.
- WAWU ID's own errors (the owner's side): sign-up failures and 429s.
- Send the next wave only when the last one's recordings are all ready.

## The owner's question for WAWU ID

At the peak of a wave about 38 in every 100 arrivals sign up (45% of those who stay). Each sign-up is three calls to WAWU ID
(register, send the email code, confirm the code) and one email, then their later calls to refresh the token.

- 2-CPU droplet, waves of 50,000: peak 5 arrivals a second, **about 115 sign-ups a minute** for about 10 minutes
  (about 340 calls and 115 emails a minute), 5,000 sign-ups over the first hour of a wave.
- 4-CPU droplet, waves of 100,000: peak 10 a second, **about 230 sign-ups a minute** (690 calls and 230 emails a minute).
- Over the whole broadcast at 10% click-through: about 38,000 sign-ups.

**Question for WAWU ID:** how many sign-ups a minute (register plus the email code plus confirm) can WAWU ID, and its email
sender, take for 10 minutes at a time, and how many a minute should we ask of it? We must stay at or under it, and if it is
under 115 a minute the waves must shrink in proportion (a wave of W sends needs about W / 430 sign-ups a minute at its peak).
Only the stand-in was measured: its path took 0.4 ms of CPU a call, which says nothing about the real one.

## How the test stands in for the droplet

nginx (2 workers) with the repo's own site file, the API (`node dist/main.js`), the web server (`next start`), Postgres
(own instance, the droplet's defaults, fsync on) and Redis all run pinned to two CPUs. The load generator and the two
stand-ins (WAWU ID, Spaces) run on the other two. Seeded: the launch question with four words, 30,000 people, 25,000 launch
answers (55% voice), 34,600 likes, a poll with 15,000 votes, 3,000 invite codes.

What it does not copy: this machine's CPUs (not the droplet's), loopback networking (no mobile latency, no TLS), Gemini
transcription (never called, so transcripts stay pending), the real WAWU ID and Spaces. Think-times are scaled to 30%
(`--think 0.3`), which does not change requests per person.

## The broadcast mix, and why

People start at a set rate whether or not the site keeps up. Each is one of these walks; the shares are assumptions in `MIX`
at the top of `scripts/load/load.mjs`.

| Step | Share | Requests |
|---|---|---|
| Arrive, 30% by a friend's `/go/<code>` link | all | `/go/<code>`, the `/go` page and its files, today's question, the inviter's name |
| Leave at once | 15% | nothing more |
| Pick a word | 85% | the mood page, the question |
| Listen | 80% of those | the question page, config, 10 answers, word counts, 2 voices (play link, listen start and end), 50% a second page, 30% a like |
| Sign up (WAWU ID stand-in) | 45% of those | `/join`, countries, register, email code, confirm, categories, `POST /me`, `GET /me` |
| Post | 70% of those who signed up | 60% voice (create, upload to the Spaces stand-in, complete, wait until ready, post), 40% text |
| After a post | all who posted | where you sit, word counts, the posted page, 70% share (link, share page) |
| Friends open the share link | 1.0 a link | `/s/<code>` (three API calls), the card picture, half carry on as arrivals |

One person costs about 11.5 API requests, 3.7 page loads and 25 built files. Why this mix: it is the brief's path in order;
the first screens are guests reading the same few things (so caching matters), and the expensive rows (recordings, cards,
sign-up) are a minority at a realistic share.

## What is in the code (this task)

| Piece | Where |
|---|---|
| The test: stack, stand-ins, seed, ramp, limits table, cache proof, one command | `scripts/load/` (`run.sh full`, about 30 minutes; `dry` for a one-minute check) |
| Busy page, API busy answer, nginx wiring | `infra/nginx/busy.html`, `voices.conf`, `api/src/common/busy/busy.ts` |
| Shared guest reads (API 5 s, nginx 5 s; never a signed-in request) | `api/src/feed/guest-cache.ts`, `feed.controller.ts`, `voices.conf` |
| Fixes 1 to 7 | `feed.service.ts`, `present.ts`, `reach/card-renderer.ts`, `media/transcription.worker.ts`, `audio-ref/normalise.ts`, `infra/provision.sh` |
| nginx keepalive to the apps, built files served by nginx with `gzip_static` | `infra/nginx/voices.conf`, `infra/deploy/deploy.sh` |
| Limits | `me.controller.ts`, `invite-lookup.controller.ts`, `share.controller.ts`, `feed.controller.ts`, `config-reader.ts`, `app.module.ts`, `voices.conf` |
| Tests | `api/test/load/` (guest cache: two people, one cache; busy; shared address and abuse) |

On an existing droplet: copy `infra/nginx/voices.conf` and `busy.html` as the RUNBOOK says, set `worker_connections` (run
`provision.sh` again), and set `THROTTLE_LIMIT=1200` in `/etc/voices/api.env`. Environment switches (all have safe
defaults): `GUEST_CACHE_TTL_MS`, `CATEGORY_STATS_TTL_MS`, `FFMPEG_NICE`, `BUSY_MAX_INFLIGHT`, `BUSY_MAX_LAG_MS`.

## Fix round 1 (verifier)

- **Cards in nginx:** a non-mood card was kept an hour by nginx (the browser header, `max-age=3600`). The API now also sends
  `X-Accel-Expires: 30` on a card: nginx reads it before `Cache-Control`, never passes it on to the visitor, so the browser
  header and its test are unchanged and nginx keeps a card no longer than the share page data (30 s). Proof through nginx:
  `scripts/load/check-card-ttl.mjs` (a profile card is served, then served from nginx's copy, and after the person deletes the
  account and is purged, it stops within about 30 s; the API itself keeps serving a stored non-mood card until the purge job
  removes it, as designed, so the 30 s is added to the purge, not to an hour).
- **Idle connections:** nginx keeps connections to the API open (60 s); Node closed idle ones after 5 s, so about 1 request in
  50,000 raced the close and got "Connection reset by peer" and the busy page. The API now keeps idle connections 65 s with
  `headersTimeout` 66 s (`tuneServer` in `app-config.ts`, called from `main.ts`), so nginx always closes first.
  Test: `api/test/load/keepalive.spec.ts` (the timeouts, and a connection idle 7 s still serves). A 100-second run at 6 people a second
  (about 12,600 requests, on a shared machine) had 0 "reset by peer" and 0 502 in the nginx logs; at the reported rate of 1 in 50,000
  that run is too short to prove the absence by itself, so the proof is the 65 s against nginx's 60 s.
- **Busy share page:** `/s/<code>` in the web app shows "We are busy. Try again in a minute." when the API answers busy
  (503), instead of "We could not open that link".
