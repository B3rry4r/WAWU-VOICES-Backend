VERDICT: FIX

# Verify V-TOPIC-MAILS-2 (branch v/topic-mails-2, a6b4966)

Verifier run, 14 Nov 2026. One HIGH (the lead's 401/403 ruling, with the run you asked for), two MEDIUM, six LOW. Everything else in the five items holds, including the half rule at all edges, concurrency, fairness, the migration and the clean counts. No live provider was called, no .env or key file opened. Own Postgres 16 (port 55450) and Redis (56450), stopped at the end. My attack specs (`zz-verify-mails2.spec.ts`, `zz-verify-timeout.spec.ts`, a main-comparison spec and a 404 spec) were not committed.

## Findings

### BLOCKER
None.

### HIGH

**H1. A wrong service key (401/403) is treated as a refused address: the run "finishes" silently and nothing is retried until a restart.** `api/src/mail/mail.service.ts:~493-497` (every 4xx but 429 returns `refused`), `api/src/mail/topic-mail.service.ts:~453-461` (refused: skip, not counted) and `:~474` (`finished.add` after the loop). The builder said this in their report; the lead ruling says it must be an outage.
- What I did: relay fake answers 401 (then 403) to everyone. 60 active people, budget 100, C02 at 12:00 Lagos. Then a second tick, then the key "fixed" in the same process, then a restart (memory cleared). Same on `origin/main` for comparison. Also C01 with 401, and 404 for everyone (a wrong base URL looks the same).
- What happened on the branch (401, 403 identical; 404 identical):
  - Relay calls in the first run: **60 (one per person, no retry)**. With 2,500 people that is 2,500 calls per template per run, about 8 minutes at 5 a second, per template.
  - State: `done`, sent 0. MailLog rows 0, budget untouched (100 left).
  - Log: **120 warn lines** (`relay answered 401` and `relay refused one address, skipped for 24 hours` for each person), **0 error lines**. Nothing at error level says the key is wrong.
  - Second tick one minute later: `done`, 0 calls. The run is in `finished`, so C02 is not tried again for the topic's whole week, and C01 not again for that question's day. With the key fixed in the same process: still `done`, 0 calls. Only a restart (memory cleared) mailed all 60. A key fixed on the relay side with no Voices restart leaves the week's topic mail unsent.
  - C01 with 401: same (`done`, 60 calls, 0 rows, then `done` on later ticks).
- What `origin/main` does with the same wrong key: 5 calls, state `stopped`, error line "5 mails in a row failed, run stopped", the next tick tries again (5 more calls), and once the key is right in the same process the next tick mailed all 60.
- Should be: 401 and 403 count toward the five-in-a-row stop (or stop the run at once) as `failed`, logged at error, so the run ends `stopped`, is retried each tick and recovers without a restart. Keep 400, 404, 410, 422 and the like as refusals. Consider also that a run in which almost everyone is refused is a sign of a relay problem, not 60 bad addresses (404 for everyone behaves the same way).

### MEDIUM

**M1. C02 stays held to half until noon even when C01 has nothing left to send.** `topic-mail.service.ts:~405-410` and `:~182`. Matches rule 1 as written; reported because you asked whether it is wasteful.
- What I did: budget 12; only 2 people take the daily question mail; C01 at 07:00 Lagos sent 2 and was `done`. C02 at 07:30 sent 6, at 10:00 sent 0 (`budget-reached`).
- Result: 4 of 12 places idle from 07:30 to 12:00 (the budget is not lost, the C02 people are only mailed later, at 12:00 Lagos 4 more went). Same when C01's window is empty by config (`DAILY_AT=DAILY_UNTIL=12:00`: C02 6 until noon, 6 after) and on a day with no question (6 until noon, then 6; extra ticks cost 0 relay calls).
- Should be: the owner's call. Cheap fix: lift the hold once C01 for today is `done` (needs a shared fact, such as a C01 row count versus audience, not process memory). Fine to ship as is.

**M2. A person who is refused is not tried again for the rest of the topic or question, not only 24 hours.** `topic-mail.service.ts:~474`. Any run that gets to the end of the list adds the event to `finished`, so the 24 h skip only matters for runs that stop early (budget reached) and a person refused once is not asked again that process lifetime (until a restart). Same as main's behaviour for failed mails, but the rule says 24 hours. With `finished` cleared by hand the 24 h edge is exact (refusal at 12:00 Lagos: 0 calls at +23h59, 1 call at +24h01).

### LOW

**L1. Half is per UTC day, the window is per Lagos day.** A Lagos morning (00:00 to 12:00) spans two UTC days. With `TOPIC_MAIL_TOPIC_AT=00:00` I ran C02 at 23:30Z (00:30 Lagos): 6 sent; the next UTC day at 00:10Z another 6: 12 C02 mails before the window closes. Not reachable with default 06:30. A run still going across 23:00Z (Lagos midnight) is held to half again, harmless.
**L2.** The skip is keyed by person, not address. An address fixed during the 24 h is not tried until it ends (run: new address never asked).
**L3.** Each instance has its own skip list. With 50 bad addresses and budget 3: first run 50 refused calls, same instance 24 h less a minute later 0, a second instance 50, after a restart 50, after 24 h 50. So extra calls a day are about 50 per template per additional instance, plus 50 per restart (C01 and C02 count separately: a refusal on C01 does not skip C02, proved). Small against 5,000; refused calls cost no budget place.
**L4.** Every 4xx but 429 is a refusal, including 408 (request timeout) and 425, which are not about the address. As asked, noted only.
**L5.** Migration `20261114210000`: plain `CREATE INDEX` takes a write lock while it builds. On 400,001 rows (11 MB index) `prisma migrate deploy` took 1.1 s in all; a writer inserting every 5 ms saw 1 insert wait 206 ms, none other over 50 ms. It scales with table size. `rollback.down.sql` drops the index but leaves the `_prisma_migrations` row, so a later `migrate deploy` will not re-create it (some earlier rollbacks delete that row; this one, like topic_mails, does not).
**L6.** The three changed existing specs lost their 06:30-Lagos whole-budget coverage (moved to 12:00 Lagos); the new spec covers 06:30 and 12:00 separately. See item 7.

## Per-item results

1. **Half rule edges: holds.** Budgets 0, 1, 2, 3 at 06:29, 06:30, 11:59, 12:00 Lagos with C01 right after: C02 sends nothing at 06:29 (`not-yet`); before noon C02 never above floor(b/2) (0, 0, 1, 1); at 12:00 C02 takes all (0, 1, 2, 3); total never above b. C01 at 11:59 takes what is left (b=3: C02 1, C01 2). b=0: nothing, `budget-reached`. 2501 gives max 2501 and half 1250; 5000, 5001, 6000 give 5000/2500; blank and spaces 2500/1250; 0 gives 0; 2.9 gives 2/1. `UNTIL=09:00`: 07:59Z held (6), 08:00Z the rest. `UNTIL=06:00` (before TOPIC_AT): whole budget at once. Garbage `UNTIL=25:00`: falls back to 12:00. `TOPIC_MAIL_ENABLED=false`: both `off`, 0 calls (there is no C01-only switch; an empty window is M1). Lagos/UTC: L1. No question and early C01: M1.
2. **Concurrency: holds.** 2 and 5 service instances, each running C01 and C02 at once, budgets 12 and 13: C02 6, C01 6 or 7, total equals the budget, no person twice for a template, rows equal relay deliveries. 5 instances C02 only, budget 13: 6 rows, 6 deliveries. Two instances crossing 12:00 Lagos mid-run: 12 rows, 12 deliveries.
3. **Refusals.** 400, 404, 410, 422 on the first 7 people: 60 calls, 53 sent, `done`, no row for the refused, budget 47 left (7 refusals did not trip the stop). 401/403: H1. 429: `capped` after 1 call, 0 rows. 500, 502, 503 and a reset socket for everyone: `stopped`, 15 calls (5 people x 3 tries), 0 rows. A relay that never answers: `stopped`, 15 calls, 150 s, 0 rows (3 x 10 s timeouts per person, so 30 s per person). Mix 422, 503 alternating: `stopped`, 20 calls (stops on the 5th 503). 4 failures then 30 refusals then 1 failure: `stopped` (refusals do not reset the count). 4 failures and a success in turn: never stops, 36 sent. Skip list and 24 h: L3, M2. A refused person never got a row or a budget place and is not marked mailed (rows 0; budget left unchanged).
4. **Fairness: holds.** 60 people, budget 12, 7 days, topic all week and a question each day: each day C02 6 and C01 6, 42 different people got C02, 42 got C01, nobody got the same one twice. Yesterday's question (scheduled yesterday, end set to day after tomorrow): `nothing-open` at 07:00 and 11:59, 0 relay calls.
5. **Other mail: unchanged.** Relay 422 for B11 (account-style mail) and the A10 deletion notice: both `failed` on the branch and on `origin/main`; 0 rows kept; B11 with budget 0 is still `sent`. (Sign-in codes are sent by WAWU ID; not in this code.)
6. **Migration.** A database migrated from `origin/main` (all migrations), 400,000 MailLog rows plus 1,585 inserted during the build: applies in 1.1 s; write wait: L5. Rollback: index gone, 401,585 rows kept; rollback twice: harmless notice; apply again: works; running `migration.sql` by hand twice: `already exists` error (prisma itself does not re-run it: "No pending migrations"). EXPLAIN ANALYZE on the budget count (`template in (C01,C02)` since UTC day start): before the index a parallel sequential scan, 21 ms; after, Bitmap Index Scan on `MailLog_template_createdAt_idx`, 1.07 ms; the C02-only count 0.67 ms.
7. **The three changed specs** (`test/mail/topic-mail.spec.ts`, "daily budget"): the diff is 5 lines, only `at("05:30")` became `at("11:00")` (1 line in the first, 2 each in the others). No assertion changed. "ends the run as budget-reached with exactly N sent": still true (12:00 Lagos, window closed). "two processes together cannot go past it": still true. "the next day's C02 run picks up the people who were skipped": still true; its middle step `at("08:00")` expecting `budget-reached` passes because the whole budget is spent, not because of the half rule. What they no longer test is C02 taking the whole budget at 06:30; the new spec checks 06:30 gives half.
8. **Checks.** `npx tsc --noEmit`: clean. `test/mail` (7 suites, 103 tests) run 5 times: **5 of 5 passed (103/103 each), mail-round2 B12 never failed**. I cannot say why it failed once for the builder; with one runner and its own database it did not reproduce in 5 runs (0 of 5). Specs reading `/admin/today` (`admin/ops`, `admin/overrides`, `mail/topic-mail`): 3 suites, 90 tests, pass. Full API suite (`npm test`): 101 suites, 1172 passed, 1 skipped, 1173 total, audio node tests 13 of 13. (A first full run failed 43 suites because my own Postgres lost read access to its data directory mid-run; "Can't reach database server". I rebuilt the database elsewhere and ran again: clean. The branch was not the cause.)

## Proved by runs
Items 1 to 5, 8 above; H1 (wrong key: 60 calls, `done`, 120 warns, 0 errors, no recovery until restart; main: 5 calls, `stopped`, recovers); M1, M2, L1, L2, L3; the migration times, rollback and EXPLAIN; the three spec diffs (read) and that they pass; 150 s timeout run.

## Read only
That sign-in codes are not sent through this code (not in `api/src/mail`); L4 (408/425 treated as refusals, read from `mail.service.ts`); that the C01 early-finish fix needs shared state (read).

## Not proved
A real relay, its handling of repeated 401 calls (whether they count against the 5,000 a day), real clock rollover, several real processes (one Node process with several service instances over one pool was used), a migration on a larger table than 400,000 rows (the write wait scales).
