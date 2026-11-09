# LCH-09: ready for a 1-million-person broadcast

Status: PART 1 of 2 (harness, shared-address analysis and the changes that need no clean numbers). The measured ramp, the
before and after numbers, the wave size and the droplet size come in part 2, when the machine is quiet. Nothing below
is a measured result unless it says so.

## In plain words (part 1)

- The test is built and works. One command runs the whole measured ramp (`scripts/load/run.sh full`, about 30 minutes).
  It builds the real production code, puts it behind nginx with the repo's own site file on two CPUs, fills a database with
  thousands of answers, voices and votes, and sends people at it along the real broadcast path until a page takes more
  than 1 second (p95) or more than 1 in 100 requests fail.
- A short dry run proved it works. It is a dry run, not a result: the machine was busy with other builds.
- A busy page is in: "We are busy. Try again in a minute." It shows when the web server or the API cannot answer, and the
  API says the same words itself when it is full.
- The first things a crowd would hit are not CPU. They are limits set per address, because many Nigerian phones reach us
  from one carrier address. With today's values, a single carrier address that sends about two new people a second gets
  429 on sign-up, handle checks and nginx before anything is slow. The table is below.
- Cached copies of the pages everyone sees (today's question, a question, its answers, the share page and card) are in,
  with proof that one person's data never lands in the copy everyone shares.

## What was built (part 1)

| Piece | Where |
|---|---|
| Stack on this machine: production builds, own Postgres and Redis, stand-ins, nginx with the repo's site file, all app processes pinned to 2 CPUs | `scripts/load/stack.sh`, `env.sh`, `nginx-main.conf.tpl` |
| WAWU ID stand-in (sign-up, sign-in, refresh, JWKS) and Spaces stand-in (presigned PUT, HEAD, GET, DELETE) | `scripts/load/standin.mjs` |
| Seed: launch question (4 words), 30,000 people, 25,000 launch answers (55% voice), 34,600 likes, a poll with 15,000 votes, 3,000 invite codes | `scripts/load/seed.mjs` |
| The ramp and the broadcast mix, with CPU, memory, database connections and Redis sampled every 2 s | `scripts/load/load.mjs` |
| Every per-address limit, one address at a time, plus the nginx limit | `scripts/load/limits.mjs` |
| Proof through nginx that shared copies carry no person's data | `scripts/load/check-cache.mjs` |
| The one command | `scripts/load/run.sh full` (`dry` for a one-minute check) |
| Busy page (static, one file) and the nginx wiring | `infra/nginx/busy.html`, `infra/nginx/voices.conf`, `infra/provision.sh` |
| API's own "we are busy" answer | `api/src/common/busy/busy.ts` |
| Guest read cache | `api/src/feed/guest-cache.ts`, `feed.controller.ts` |
| Tests | `api/test/load/guest-cache.spec.ts`, `busy.spec.ts` |

### How it stands in for the droplet

The droplet is 4 GB and 2 vCPU and runs nginx, the API, the web server, Postgres and Redis together. Here nginx (2 workers,
the Ubuntu default of 768 connections each), the API (`node dist/main.js`), the web server (`next start`), a Postgres of our
own with the droplet's defaults (100 connections, fsync on) and Redis all run under `taskset -c 2,3`. The load generator
and the two stand-ins run on CPUs 0 and 1. Memory is read per process (PSS, so Postgres is not counted once per backend)
and compared with 4 GB; the machine itself has more, so memory is reported, not limited.

What this does not copy, and the report will say so beside any number it touches: the CPUs are this machine's, not the
droplet's (the report gives numbers per CPU so they can be scaled), the network is loopback (no mobile latency), and the
audio is transcribed by nobody (Gemini is never called, so those rows stay PENDING, as on the droplet with no key).

## The broadcast mix, and why

People start at a set rate whether or not the site keeps up (an open loop: a broadcast does not wait for the site). Each
person is one of these walks; the shares are in `MIX` at the top of `load.mjs` and are assumptions, not measurements.

| Step | Share | Requests |
|---|---|---|
| Arrive, 30% by a friend's `/go/<code>` link | all | `/go/<code>` (307), `/go` page and its files, today's question, the inviter's name |
| Leave straight away | 15% | nothing more |
| Pick a word | 85% | the mood page, the question |
| Listen | 80% of those | the question page, config, the first 10 answers, the word counts, then 2 voices (play link, listen start, listen end), 50% a second page of answers, 30% a like |
| Sign up through the WAWU ID stand-in | 45% of those | `/join`, countries, register, email code start and confirm (stand-in), categories, `POST /me`, `GET /me` |
| Post | 70% of those who signed up | 60% voice (create clip, upload to the Spaces stand-in, complete, poll until ready, post) and 40% text |
| Where you sit, share | after a post | `where-you-sit`, word counts, the posted page, create a share link, the share page |
| Friends open the share link | 1.0 friend per link, on average | `/s/<code>` (the web server calls the API three times), the card image, then half carry on as a new arrival |

Why this mix: the brief's path in the order a person takes it. The first screens are almost all guests reading the same few
things, which is why caching is first; the expensive rows (voice processing, the card picture, sign-up) are the minority but
cost the most each, so they are in at a realistic share rather than left out or exaggerated. From the dry run, one person
costs about 11.5 API requests, 3.7 page loads and 25 built files.

People think between steps. `--think 0.3` (default) shortens every pause to 30%, so a ramp reaches steady state in minutes
rather than an hour. That does not change requests per person, so requests a second is honest; it does mean "people at once"
measured here is smaller than real. The report gives both: people at once measured, and arrivals a second times a real
journey of about 90 seconds.

Pass and fail: a stage fails when the worst p95 of any page or API path is over 1,000 ms, or more than 1% of requests are
refused (429), failed (5xx) or unanswered. The stand-ins and the clip-ready polling are measured but not counted.

## Shared addresses: every per-address limit, read from the code

Many Nigerian mobile users reach us from one carrier address (carrier-grade NAT), and the app and nginx count callers by
address. All values below were read from the code and set in the table by `limits.mjs suite`, which confirmed each one
(the "passed before the first 429" column is measured, not read).

| Limit | Where | Value | Measured: passed before first 429 | One carrier address breaks it at (new people a second) |
|---|---|---|---|---|
| nginx, every `/api/` request | `infra/nginx/voices.conf` `limit_req` | 20 a second, burst 40 | 100 in 3 s (40 burst + 20 a second) | about 1.7 (11.5 API calls a person) |
| Every route with no value of its own, per route | `ThrottlerModule`, `THROTTLE_LIMIT` | 600 a minute per route | 600 | about 6.5 (the question read, 1.54 a person) |
| Sign-up profile `POST /me` | `ME_SIGNUP_LIMIT` | 20 a minute | 20 | about 1.2 |
| Handle check | `ME_HANDLE_CHECK_LIMIT` | 30 a minute | 30 | about 0.5 if a person checks twice while typing |
| Listen report, a guest, whole address | `ratelimit.listen_ip_per_min` (config) | 300 a minute | 300 | about 2.2 (2.2 reports a person) |
| Listen report, one visitor | `ratelimit.listen_per_min` (config) | 120 a minute per visitor | 120 | not an address limit |
| Invite lookup | `INVITE_LOOKUP_IP_LIMIT` | 60 a minute | 60 | about 3.3 |
| Invite claim | `INVITE_CLAIM_IP_LIMIT`, plus `INVITE_CLAIM_USER_LIMIT` | 300 per address, 10 per person | 10 (the person limit) | not reached |
| Share page `GET /share/:code` | `share.controller` | 300 a minute | 300 | about 3 views a second: the web server makes 3 calls a view |
| Share card, `POST /share/links` | `share.controller` | 300 and 60 a minute | 300 and 60 | not reached |
| Config, home, search | `feed.controller` | 300, 300, 60 a minute | 300, 300, 60 | search is not on the path |
| Events, ads, notifications | `@Throttle` | 300 a minute | not run | not on the path |

Notes. (1) "People" here are people who start in a second, through one address. The sign-up row dominates: a person who
signs up costs one `POST /me` and, typing a handle, a few handle checks. (2) The per-person limits (posting 20 in 10 minutes,
reactions, likes, uploads) are keyed by account, or by the browser's guest id, so a shared address does not touch them.
(3) The in-process counters reset when the API restarts; the API is one process (V-23). (4) `jwksRequestsPerMinute: 5` in
the sign-in verifier caps how often the API will ask WAWU ID for its key. The key is kept 24 hours, so this only matters
at a cold start under load: part 2 restarts the API during the ramp to see whether early requests get 401.

What the table says, before any measurement: at the planned wave sizes the overall arrival rate is a few people a second
(100,000 sent an hour at a 15% click-through is about 4 a second), so the question is how much of it comes through one address.
If one carrier puts 40% of the audience behind 5 addresses, each takes about 0.3 a second, below every line above. If it is
behind 1 address, that address takes 1.7 a second and nginx, sign-up and handle checks refuse real people while the server
is idle. The per-address limits are therefore the first thing that can break, ahead of CPU. Part 2 measures how much a
single address costs the server at several times today's limits, then recommends values that stop a scraper but pass a
carrier address; nothing is changed until then.

Not changed in part 1, and why: nginx `limit_req` values and every app limit. The brief says to change them only with numbers.
The one change in this area is nginx answering 429 (not its default 503) to a person over the limit, because 503 now means
"busy" and shows the busy page.

## Caching that is in (part 1), and why it is safe

| Read | Shared how | Who may be served it |
|---|---|---|
| `GET /questions/today`, `/questions/:id`, `/config/public` | API keeps 5 s in memory (`GUEST_CACHE_TTL_MS`, 0 turns it off); nginx keeps the same 5 s | requests with no sign-in token only |
| `GET /questions/:id/answers` | API keeps 5 s in memory, one copy; the guest's own likes are added to a copy afterwards | no token. nginx never keeps it (it varies by guest id) |
| `GET /share/:code`, `/share/:code/card` | nginx follows the API's own `Cache-Control` (30 s, 1 hour) | everyone; both are the same for everyone |

Rules that make it safe, each with a test: a request with `Authorization` is never read from or written to either cache
(`proxy_cache_bypass` and `proxy_no_cache` in nginx, `if (user)` in the API) and gets `Cache-Control: private, no-cache`;
the cache key is the route and query, never a header; the page a guest gets is the page nobody signed in would get (no saved
mark, no like, no reaction, nothing hidden by blocks); a failed read is not kept. Tests: `api/test/load/guest-cache.spec.ts`
(two people, one cache, both orders, for the question, the answers, likes, reactions, own answer and blocks) and
`scripts/load/check-cache.mjs` (the same through nginx).

Also in: nginx keeps connections to the two apps open (`upstream ... keepalive 64`; the old `Connection: close` for
non-upgrade requests is gone), serves the built files itself with `gzip_static` (deploy.sh gzips them once), and the
busy page. Whether each is worth it comes from the part 2 numbers (each is reverted if it is not).

## Dry run (not a result)

One minute, 1 then 2 people a second, on a machine with a load average near 4 on 4 CPUs (other agents building), so
treat nothing as a measurement. It showed the harness runs end to end: 100 people, 0 errors, every path reached (pages,
files, API, voice upload to the Spaces stand-in, voice processing in 0.7 s typical, sign-up through the WAWU ID stand-in,
share page and card), CPU and memory sampled for every process, database connections 8 to 19 of the pool of 20 (the pool
is already near full at 2 people a second; part 2 watches it).

## Still to do (part 2)

The measured ramp; the first thing that breaks and the fixes with before and after; the per-address values; the
shared-address pass test; the nginx connection limit (768 per worker is the Ubuntu default); the database pool; Next page
caching; the WAWU ID question for the owner (sign-ups a minute it can take, and the sign-ups a minute each wave needs); the
wave size and droplet size.
