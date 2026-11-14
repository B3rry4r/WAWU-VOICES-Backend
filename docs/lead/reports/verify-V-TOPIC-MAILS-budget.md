VERDICT: MERGE

# Verify V-TOPIC-MAILS budget, commit 3cf715e (branch v/topic-mails)

Verifier run, 14 Nov 2026. No BLOCKER and no HIGH found. Two MEDIUM and three LOW notes; none needs a fix before tonight. The decisions I took are in the last section. My attack specs (`test/mail/zz-verify-budget.spec.ts`, 19 tests) were run against a throwaway Postgres 16 (port 55432) and Redis (56379), with a local relay fake. They are not committed. No live provider was called, and no .env or key file was opened.

## Findings

### BLOCKER
None.

### HIGH
None.

### MEDIUM

**M1. A C02 backlog starves C01 (the daily question mail) for as long as it lasts.** `api/src/mail/topic-mail.service.ts:~329` (`runWeeklyTopic`, runs "from 06:30 Lagos on every day while the topic is open") and `:244` (`runDailyQuestion`, 07:00 to 12:00). Both draw from one budget, and C02 starts 30 minutes before C01 every day.
- What I did: spec "X". Budget 12, 40 people, a topic and a question open on the same day. I ran C02 at 05:30Z (06:30 Lagos), then C01 at 06:00Z (07:00 Lagos).
- What happened: C02 sent 12 and ended `budget-reached`. C01 ended `budget-reached` with sent 0 and no C01 row.
- Effect: with more than `TOPIC_MAIL_DAILY_MAX` active people, C02 takes the whole budget every day until every person has had it. That is `ceil(people / 2500) - 1` extra days, and on each of them nobody gets the question mail. With 10,000 people that is Monday to Thursday. Question mail for a day that is missed is never sent later, which is the designed skip rule.
- This matches the brief ("C02 carries on the next UTC day; C01 ... not sent to the rest") and the budget itself is exact. It is a product consequence the owner should know about. At tonight's launch size (under 2,500 mailable people) it cannot happen.
- Should be: either reserve part of the budget for C01 (for example C02 may use at most half), or run C01 first. This is the owner's decision, not a merge blocker.

**M2. Five people whose address the relay keeps refusing at the front of the order stop every run, every tick.** `topic-mail.service.ts:~392` (`MAX_CONSECUTIVE_FAILURES = 5`) combined with the new order in `due()`.
- What I did: spec "3b". Budget 10, the first 5 people in order get a 422 from the relay, everyone else is fine. Three ticks.
- What happened: each tick ended `stopped` with sent 0. Nobody was mailed. Budget stayed at 10 left.
- Effect: a failed mail deletes its log row, so the failing people keep the oldest last-mailed time and always sort first. The new order therefore pins them at the front for good, where before the commit they were pinned by id order. Same blocking either way, so this is not a regression, but the fairness claim does not cover it. It needs 5 or more bad addresses at the front, and each tick retries them.
- Should be: skip a person after a refusal that is not a 5xx or a 429, or count only consecutive failures for different kinds of error. Pre-existing behaviour; not part of this commit's scope.

### LOW

**L1. A blank `TOPIC_MAIL_DAILY_MAX=` means 0 (nothing sent).** `topic-mail.service.ts:161` (`dailyMax`). `Number("")` is 0, so an empty or space-only value, and `-0`, give a budget of 0. That fails safe (never "no limit") but would silently stop all topic mail. The default `2500` in `.env.example` means it only bites if someone clears the value. Should be: treat blank as unset.

**L2. Huge values are accepted.** `1e9` gives 1,000,000,000 and `99999999999999999999` gives 1e20. That is an explicit operator choice and the relay's own cap still holds, so it is not "no limit by mistake". `budgetLeft` would then print 1e20 in JSON, which an integer contract field may not like. Should be: clamp to a sane ceiling, for example 5,000.

**L3. No index serves the budget count.** `mail.service.ts` (`reserve`) and `topic-mail.service.ts` (`usedToday`). `MailLog` has only `(userId, template, eventKey)` and `(userId, template, scopeKey, createdAt)`. I put 400,000 rows in and ran EXPLAIN ANALYZE: a parallel sequential scan, 25 ms. `budgetLeft()` averaged 18.6 ms. The count runs inside the global advisory lock, so reserves are serialized at about one per 25 ms at that size. At the 5 mails per second pace, and with the table small at launch, this is invisible. It grows with total mail volume. Should be: an index on `(template, createdAt)` in a later migration.

## Per-item results (the brief's numbering)

1. **Exactness under concurrency: holds.** Budget 13, 40 people: 2 service instances gave 13 rows, 13 relay calls, 13 different people, and the log matched the relay's addressees. 5 instances gave the same. Budget 11 with C01 and C02 racing, 5 instances each: 11 rows (6 C01, 5 C02), 11 calls. Budget 100 with 5 instances racing for one template: 40 rows, 40 distinct people, so no one was mailed twice. The unique key on (user, template, event) turns a second reserve into "limited" with no row.
2. **Day boundary: holds.** A row at 23:59:59.999 UTC yesterday is not counted, a row at 00:00:00.000 UTC today is. A row at 23:30Z yesterday (Lagos is already the new day) is not counted. A row 23 hours ago (a rolling 24h window would have counted it) is not counted. Same through the real `reserve` path with budget 1. A run that crosses midnight (fake clock stepped mid-run): 2 mails before midnight, then the budget reset and 3 more went, 5 in all, 3 of them on the new day, as the per-UTC-day rule says. The C01 window (06:00 to 11:00Z) lies inside one UTC day, so only C02 can cross.
3. **Failed send: the place comes back.** `mail.service.ts` deletes the log row after any non-"ok" answer. I ran 429 daily_cap, 503, 400 and a destroyed socket (throws). In each case 0 rows were left, `budgetLeft` was back to N, and the next run mailed all N people (the person is tried again). A 429 ends the run as `capped`. The other three end as `stopped` after 5 mails in a row fail, so a run of failures burns **no** budget and delivers nothing; only the 3 tries per mail and the run stop limit apply. Right behaviour. Caveat seen by reading only: while a mail is in flight its row counts, so with several processes a slow relay temporarily lowers the room seen by others, and if the row delete itself failed (DB error, caught and ignored) the place would be burnt and the person marked as mailed. That is pre-existing.
4. **`TOPIC_MAIL_DAILY_MAX`: never means "no limit".** unset gives 2500, `0` gives 0, `-1` gives 2500, `abc`, `NaN`, `Infinity`, `1e400`, `10abc`, `null`, `false` all give 2500, `2.9` gives 2, `0x10` gives 16, a blank or `-0` gives 0 (L1), `1e9` and 1e20 pass through (L2). A bad value is never unlimited; a negative number gives the default, not zero.
5. **Fairness: holds.** 40 people, budget 12, five days (never mailed first, then oldest, then id). Everyone mailable got the mail within 4 days and the counts across the 5 days were 1 or 2 per person. The person with the switch off was never mailed and never used a place: every day sent exactly 12. A member who joined on day 2 was mailed on day 4: behind the older never-mailed people (tie-break is id, and new ids sort last), not starved, and the others lost nothing. If more than the budget join every day, older people would wait behind them.
6. **Other mail untouched: holds.** The budget only counts `template in (C01, C02)` and is only used by jobs that pass `budget`. With the budget spent, 50 B11 mails were all sent. 50 budget jobs (all refused) plus 50 B11 mails at once: all 50 B11 sent, all 50 budget jobs "budget"; 139 ms against 118 ms for 50 B11 alone. 50 budget jobs racing for 30 places: exactly 30 rows. No deadlock is possible by reading: the budget path takes one lock only and holds nothing else. The lock is `pg_advisory_xact_lock`, so it goes with the transaction. I proved it on a duplicate (P2002, second send gave "limited") and on a thrown error inside the transaction (send gave "failed"): `pg_locks` showed 0 advisory locks and 0 idle-in-transaction sessions afterwards, and the next send worked.
7. **Yesterday's question is never sent on a later day: holds.** After a run ended `budget-reached` with 5 sent, I aged the log a day and ran at 06:00, 08:00 and 10:59Z the next day: `nothing-open`, 0 sent. The same with the old question set LIVE and its end later than the next day's start: still `nothing-open`. Only today's question can be picked.
8. **`GET /admin/today`.** `api/src/admin/today.service.ts:230` adds `stats.topicMailBudgetLeftToday` as an additive integer. The builder's spec asserts 2500 - 6 and the admin specs `ops.spec.ts` and `overrides.spec.ts` pass (68 tests). No role or guard line is in the diff. `python3 docs/contract/src/build.py <tmp>` is byte-identical to `docs/contract/openapi.yaml` (checked with `cmp`). The existing `dailyQuestionMailsToday` counts the Lagos day and the new number counts the UTC day; each is right for what it is, but the two windows differ by an hour.
9. **Migration: not touched.** `git show 3cf715e --stat` lists no file under `api/prisma`, so `20261114100000_topic_mails` and its rollback are unchanged by this commit. I did not re-run them (earlier commits were checked already).
10. **Checks.** `npx tsc --noEmit`: clean. `test/mail` (without my spec): 6 suites, 75 tests, all pass (topic-mail.spec.ts 22 of them). Admin specs reading /admin/today (`ops`, `overrides`): 2 suites, 68 tests, pass. Full API suite (`npm test`): 99 suites, 1139 passed, 1 skipped, 1140 total, plus the audio node tests 13 of 13. No failures, so no comparison against origin/main was needed.

## Proved by runs
Items 1, 2 (including the midnight crossing), 3, 4, 5, 6 (race, mixed load, lock release on duplicate and on a thrown error), 7, 10, and the contract comparison in 8; M1 (spec "X"), M2 (spec "3b"), L3 (EXPLAIN on 400,000 rows).

## Read only
No deadlock is possible (one lock, nothing nested); roles on `/admin/today` unchanged (nothing in the diff); the migration is untouched (stat of the commit); the failing-row-delete burn in item 3; the in-flight row lowering the room seen by other processes; the 5 s interactive transaction timeout under heavy lock contention (only the topic runner uses the budget path, one send at a time per process, so the queue is at most the number of processes).

## Not proved
- Anything against the real relay, a real clock rollover at midnight, or the real 5,000-per-day behaviour of WAWU ID.
- The midnight crossing used a faked `Date` and rewrote `createdAt` to match, because the row time comes from the database default.
- The migration's rollback on an origin/main-shaped database with rows (not in this commit; not re-run).
- Behaviour with several real processes (one Node process with several service instances over one pool was used, which is the same locking in Postgres).

## Decisions taken without asking
- Verdict MERGE: both MEDIUM items are product or pre-existing behaviour and cannot occur at tonight's size; the owner should decide M1 before the user count passes 2,500.
- Fairness was judged on 40 people over 5 days; the order logic is the same at any size.
