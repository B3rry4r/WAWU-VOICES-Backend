VERDICT: FIX

# V-TOPIC-MAILS-2 round 5: independent check

Branch `v/topic-mails-2` head 39935f9 (7 commits behind `origin/main`, 11 ahead). Own Postgres 16 and Redis. The relay was always a local stand-in. No `.env` or key file opened. My attack specs are not committed. No product code or existing test was changed.

## Findings, most severe first

### HIGH-1. Five addresses the relay keeps failing (5xx, reset, timeout) stop the daily and weekly mail for everybody
Also on `main`, so not new in this branch. Round 5 leaves it open, and the brief says relay trouble must not cost good people the day's mail.
- Why: a 5xx person is never skipped, so they are never mailed. `due()` sorts "never mailed first, then by id" (`topic-mail.service.ts:366-368`), so from the second day these people sit together at the front. Five in a row end the run (`:42`, `:735`). The next tick starts at the same five.
- Numbers (C01, a tick every minute for one hour):
  - 4 such addresses first of 200: 196 of 196 good people mailed.
  - 5 such first of 200: **0 of 195 mailed**, 1,800 relay calls. Same with 6, with connection reset, with 503.
  - 5 in the middle (ids 100-104): 100 mailed, **the 95 behind them never**.
  - **Every 7th person of 210 answers 500 (30 addresses):** day 1 180 of 180 mailed. Day 2 **0 of 180**. Day 3 **0 of 180**. The same run on `origin/main` gives 180, 0, 0.
- Steps: relay stub answering 500 for those addresses and 200 for the rest; 210 users with addresses; one question per day; `runDailyQuestion(at)` every minute from 06:00Z, three days.
- Fix idea: count a 5xx for one person as a skip (short, growing) after N tries of that person; or take people in an order that does not put the same failing ones first.

### MEDIUM-1. The wait rule in the brief is not what was built
- Brief: first refusal one hour, then longer. Built: 24 hours at the first refusal (`topic-mail.service.ts:52`, `:713`). It never grows (a dead address costs one call a day for ever, not fewer). Round 4 had the one hour; round 5 removed it.
- Effect: one named refusal costs a person the whole day's mail. Worse, there is no brake if the relay names the address wrongly for many people. Relay answers `422 {code:"invalid_recipient"}` to everybody for one hour (600 people, a tick a minute): **600 of 600 get a 24 hour skip, 10 per tick (600 calls), and at the end of the 5 hour window 0 of 600 are mailed.** A 5 hour window can burn about 3,000 people this way (10 a tick). Needs a relay that misreports, which I could not prove it does; the words it uses are a guess (`mail.service.ts:60-90`; the repo has no sample).

### MEDIUM-2. A 429 ends C01's whole day, whatever the reason (also on `main`)
`topic-mail.service.ts:692-697` sets `cappedOn` for the Lagos day; `mail.service.ts:567-579` logs the reason but does not use it. C01: 429 after the 101st mail, relay fine ten minutes later: 101 of 300 mailed, **199 never that day** (state `capped` to the end of the window). C02: tried again next Lagos day, 199 mailed then. Fine for a true daily cap. A rate-limit 429 loses the day.

### LOW-1. Old unsubscribe links break when `MAIL_UNSUBSCRIBE_SECRET` is set later (also on `main`)
Verification uses only the current key (`mail-unsubscribe.controller.ts:36`, `mail.service.ts:193`). With the secret unset, a link signed by the service key works (GET 200, POST 201, switch turned off). After the secret is set: the old link gives HTTP 400, the new one 201. Mails already sent keep a dead one-click link. Fix: accept both keys.

### LOW-2. C14 changed for a named refusal
Everything else is the same as `main`. Compared on both trees: 3 always-500 people give up after 6 stalled runs (same sequence, 70 calls); 500 for all stops every 10 minutes (same); once per person, daily switch off, `LAUNCH_OPEN_MAIL=off` (same). New: a named refusal (422 `invalid_recipient`) now means 1 call and the run ends `done`, the person is not counted as "left" (`launchLeft`, `:~835`), so `launchDone` is set; `main` asked that person 7 times. A C01 skip also blocks C14 for 24 hours, and after the skip ends the person still gets no C14 in this process (`launchDone`).

### LOW-3. Noise and small things
- Steady state with dead addresses: 137 of 330 ticks a day end `stopped` with an **error** log line ("named N addresses in a row", `:724-725`), and the admin run shows `stopped`, with nothing wrong.
- A crash after the log row is written and before the relay delivers loses that one mail (never sends it twice): 1 person per kill, 2 of 2 runs (D2, D3). Documented trade-off.
- Round 5's code needs the `TopicMailSkip` table in every run; with the table missing, C01 and C02 throw each tick (tested by renaming it). Migrate before start.
- `addressHash` is an HMAC of the address with `VOICES_PHONE_PEPPER`: not an address, but still a stored fingerprint of one. Say so to whoever signs off privacy.

## What held
1. **Refused versus trouble.** Refused shapes (422 `invalid_recipient`, 400 `error.code suppressed`, 404 `errors[].field to`, 410 `reason hard_bounce`, 422 `param email`): 1 call, a 24 hour row, no log row, 39 others mailed, not asked again at 1 min, 30 min, 2 h, 23 h, nor after a restart. Trouble (500, 503, reset, 429 rate, 422/400/404 with no named address, 401, 403, 408): no skip row, no log row, mailed once after recovery. Hang (10 s wait, 3 tries, 30 s): not skipped, mailed once later. Slow 1.5 s: accepted in 1 call. A late 200 after the client gave up: same Idempotency-Key on all 3 tries, one delivery with a relay that honours it (I cannot prove the real relay does). Outage 30 minutes (500, 503, reset, C01 and C02): 15 calls a minute, 0 skip rows, then all 300 mailed exactly once. Every 7th person failing: 180 of 210 at once, 210 after recovery. Ten refusals in a row stop a run (10 calls, `stopped`), the next tick mails the other 100. Both templates in a 120 minute full outage: 3,150 calls (26 a minute).
2. **Budgets.** 5,000 people, 1,516 dead (30%), default 2,500, four days, ticks every minute, C01 and C02 together: sent 2,500 each day (MailLog rows never above 2,500; C02 1,250 before noon). Relay calls a day: 3,574 on day 1, then 4,016 (2,500 sent + 1,516 dead calls, each dead address once a day). Dead calls write no log row, so they use no budget. M4 is closed. Most calls in one tick: 2,504. Ten in a row stop the tick: 137 stopped ticks a day. Sign-in codes: the topic budget is the only cap; 4,016 calls a day leaves about 1,000 of a 5,000 relay allowance if refused calls count against it (I could not tell). `TOPIC_MAIL_DAILY_MAX` at 5,000 would leave none. (The test counted the same person's C01 on four different days as "twice": MailLog rows 10,000 = deliveries 10,000 = unique keys, so no repeats.)
3. **Once only.** 50 service objects, C01 and C02, 200 people: 400 deliveries, none twice. 50 parallel sends of one job: 1 sent, 49 `limited`. 50 parallel runs with failing people: once each, all 200 after recovery. Clock moved −3 h, +20 min, −1 day, +1 day: no repeat. Real processes killed with SIGKILL (D1-D5): killed after the relay took the mail: 40 of 40 once, 0 twice. Killed before: 39 mailed, 1 lost, 0 twice. Killed on a 500: same, 1 lost. Three servers at once: 120 of 120 once. Two servers, one killed: 120 of 120. Unique key `MailLog_userId_template_eventKey_key` held.
4. **No address kept.** 32 log lines from every path (sent, refused, 500, reset, 429, a broken table): none with an address or `@`. Database dump after the runs: test addresses only in `User` (40 rows). New columns are `addressHash`, `refusedAt`, `until`, `reason`. Migration 270000 removed a row that held a plain address (0 left in a dump). No queue or job payload in this feature.
5. **Switches.** Daily off: no C01, still C02; weekly off: no C02, still C01. Switch flipped for 40 people on the 20th call, mid-run: 0 mails to them after the flip, in both C01 and C02 (60 delivered of 100). The service-key link works (see LOW-1 for the other order).
6. **C14.** `runLaunchOpen` is the same text as `main` (only the `due()` return shape). See LOW-2. Its specs (`launch-open-mail.spec.ts`) pass.
7. **Migrations.** Branch adds `20261114210000_mail_log_template_created`, `20261114250000_topic_mail_skip`, `20261114270000_topic_mail_skip_2`. `main` has `20261114200000_fix_d`, `...220000_hotfix_1`, `...290000_free_posts_5`, `...300000_launch_hint`, `...310000_open_launch_now`. No equal stamp. Branch stamps sit before main's 290000+, so deploy applies them out of order (works). On a database with main's 24 migrations and 2,000 users and 2,000 mail rows: deploy applied the 3 (status up to date), the three rollbacks run in reverse order (2,000 rows kept, table and index gone, `_prisma_migrations` rows removed), deploy again applied them. `migrate diff` shows nothing about `TopicMailSkip` or `MailLog`. All additive.
8. **Gate.**
   - Branch: `prisma generate` ok, `tsc --noEmit` exit 0, `npm run lint` 0 errors, 22 warnings (it rewrote 19 test files with `--fix`; I put them back). Jest full run on a fresh database: 127 suites, 1,518 tests; 25 failed, 1,492 passed, 1 skipped. The 25 were in two files (`topic-mail-round4.spec.ts` ran 300 s, `hotfix1-block-oracle.spec.ts`) while a second full suite shared the machine and Redis. Both files alone on a fresh database: 2 of 2 suites, 26 of 26 tests pass. So 1,517 passed, 1 skipped, 0 failed when run alone. Audio node tests 13 of 13.
   - Local merge of `origin/main` into the branch (not pushed, clean merge): `tsc` exit 0, lint 0 errors, 23 warnings, jest 137 of 137 suites, 1,598 passed, 1 skipped, 1,599 total, audio 13 of 13.

## Not proved
- The real relay's refusal words, its idempotency, whether refused calls use its allowance.
- A real clock jump on a real server; only the `now` argument was moved.
- The first-run failures in `topic-mail-round4.spec.ts` were load, not logic, by the rerun; I did not run the full suite a second time alone.
