VERDICT: FIX

# V-TOPIC-MAILS-2 round 7: independent check

Branch `v/topic-mails-2`, head 13f35d3. Own Postgres 16 and Redis. The relay was always a local stand-in on a local port. No `.env` or key file opened. My attack specs are not committed. No product code or existing test changed.

Plain version: the round 6 big fault (a relay outage setting good people aside) is closed. I found nothing HIGH. One MEDIUM from round 6 is still open exactly as it was, and you said every MEDIUM must be closed, so the word is FIX. If you rule that the 30% brake stays as it is, then everything else here is a MERGE and nothing else blocks Sunday 06:00Z.

## Round 6 findings: CLOSED or OPEN (my own runs)
| # | Round 6 finding | Now |
|---|---|---|
| HIGH-1 | outage sets good people aside | **CLOSED.** All outage runs below: 0 set aside, nobody twice. |
| MEDIUM-1 | more than 30% truly dead addresses: brake fires every tick | **OPEN, unchanged.** 40 dead (always 422 `invalid_recipient`) first of 100, tick a minute for 300 ticks: all 60 good mailed once, **1,884 relay calls, 2,122 warning lines, 20 skip rows** left. Same numbers as round 6. Not a loss of mail; cost and log noise. Real life (1 to 5% dead) is not touched. The builder says it needs a ruling (`topic-mail.service.ts` ~985-1010, `REFUSAL_BRAKE_SHARE = 0.3`). |
| LOW-1 | slow relay, long tick | unchanged, fine (not re-run) |
| LOW-2 | app starts before the trouble table exists | **CLOSED.** Table renamed away, 20 people, one failing: 19 of 20 mailed (the failing one stays unmailed as asked), nobody twice, 0 errors, 6 warning lines, 22 calls. Table back: mail normal. |
| LOW-3 | tight time margin in `topic-mail-skip.spec.ts` | see the suite line below |

## Findings, most severe first
### MEDIUM-1 (carried over, OPEN): see the table. Fix needs a ruling on what the brake does when many addresses are truly dead (for example, do not take skips back when the refused addresses are the same ones as the last tick).
### LOW-1. A person who joins or turns the mail on after the day's run has finished gets nothing in that window
`finished` (`topic-mail.service.ts:161`, `isFinished` ~790) marks the window done once all due people were mailed. 50 people made after that: 0 relay calls, mailed the next day. Same as main (`finished` exists on main), not new.
### LOW-2. A dead address costs 12 to 14 relay calls a day when most of the list is fine
The "tried once a tick" rule means each always-failing address is called about once a tick while the run keeps going and the five-in-a-row stop does not hit. Worst measured: 13 calls a day per failing address (3,000 people, 30 failing) and 13 to 14 per day per bad address when half the audience is bad (300 people, 150 bad: 1,950 to 2,070 calls a day for the 150). Bounded, not growing, never blocks a good person. The builder's own report says 62 a day for 5 dead addresses alone at the end of a small list; I did not see that large a number because my lists had good people early in the window.

## What held (numbers)
1. **Outage cases** (builder's spec, 9 of 9 pass, 91 s, plus mine):
   - 200 people, relay up for first 149 sends, then 500 for 20 ticks, then fine: 200 of 200 mailed, 0 aside (builder spec).
   - 2,100, down 60 ticks after 2,000 mailed, then 30 up: 2,100 of 2,100, 0 aside (builder spec).
   - Down from the first send 20 ticks, then fine: 200 of 200, 0 aside (builder spec).
   - Half the requests failing at random 60 ticks: 200 of 200, 0 aside (builder spec).
   - **Down for the last part of the window:** 200 people, relay up for the first 150 sends, then 500 until the window ends (300 ticks): 150 mailed, 50 unmailed that day, **0 set aside**, 1,750 relay calls in the window (about 6 a tick; the five-in-a-row stop). Next day (new question, relay fine): 200 of 200 mailed, nobody twice. The 50 are mailed once the next window; the day-1 question is not sent late.
   - **Random failure, 2,000 people, a whole window (my own seeds):** 19%: 2,000 of 2,000 mailed, **0 aside**, 2,459 calls. 15%: 2,000/2,000, 0 aside, 2,341 calls. 10%: 2,000/2,000, 0 aside, 2,226 calls.
   - **Even-digit ids always fail (half bad), 300 people, 3 days:** the 150 good people mailed all 3 days (150 of 150 each day), 0 set aside, bad ones never mailed; relay calls 2,070 / 1,950 / 1,950 per day (all on the bad half). The bad half is not set aside (the relay looks unwell to the rule, so troubles are uncounted), by the builder's own "said plainly".
2. **Round 5 cases, three days** (builder's spec, and mine for the big one): 5 first / 5 middle of 200 and every 7th of 210: good people mailed once each day, 0 aside (builder numbers: 62, 62, 12 calls per failing address a day). **My own: 30 always-reset among 3,000, 3 days: 2,970 of 2,970 good mailed each day, 0 aside, nobody twice, 360 / 359 / 359 relay calls on the 30 (max 12 to 13 each).** Address 0 failing on day 1 and recovering on day 2: mailed on day 2 (counted in the "+1"), and again on day 3. (Reset stands in for timeout: same relay-trouble path; I did not make a 10 s timeout.)
3. **Gaming the counting rule:**
   - Flapping relay, 200 people, 100 ticks: up 6 / down 1: 200 of 200, 0 aside, 233 calls; up 5 / down 1: 200/200, 0 aside, 239; up 6 / down 2: 200/200, 0 aside, 266; up 9 / down 1: 200/200, 0 aside, 222. No one twice.
   - New instance on every tick (a restart each minute, so totals reset every tick) with 16% random failure: 200 of 200, 0 aside, 227 calls. Restart only makes fewer troubles count, as built.
   - One person failing on 3 consecutive ticks while 59 others fine (`A5`): not set aside (the first try is 3 calls inside one trouble and the later ticks have fewer than 5 others to count), 60 of 60 mailed.
   - Could not make a good person set aside with any shape I tried. The cheapest way I can see is three failures of the same person with at least 5 good sends between each; at 19% random failure the chance per person is about 0.0069 x 0.19 x 0.19, so 2,000 people give about 0.5 expected; my run gave 0. I did not hunt that tail further.
4. **Once only:** 50 server instances on the same 20 ticks, 300 people, 20% random failure: 300 of 300 mailed, **300 `MailLog` rows, max 1 per person**, 368 calls. Two servers in the builder spec: 193 of 193 good, nobody twice. Every outage and flapping run above: twice = 0. Crash orders: the log row is written before the relay call (`mail.service.ts:379`), deleted only when the relay answered not-ok (`~395`), so a crash between the row and the call loses that one mail and never sends it twice (not killed live by me). Relay delivered but answered 500 (lost answer): every person got a 500 first then 200: 30 of 30, twice = 0, 60 calls; the Idempotency-Key (`vm-` + hash of user, template, eventKey) is the same on every try, so a real relay that honours it will not send twice; whether it does I could not prove. Clock change and a real SIGKILL: not run.
5. **Scale, 100,000 people due, budget 2,500:** first tick sent 2,500 in 14.6 s with pacing mocked, 12,379 database transactions (about 5 per send, from the send itself: reserve, budget count, row delete or keep; not per person scanned), then 3 ms and 0 transactions per tick (budget reached). `MailLog` 2,500 rows, 2,500 relay calls, cap never passed. Heap read 1,167 MB, but that is the whole test process with 100,000 created users and the app booted, not the loop alone; round 6 read 232 MB at most. I did not isolate the loop's memory. The new counters are in memory per person with a trouble only; I saw no extra query for people without trouble. Sign-in codes: the budget counts C01 and C02 rows only (`usedToday`), not touched by this.
6. **The rest:** 600 people named wrongly (422) for 60 ticks then fine: 600 of 600 mailed, 0 skip rows, 1,200 calls. Builder spec also covers 429 pauses and the daily cap, passing. Unsubscribe: `unsubscribeKeys()` has 2 keys when the secret is set (round 6 proved a link signed with either verifies). Logs captured in the 300-tick outage run: 0 lines with an address. `TopicMailTrouble` holds user id, template, window only; no new address or fingerprint column this round. Launch-open mail C14: runs through the builder-suite; see suite line.
7. **Join and migrations:** `origin/main` 6eccda4 is fully inside the branch (`merge-base --is-ancestor` true), so the merged tree is the branch. Added: `20261114210000_mail_log_template_created`, `20261114250000_topic_mail_skip`, `20261114270000_topic_mail_skip_2`, `20261114330000_topic_mail_trouble`; main's: `...200000 ...220000 ...230000 ...280000 ...290000 ...300000 ...310000 ...350000`; no equal stamp. Each has `rollback.down.sql`. Applied main's migrations first, then `prisma migrate deploy` with the four added after newer stamps: all applied, 0 unfinished. `...270000` deletes all `TopicMailSkip` rows before dropping the address column (skip times only; known from round 5); the other three are additive. I did not run the rollback files this round.
8. **Gate:** `npm ci`, `prisma generate`, `tsc --noEmit` exit 0. eslint without `--fix`: 0 errors, 51 warnings. Builder's round 7 spec on a fresh database: 9 of 9 pass.

## Full suite
`npx jest --runInBand` on a fresh database I started: **154 suites passed of 154; 2,599 tests, 2,598 passed, 1 skipped, 0 failed** (2,129 s). That count includes my two uncommitted attack specs (15 tests), so the branch's own is 152 suites and 2,584 tests, all passing. Audio node tests: 13 of 13 pass (run separately). The round 6 failures (`vote.spec.ts`, two timing tests in `topic-mail-skip.spec.ts`) did not fail this time; the machine was otherwise idle for this run. An earlier run, started while my attack specs shared the 4 cores, showed one failure in `test/talk/fixb-r4-edit.spec.ts` (a 409, a race); I stopped it and the clean rerun passed that suite. C14 (`launch-open-mail.spec.ts`) passes inside this run.

## Could not prove
- The real relay (refusal words, 429, Retry-After, Idempotency-Key). A true 10 s timeout (used a connection reset), a real clock change, a real SIGKILL.
- The loop's own memory at 100,000 people (reading was whole process).
- Rollbacks run this round; the 100,000 case with any failing people.
