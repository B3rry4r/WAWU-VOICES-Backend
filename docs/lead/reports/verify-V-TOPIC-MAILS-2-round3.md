VERDICT: FIX

# Verify V-TOPIC-MAILS-2, third check (code 948af63, merged clean into verify/v-topic-mails-2)

Verifier run, 14 Nov 2026. `git merge origin/v/topic-mails-2` was clean. Own Postgres 16 (port 55490) and Redis (56490), both stopped at the end; one throwaway worktree of origin/main for the "other mail" comparison, removed. No live provider, no .env or key file opened. My attack specs (`api/test/mail/zz-v3-attack.spec.ts`, `zz-v3-big.spec.ts`, `zz-v3-other.spec.ts`) are not committed. The clock was passed in (simulated Lagos days); a tick was called by hand, once a minute of simulated time.

**What I found in one line each.** N1 (the second check's HIGH) is closed: nobody good is starved by 10 bad addresses, any day, any restart, C01 and C02. But the new rule "after any sent mail, a refusal is 24 hours" turns a relay fault that starts after the first mail into **hundreds of good people lost for the day** (H1, HIGH). Also: 3,000 bad addresses at the head of the order can starve a whole C01 window (M1), a deleted person's address stays in the table (M2), and a corrected address is not asked at once in a running server (M3).

## Earlier findings and their state

| Earlier finding | State | Run that shows it |
|---|---|---|
| Second check N1 (10+ refused stop the run on the same people for ever) | **Closed** | S1 below: 4 runs, both templates |
| N2 (under 10 people, all 404, quiet for 24 h) | **Closed only when no other mail was logged in the last 6 h; open otherwise (part of H1)** | S2 N=3: with an account mail logged each minute, 3 of 3 people got a 24 h row at 07:00, relay put right 08:30, 0 calls for the other 299 ticks, 0 mailed |
| N3 (5xx person while others were sent is not asked again) | Open, rule choice, code path unchanged (`topic-mail.service.ts` `sent > 0` marks finished) | not re-run |
| N4 (401/403 noise, one error line per tick) | Open, noise. 500 to everyone: 300 error lines in 300 ticks | S3 |
| M1 C02 half until noon (lead's ruling), L1 (Lagos/UTC day), L3 skip list lost at restart | M1/L1 unchanged. **L3 closed**: the table survives a restart (S1b with restart) | S1b |
| L5 rollback leaves migrations row | Closed (item 9) | |

## Proved by runs

### 1. N1, its four runs (S1; relay stand-in answers 422/404/410 for bad addresses, 200 for the rest; budget 5000; a tick every minute or five)
- **10 bad first among 500 good**, C01 and C02: tick 1 `stopped`, sent 0, 10 calls; tick 2 `done`, sent 500, 500 calls. Good mailed 500 of 500; bad addresses asked 10 times in the first minutes, then once an hour (C01 window to 12:00: 50 calls on the 10 in 5 hours, 4 `stopped` ticks, one error line an hour; C02 over 17 hours: 160).
- **12 bad scattered among 300, day 1 and day 2**, C01 and C02, **with and without a restart (new service object)**: C01 day 1 `done` sent 288, 12 bad calls; day 2 (new question) `done` sent 288 again, 60 bad calls (5 `stopped` ticks); rows per question 288 and 288. Same with restart: identical. C02: day 1 288 mailed; day 2 nobody left to mail, 192 refused calls (16 `stopped` ticks of 10) in a day for 12 bad addresses.
- **10 bad in a row in the middle of 100**: tick 1 sent 90 at once (100 calls).
- Nobody good was left out in any of these.

### 2. Relay refuses only the topic templates (404 for C01 and C02; account mail B11 goes through and is logged every minute); put right halfway (S2)
C01, 505 people, window 07:00 to 12:00 Lagos, fault put right at 09:30 Lagos (halfway), a tick a minute:
- **Per tick:** ticks 1 to 50 each `stopped`, sent 0, 10 calls, 10 people on a one-hour row (`relay-trouble`). Tick 51: the last 5 people (505 mod 10): 5 refused, sent 0, **account mail logged lately, so a 24 hour row (`refused`) for these 5**. From tick 52 on `done`, 0 calls, until the first hour rows run out (06:00Z plus 1 h); then 10 calls per tick again, `stopped`, rows extended for another hour, 1,285 refused calls in the window in all.
- **After the relay is put right at 08:30Z:** the people whose hour ends after 08:30Z are mailed as their rows run out: 220 mailed at 09:00Z, 500 at 10:00Z (one more hour is the longest anybody waited). **5 people never get the day's mail** (24 h rows), 500 of 505.
- Same without any account mail logged: 505 of 505 mailed (all rows are one hour). So the 6 hour rule is what takes those 5 out.
- C02, same shape, fixed 14:30Z (15:30 Lagos): 500 of 505 mailed by 16:00Z; 5 on 24 h rows (they get it next day; C02 is a week, so only 24 h late).
- **Do sign-in mails count as "any mail was logged in the last 6 hours"?** No. They are sent by WAWU ID and write no `MailLog` row here (read: no MailLog write outside `src/mail`, no OTP template in `MAIL_TEMPLATES`). **Account and notification mail do count**, every template through `MailService` (B, D, E, G...), and so does the other topic template; in a live app that is almost always true (`relayDeliveredLately`, `topic-mail.service.ts:~346`).
- **Can a template fault put hundreds of good people on a 24 hour skip? Yes** (H1 below): 405 of 505 when the fault starts after the first mails.

### 3. Relay shapes (S3, 200 people, C01 window, a tick a minute)
| Relay | Result |
|---|---|
| 404, 200, 404, 200 | 100 mailed, **100 on 24 h rows**, 0 calls after tick 1 |
| first nine refused, then good | 191 mailed, 9 on 24 h rows (they are the nine bad ones) |
| nine 404 and one 200, repeating | 20 mailed, **180 on 24 h rows** |
| 429 after 30 calls | `capped`, 30 mailed, 31 calls, 0 rows, `capped` all window (rule as before) |
| 500 to all / 502 to all | each tick `stopped`, 15 calls (5 failures x 3 tries), 0 rows, 300 error lines, 4,500 calls in the C01 window |
| timeout (never answers) | one tick = 150 s (5 people x 3 tries x 10 s), `stopped`, 0 rows, 0 skips |
| connection dropped | `stopped`, 0 rows, 0 skips |

### 4. Many servers on one database (S4: 400 people, 12 bad, budget 500, C01 and C02 together, 4 rounds)
2, 5 and 10 instances: C01 388 plus C02 112 = 500 = the budget, C02 well under its half (250); no person mailed twice (0 duplicate 200s per template at the relay); 24 skip rows (12 x 2 templates), 0 duplicate (person, template) rows; 0 deadlock, unique-key or transaction lines in the log (error and warn lines scanned). **Wasted refused calls: 39, 79 and 164** against 24 needed (each instance asks the bad ones before another's row is written). Not harmful, named.

### 5. The skip row and the person (S5)
- **Address changed:** row `refused`; the person corrects the address; the next minute, same process: `done`, sent 0, **0 calls** (the person is not asked at once: `rescanAt` keeps the run from being scanned until the first skip ends). A new service object (restart) next minute: asks the new address at once, sent 1. `due()` itself keeps the L2 rule; the run is not looked at (M3).
- **Switched off / unsubscribed, suspended, banned, deletion pending:** after the skips ran out (next day) none of them was asked; only the one still-bad active address was. The rows stay until their time plus 7 days.
- **Account deleted:** the deletion service sets `mailTo: null` (`src/me/deletion.service.ts:~471`) but does not touch `TopicMailSkip` (no foreign key: 0 FK constraints on the table; no reference in the purge or in `export.service.ts`). **The row, holding the email address, stays** (M2).

### 6. Budget and other mail
- Budget 3, 5 people, the first two bad: 3 sent, 3 MailLog rows, `budgetLeft` 0, 5 calls (2 refused), second tick 0 calls. A skipped person takes no place; refused calls leave no row (the budget counts C01/C02 MailLog rows only).
- Refused calls on the relay itself are not counted in the topic budget and I cannot say whether the relay counts them against its 5,000 (not proved). They are bounded by the code at 10 per tick and template when nothing is sent (3,000 in the C01 window, 14,400 a day for C02), 15 per tick for 5xx.
- **Other mail, same request on branch and on origin/main (own worktree), E05 `MailService.send` and A10 `sendNotice`, statuses 422, 404, 400, 401, 403, 410, 429, 500, 503, 200:** outcomes and call counts identical on both ("IDENTICAL" by diff): 4xx `failed` after 1 call, 429 `capped` (A10 `failed`), 500/503 `failed` after 3 calls, 200 `sent`; never `refused`; no skip row. Sign-in mail is outside this code.

### 7. Clean-up and size (S7, big)
- Rows more than 7 days past their time go: until = run time minus 7 d minus 1 min: deleted; minus 7 d plus 1 min: kept; minus 6 d: kept; future: kept. Never early.
- **The sweep runs only when a run reaches `sendAll` past the budget checks.** With `TOPIC_MAIL_ENABLED=false`, or no question open, a 30-day-old row (with its address) stays for ever (M2).
- The table is bounded by people times two templates (unique key on person and template, rows are updated, not added): at most 200,000 rows for 100,000 people.
- **500,000 active people with an address, 100,000 live skip rows plus 100,000 old ones:** `due()` for C01 took **14.2 s and 13.6 s** (400,000 people returned); with no live skip rows 12.7 s. So the skip table adds about 1 to 1.5 s; the 12.7 s is the existing scan of all people (one tick per template per minute; overlapping ticks are dropped). **Plan of the skip read for one page of 2,000 people:** Parallel Seq Scan on `TopicMailSkip` (200,000 rows), filter on template, until and the id list, 22.7 ms (250 pages is about 5.6 s of the 13.6 s); the planner did not use the (userId, template) unique index on the 2,000-value list. **Plan of the sweep delete:** Bitmap Index Scan on `TopicMailSkip_until_idx`, 100,000 rows in 41 ms. 
- At the real size (hundreds to a few thousand people) none of this matters.

### 8. Finish and stuck-`stopped`
- Nothing sent because of failures or refusals is never marked finished: `stopped` ticks every minute in S3 (500, 502, timeout, 404-all), `finished` stays empty. When everyone good has the mail, the run is `done`, with `rescanAt` at the first skip end; the bad ones are asked again when their row ends (S1: once an hour while nothing else is sent, in ten at a time, each time `stopped` with one error line when 10 or more are due; with fewer than 10 it is a `done` with no error line).
- What the admin sees: `/admin/today` shows only `sentToday` (C01, C02) and `budgetLeft` (`src/admin/today.service.ts:132, 230`). **A `stopped` run, a template fault, or 405 people on a 24 h row is not visible there**; the only trace is the error log line (one per stopped tick).

### 9. Migration
Database migrated from origin/main (18 migrations, 1 User, 1 MailLog row), then `prisma migrate deploy` from this branch (20 migrations, includes `topic_mails`): "All migrations have been successfully applied", table has the 7 columns. One skip row inserted; `rollback.down.sql`: `DROP TABLE`, `DELETE 1`; table gone, users 1, logs 1, the migrations row gone (19). Deploy again: table back, users 1, logs 1. `prisma migrate diff` shows nothing about `TopicMailSkip` (it shows other, older drift such as `searchTsv` indexes, not this change). **Deleting its own `_prisma_migrations` row is right for this repo:** 11 of the 12 `rollback.down.sql` files do it (the one that does not is `20261114100000_topic_mails`, this task's own first migration), so a later `migrate deploy` rebuilds the table.

### 10. The six changed spec assertions (`git diff c40408d 948af63`)
Each is the new rule and nothing else: (1) budget2 `forget` clears `rescanAt` instead of the removed map, plus an emptied table in `beforeEach` (no assertion edited); (2) relay-trouble `beforeEach` the same; (3) 401/403/404: 0 rows for 401/403 as before, 10 rows for 404, and after recovery N-20 then 20 an hour later (the lead's one-hour rule); (4) 408/425 `refusedUntil.size` to 0 rows; (5) nine refused: size 9 to 9 rows; (6) ten refused: old "nobody skipped, next tick asks the same ten" to "ten one-hour rows, next tick mails the other 20, an hour later the ten" (the one real rule change). Nothing weakened. **No assertion covers a refusal after a first success caused by the relay** (H1), nor a corrected address in a running server (M3).

### 11. Checks
- `npx tsc --noEmit`: exit 0.
- eslint on `topic-mail.service.ts`, `mail.service.ts` and the three spec files: 0 errors, 0 warnings.
- `test/mail`, my attack specs excluded, three times: 9 suites, 138 tests, 3 of 3 passed (138/138).
- `admin/ops` and `admin/overrides` (read `/admin/today`): 2 suites, 68 tests passed.
- Full API suite (`jest --runInBand`, my specs excluded): **106 suites passed of 106; 1276 passed, 1 skipped, 1277 total.** No red, so no comparison with origin/main was needed. (`npm test` also runs the audio node tests; I did not run them, not this change.)

## New findings

### BLOCKER
None.

### HIGH

**H1. A relay fault that starts after the first mail of a run puts every remaining good person on a 24 hour skip; nothing asks them again when the relay is put right, so for C01 they lose the day's mail.** `api/src/mail/topic-mail.service.ts:~548-575` (after `sent > 0` refusals never stop the run and are collected in `pending`), `:~346` `relayDeliveredLately` (any MailLog row of any template in the last 6 h), `flush` at `:~516` (`long = !trouble && (sent > 0 || relayDeliveredLately)`).
- What I did: C01, 505 people, relay answers 200 to the first 100 topic mails, then 404 to C01/C02 only (account mail still goes through and is logged every minute), put right at 08:00Z (2 hours into the 5 hour window); a tick a minute.
- What happened (S2x): tick 1 sent 100 and refused 405 in one pass; **405 rows `refused`, 24 hours each; 100 of 505 mailed at the end of the window; 300 ticks, 0 further calls.** The relay was good again for 3 hours before the window closed. Alternating relay: 100 of 200 lost; "nine refused, one good": 180 of 200 lost. The next day (new question) all of them are mailed again (S2y: 150 of 200 on rows after a 50-mail fault; day 2 all 200 mailed in the first two ticks), so it is one edition lost, not more; for C02 it is a day late. Small audiences and the last people of a run: with any account mail logged lately, refusals that end a run with fewer than 10 left (nothing sent in it) also get 24 hours: 5 of 505 in S2, 3 of 3 in the small case.
- Should be: a refusal burst that is not the person's address must not cost 24 hours. For example: a person refused after a sent mail but in a burst (say 10 refusals close together, or a refusal rate far over the run's own) gets the one-hour row, not 24 hours; or every refused person is asked again once after one hour in the same window and only a second refusal makes it 24 hours (a bad address costs one more call, a good person is not lost for a day). Whatever is chosen, "100 sent, then 405 refused, relay right 2 hours later" must mail the 405.
- Is it likely tomorrow? It needs a relay fault that refuses with 400/404/410/422 for the topic templates only (a changed template name, a sender or tag rule, a bad deploy of WAWU ID's mail endpoint) and that begins or comes and goes while a run is on. Not known; the cost is thousands of people losing the first C01.

### MEDIUM

**M1. About 3,000 or more bad addresses at the head of the order starve a whole C01 window.** `topic-mail.service.ts:~565-575` (10 refusals with nothing sent: stop, one-hour rows), order from `due()` (never mailed first, then id). 3,500 bad addresses (the oldest accounts) in front of 200 good: 300 ticks, each `stopped`, 3,000 calls, **0 good people mailed in the window**, 610 rows at the end (S8c). At 1,000 bad in front, the good wait 100 minutes. Bound: 10 bad people skipped per minute while nothing has been sent. The first run ever is the only time the order is by id with every person never mailed. Should be: skip further than 10 when nothing has been sent but other people exist (probe a few people from further down the list), or order people never refused before the ones refused before.

**M2. A deleted person's email address stays in `TopicMailSkip`, outside the purge and the account export.** `prisma/schema.prisma:1385` (no relation, no foreign key), `src/me/deletion.service.ts:~471` clears `mailTo` but the new table is not in the purge list (`:~410-444`) nor in `export.service.ts`. S5: a skip row of a person set `DELETED, mailTo null` still held the address. The row goes only 7 days after its time (8 days after a refusal) and only if a run reaches the sweep: with `TOPIC_MAIL_ENABLED=false` or no question or topic open, a 30-day-old row stays. Should be: delete the person's `TopicMailSkip` rows in the purge; decide (and say) whether the address belongs in the export; run the sweep at the start of a tick, before the "nothing open" returns.

**M3. A corrected address is not asked at once in a running server.** `:~87` says it is, and `due()` does it, but `isFinished`/`rescanAt` (`:~478`) returns `done` for the whole event key until the first skip ends: after one refusal among 20, the person fixes the address, the next minute `done`, 0 calls; a restart asks at once (S5a). The person waits up to 24 hours (the day's C01 is lost). Should be: make the rescan time at most the time of the next change, or accept this and take the claim out of the report.

### LOW

**L1.** Refused calls cost the relay: 10 per tick and template when nothing is sent (3,000 in the C01 window, 14,400 a day for C02 while a template fault or a pile of bad addresses lasts), 15 per tick for 5xx (4,500 in the C01 window); 10 instances asked 164 times for 24 skip rows in S4. Whether the relay counts refused calls against the 2,500/5,000 a day it shares with sign-in codes I cannot tell (not proved); the MailLog budget does not count them.
**L2.** The admin sees nothing of a stopped run or a mass skip (`/admin/today` shows sent counts and budget left only); the error log has one line a tick.
**L3.** `due()` reads every active person every tick: 13 to 14 s for 500,000 people (12.7 s before the skip table); the skip read per 2,000-person page used a Parallel Seq Scan (22.7 ms). Fine at the real size.
**L4.** The sweep deletes only when a run reaches it (see M2).

## Read only
`topic-mail.service.ts` and `mail.service.ts` as a whole; the migration and its rollback; the three spec diffs; `deletion.service.ts` and `export.service.ts` (no `TopicMailSkip`); `today.service.ts`; the 12 `rollback.down.sql` files; that sign-in codes are not in this code and write no MailLog row (the WAWU ID side is not in this repository).

## Not proved
A real relay: which statuses it gives for a bad address or a bad template, whether refused calls count against its 5,000 a day, whether a real template fault looks like my stand-in. Real processes (one Node process with several service objects over one pool was used; "restart" is a new service object). A real clock rollover and a real tick timer (a tick was called by hand with a passed-in time; counts of calls per day are tick counts times 10, not measured over a day). 100,000 bad addresses end to end (I measured the read of 500,000 people with 100,000 live and 100,000 old skip rows, not 100,000 refused calls). N3 and the 401/403 noise were not re-run. The audio node tests.
