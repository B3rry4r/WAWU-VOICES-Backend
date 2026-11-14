VERDICT: FIX

# Verify V-TOPIC-MAILS-2, second check (branch v/topic-mails-2, c40408d)

Verifier run, 14 Nov 2026. Own Postgres 16 (port 55470) and Redis (56470), both stopped at the end. No live provider was called, no .env or key file opened. My attack specs (`api/test/mail/zz-verify-r2.spec.ts`, `zz-verify-other.spec.ts`) are not committed. A throwaway worktree of origin/main was used for the "other mail" comparison and removed.

The H1 fix works as asked and the first check's HIGH is closed. But the new "10 refusals in a row" rule has a hole that is the first check's M2 in another form: **10 or more permanently bad addresses stop the run on those same people every tick, for ever, and nobody behind them is mailed.** It does not need an unlucky sort: after a restart (any deploy) on day 2, every refused address has no MailLog row, so they sort first. I call it HIGH (see N1). Everything else holds.

## The first check's findings

| First check | Status | Run |
|---|---|---|
| H1 wrong key (401/403) treated as refused addresses | **Closed** | 60 people, C01 and C02, 401, 403, 404 to everyone: 5 relay calls for 401/403, 10 for 404 (at most 10). State `stopped`, sent 0, nobody on the skip list, nothing in `finished` or `rescanAt`. 401/403 give 6 error lines (5 "relay refused our service key" plus the stop line); 404 gives 1 error line (the stop line). Next tick calls again (5 or 10 calls) and stops again. With the relay healthy again in the same process (no restart) the next tick: `done`, sent 60, 60 rows. All six combinations, identical. Same through `tick()` (the builder's spec; I read it and ran it). |
| M1 C02 held to half until noon although C01 is done | **Open, on purpose** (the lead's ruling). Not changed. | n/a |
| M2 refused person not asked again for the whole topic or question | **Closed for the one-address case; reopened as N1 for 10 or more** | One refusal: the run is not `finished`, `rescanAt` is set, the person is asked again after 24 h (the builder's spec; ran). With 10 or more bad addresses see N1. |
| L1 half is per UTC day, window per Lagos day | Open, left with a reason (only reachable with TOPIC_AT between 00:00 and 01:00 Lagos; default 06:30 not affected). Accepted. | read |
| L2 skip keyed by person, not address | **Closed** | skip key is `template\|userId\|address` (`topic-mail.service.ts:~449`); the builder's spec "L2" passes. Note N1 makes the skip list irrelevant when the run stops. |
| L3 skip list per instance, lost at restart | Open, left with a reason (needs a shared store). **Worse than the first check said, see N1**: after a restart the lost list is what lets the bad addresses sort first and stop the run. | E3b, E3c below |
| L4 408, 425 treated as refusals | **Closed** | `mail.service.ts:~503`: only 400, 404, 410, 422 are `refused`; 408 for everyone: `stopped` after 5 calls, nobody skipped (the builder's spec; ran). |
| L5 migration plain CREATE INDEX lock; rollback leaves the migrations row | Index build: open, left with a reason (1.1 s on 400,000 rows). **Rollback: closed** | Ran it: index and `_prisma_migrations` row both gone (DROP INDEX, DELETE 1); `prisma migrate deploy` rebuilds the index ("All migrations have been successfully applied", index count 1); rollback twice: second one `DROP INDEX` notice and `DELETE 0`, harmless; deploy again: index back. The MailLog row I put in before was still there. |
| L6 three specs lost 06:30 whole-budget coverage | Closed (not a fault) | see item 6 |

## New findings

### BLOCKER
None.

### HIGH

**N1. 10 or more addresses the relay refuses stop every run on those same people, every tick, for ever; the people behind them are never mailed.** `api/src/mail/topic-mail.service.ts:~495-505` (the `++refusals >= MAX_CONSECUTIVE_REFUSALS` branch returns `stopped` without `commitSkips()`), with the order from `due()` (`:~255`: never-mailed first, then by id) and `:~540` (a `stopped` run is not finished).
- Why it happens: a refused person never gets a MailLog row, so they are "never mailed" and always sort first. The stop does not put them on the skip list ("nobody is skipped on this stop"), so the next tick asks the same 10 again, and stops again. The count is not reset by anything but a send, and a send cannot happen because the 10 come first.
- What I did and saw (relay stand-in answers 422 or 400 for the bad addresses, 200 for the rest; budget 5000):
  1. **10 bad addresses sort first among 500 good ones, C02**: ticks 1 to 5 each `stopped`, sent 0, 10 calls each (the same 10 people), 5 error lines, 0 rows. The next Lagos day: `stopped`, sent 0, 0 rows. The 500 are never reached. **Same for C01**: 5 ticks, 5 x (stopped, 0 sent, 10 calls), 0 rows.
  2. **Day-two case, no unlucky sort needed** (300 people, 12 bad addresses scattered; relay as above). Day 1: C01 `done`, sent 288, 12 on the skip list. Day 2, new question, the same process: tick 1 `done`, sent 288 (the bad ones still on their 24 h skip); tick 2 onward `stopped`, 0 sent, 10 calls every tick. That case is only a waste: everyone good already has their mail. But the 10 calls and an error line go out **every minute**: C01 from 07:00 to 12:00 is about 300 ticks, about 3,000 relay calls and 300 error lines a day; C02 does it all day for the whole week, about 14,400 calls and 1,440 error lines a day.
  3. **Day-two case after a restart** (a deploy; memory empty, same 12 bad, 288 good due, budget fresh): tick 1 `stopped`, **sent 0**, 10 calls; ticks 2 to 5 the same; **0 rows on day 2, all 288 good people never mailed**, 5 error lines in 5 ticks. With a budget smaller than the audience the effect is the same.
  4. 100 people, 10 bad in a row in the middle (people 41 to 50): tick 1 sent 40 then `stopped` (50 calls); ticks 2 to 5 `stopped`, sent 0, 10 calls each: the last 50 are never reached.
- Should be: addresses refused by a relay that is otherwise delivering must not stop the run. At least: the stop should only be relay trouble when nothing at all has been sent in this run (case 4: 40 were sent, so the relay works), and should not keep the refused on top of the order. A fix that holds: on that stop, put the refused on a short skip (say one hour) so the next tick goes on to the next people, or order people with a recorded refusal last. A small probe (try the next 3 people after 10 refusals and only call it relay trouble if all are refused too) would also tell addresses from trouble. Whatever is chosen, the case "10 refused, then 500 good" must mail the 500.
- Is it likely tomorrow? On the first day the bad addresses are scattered by id and 10 in a row is unlikely unless many bad addresses were created in one burst. It is certain from day two after any restart, with 10 or more bad addresses of any kind, and every tick wasteful with the same 10 even with no restart. How many addresses the real relay refuses with 400, 404, 410 or 422 is not known to me.

### MEDIUM

**N2. A small audience (fewer than 10 people, all refused with 404) goes quiet for 24 hours.** `topic-mail.service.ts:~535-545`. 8 people, relay answers 404 to all: first run `done`, sent 0, 8 calls; `finished` empty, `rescanAt` set (24 h); the next tick `done` with 0 calls; with the relay answering 200 again in the same process the next tick: `done`, sent 0. The rule "never marked finished" is kept, but no tick asks again for 24 h. For 401/403 it is fine (fewer than 5 failures: tried every tick). Only a wrong base URL (404) with fewer than 10 eligible people. Not reachable with a real audience; reported because the rule as the lead wrote it says "the next tick tries again".

**N3. A person whose mail failed with a 5xx while others were sent is not asked again** (the builder said this). `topic-mail.service.ts:~538`: `sent > 0` with a failed person means the run is `finished`. 4 failures (503) among 56 sent: `done`, 4 left out until the next event. Same as round 1 and main. Left as a rule choice; named.

### LOW

**N4.** 401/403 error lines: one per failed mail (up to 5) plus the stop line, every tick, so a wrong key gives 6 error lines a minute for every template. Noise only.

## Edges asked for in item 2

- **9 refusals, a success, 9 more** (18 bad, 60 people): `done`, sent 42, 0 errors, 18 skipped. Run goes on.
- **10 bad sorting first among 500 good**: N1, shown over five ticks and a next day.
- **Refusals mixed with 503s**: 6 refusals and 4 503s with no send between, then good people: `done`, sent 50, 68 calls (a 503 is tried 3 times), 0 errors (4 failures stay under 5, 6 refusals under 10). 5 x 503 and 10 x 422: `stopped`, 15 calls (5 failures x 3), 0 skipped.
- **429 in the middle** (5 refusals, then a 429 on the 9th person): `capped`, sent 3, 9 calls; the 5 refused are put on the skip list (the cap commits skips); the next tick the same day `capped`, 0 calls; the next Lagos day `done`, sent 52 (rows 55).
- **Fewer than 10 people, all 404**: N2.

## Item 3, nothing regressed

- **Half rule at the edges**, budgets 0, 1, 2, 3, 12 at 06:29, 06:30, 11:59, 12:00 Lagos (C02 first, then C01): C02 `not-yet` at 06:29; before noon C02 never above floor(b/2) (b=0:0, 1:0, 2:1, 3:1, 12:6); C01 takes what is left (b=3: C02 1, C01 2; b=12: 6 and 6; b=2 at 06:29 C01 sent 2); at 12:00 C02 takes the whole budget (0, 1, 2, 3, 12); total never above the budget. b=0: nothing.
- **max clamp**: unset, blank, spaces give 2500/1250; 0 gives 0/0; 2.9 gives 2/1; 2501 gives 2501/1250; 5000, 5001, 6000 give 5000/2500; -3 and "abc" fall back to 2500/1250.
- **2 and 5 instances** (each running C01 and C02 at once, budgets 12 and 13): 2 instances: C02 6, C01 6, total 12, no person twice, 12 deliveries. 5 instances: C02 6, C01 7, total 13, no duplicates, 13 deliveries.
- **Fairness**, 60 people, budget 12, 7 days: each day C02 6 and C01 6, 84 rows, 84 different (person, template, event) keys: nobody got the same mail twice; 42 different people got C02; 36 different people got C01 (84 mails to 60 people, so repeats of C01 happen on different days, as expected with the common order).
- **Yesterday's question** (scheduled 20 Nov, still open): at 07:00 and 11:59 Lagos on the 23rd: `nothing-open`, no calls.
- **Refusal of one address among good ones**: the builder's spec and mine: 5 bad among 30, all good mailed, 0 errors.
- **The index and its migration**: not changed since the first check except the rollback (L5, run above); `prisma migrate deploy` from nothing applied all migrations, index present.

## Item 4, other mail

B11 (`MailService.send`, no budget) and A10 (`sendNotice`) against a relay answering, in turn: 401, 403, 422, 404, 400, 503, 429, 200. On the branch and on origin/main the outcomes are identical: 401, 403, 422, 404, 400, 503: `failed` (1 call each, 3 calls for 503); 429: B11 `capped`, A10 `failed`; 200: `sent`. Never `refused`. No MailLog row kept for a failed one. The topic budget stays 2500 (not counted). Sign-in codes are sent by WAWU ID, not in this code (read only).

## Item 6, specs the builder changed

None of the existing assertions was changed. `git diff a6b4966..c40408d` over `api/test/mail`: `topic-mail.spec.ts` and `topic-mail-budget2.spec.ts` are unchanged since the first check; `mail.spec.ts` has 4 added lines (V-46 free-post allowance, from the merge of main, not the builder); the new `topic-mail-relay-trouble.spec.ts` (17 tests) I read: it covers the six H1 cases, 9/10 refusals, reset by a send, 408, M2 and L2. **It has no case where 10 refused people sit in front of good people who are not yet mailed on a second tick, which is where N1 is** (its "10 refused in a row" case ends by clearing the refusals and so passes).

## Checks (item 7)

- `npx tsc --noEmit`: clean.
- `test/mail`, without my attack specs, 5 times: 5 of 5 passed, 8 suites, 120 tests each, 0 failures.
- Specs that read `/admin/today` (`admin/ops`, `admin/overrides`, plus `mail/topic-mail` in the folder run): `admin/ops` and `admin/overrides`: 2 suites, 68 tests, passed.
- Full API suite (`jest --runInBand`, my attack specs excluded): 105 suites passed of 105; 1258 passed, 1 skipped, 1259 total; audio node tests 13 of 13. No failures, so no comparison with origin/main was needed.

## Proved by runs

H1 closed (six runs); N1 (five runs: 10 bad first, C01 and C02; day 2 same process; day 2 after restart; 10 in the middle); N2; the edges in item 2; the half rule, clamp, two and five instances, fairness, yesterday's question; other mail on the branch and on main; the rollback of the migration and the rebuild; all counts above.

## Read only

The builder's new spec (read, and passes), `mail.service.ts` and `topic-mail.service.ts` as a whole, that sign-in codes are outside this code, the L1 and L5 index reasons.

## Not proved

A real relay: which statuses it gives for a bad address, whether refused or repeated 401 calls count against the 5,000 a day, how many bad addresses the live list has. Several real processes (one Node process with several service instances over one pool was used, and a "restart" was clearing the in-memory maps). Real clock rollover (time was passed in). A real tick timer (the tick was called by hand; the numbers of calls per day in N1 are tick counts times 10, not measured over a day).
