# V-TOPIC-MAILS-2

Branch `v/topic-mails-2` from `origin/main`. Fixes the five findings in `verify-V-TOPIC-MAILS-budget.md`. No live provider was called; no .env or key file opened. Own Postgres 16 (port 55440) and Redis (56440), both stopped at the end.

## Items

**M1 C02 must not starve C01.** `api/src/mail/topic-mail.service.ts`: `c02HalfMax()`, `c01WindowClosed()`, `usedBy()`, the pre-check and the `ownMax` in `sendAll`. `api/src/mail/mail.service.ts`: `MailJob.budget.ownMax` and the extra count in `reserve`, done in the same advisory-lock transaction as the whole-budget count, so two instances cannot pass either limit. Before `TOPIC_MAIL_DAILY_UNTIL` (Lagos) C02 may hold at most `floor(max/2)` rows in the UTC day; C01 only checks the whole budget; from the closing minute C02 checks the whole budget. The window is checked for every mail with the run's own clock, so a run that crosses 12:00 Lagos gets the rest. A C02 tick that finds its half used returns `budget-reached` before scanning the audience (no per-minute rescan, no relay call).

**M2 refused address.** `mail.service.ts`: relay answers 4xx other than 429 give a new internal result `refused` (not retried); `send` returns the new `MailOutcome` `"refused"` only for jobs with a `budget` (the topic mails). Every other mail still gets `"failed"`, unchanged. The log row is still deleted, so the budget is used only by real sends. `topic-mail.service.ts`: on `refused` the person goes into `refusedUntil` (key `template|userId`, now + `REFUSED_SKIP_MS` = 24 h), is skipped, is not counted toward the five-in-a-row stop (the counter is neither added to nor reset), the pace pause still runs, and the run carries on. 5xx, network error and timeout still count; 429 still ends the run as `capped`.

**L1** blank, spaces, unset: 2500; explicit 0: 0. `dailyMax()`.
**L2** clamp to `TOPIC_MAIL_MAX_CEILING` = 5000. `dailyMax()`.
**L3** `api/prisma/migrations/20261114210000_mail_log_template_created/{migration.sql,rollback.down.sql}` and `@@index([template, createdAt])` in `schema.prisma`.

## Specs added
`api/test/mail/topic-mail-budget2.spec.ts` (31 tests): M1 (budget 12 and 40 people: C02 6 then C01 6; C02 held to half on every tick with no question, then the rest at 12:00 Lagos; after C01 took its share C02 gets 0; C01 may use the whole budget; floor of 5 is 2; 11:59 and 12:00 edge; two instances at once, and C01 and C02 racing, never pass 6 for C02 or 12 in all); M2 (first 5 refused 422, 35 others mailed in the same run, rows and budget equal real sends, refused asked once; not asked again inside 24 h, asked again after 24 h; the skip is per template; five 503s still stop with 0 rows; a refusal between 503s is not counted; 429 still capped; B11 is still `failed` on a 422, and a B11 mail goes and is not counted with budget 0); L1/L2 table (11 values, unset, a blank value really sends); L3 (index exists).

## Existing specs changed (all in `test/mail/topic-mail.spec.ts`, "daily budget")
The new rule limits C02 to half before 12:00 Lagos, so these three, which expected C02 to take the whole budget at 06:30 Lagos, now start C02 at 11:00Z (12:00 Lagos, window closed). Only the clock argument changed; no assertion text changed.
1. "ends the run as budget-reached with exactly N sent...": `runWeeklyTopic(at("05:30"))` is now `at("11:00")`. Old: C02 at 06:30 Lagos sends 4 of 4. New: same assertions, run after the window. (At 06:30 it now sends 2.)
2. "two processes together cannot go past it": both runs `at("05:30")` to `at("11:00")`.
3. "the next day's C02 run picks up the people who were skipped": first and next-day runs `at("05:30")` to `at("11:00")`.

## Runs
- Migration: a database migrated from `origin/main` (16 migrations) had 50 MailLog rows; mine applied; rollback run (index gone, 50 rows kept); applied again (50 rows). `prisma migrate diff` shows one unrelated difference already on main (`VoiceClip` index name); nothing from this change.
- EXPLAIN ANALYZE, 400,000 MailLog rows, count for C01 and C02 since the UTC day start: `Bitmap Index Scan on "MailLog_template_createdAt_idx"`, 2.9 ms (verifier saw a sequential scan at 25 ms). C02 alone: 0.07 ms.
- `npx tsc --noEmit`: clean. eslint on `src/mail` and `test/mail`: 0 errors (2 old unused-disable warnings in `mail-round2.spec.ts`, not mine).
- `test/mail` plus `test/admin/ops.spec.ts` and `overrides.spec.ts` (the specs that read `/admin/today`): 9 suites, 171 tests, all pass.
- Full API suite (`npm test`): 101 suites, 1172 passed, 1 skipped, 1173 total; audio node tests 13 of 13.
- One run of `test/mail` early on showed `mail-round2` B12 "the authors, not the moderator, hear once per group" failing once; alone it passed (17 of 17), and it passed in the two later runs including the full suite. I did not find the cause (it does not touch topic mail); treat as a flake.
- The contract is unchanged (no route or response field changed), so it was not regenerated.

## Choices
- The skip list is in the process's memory only: a restart forgets it, and each server has its own.
- Every 4xx other than 429 is a refusal, as the rule says, including 401 and 403. A wrong service key would therefore skip each person once (one try each, no budget used) instead of stopping after five. Say if 401/403 should count as an outage.
- "Half" is `floor(max/2)` of the clamped value, counted as C02 rows in the UTC day.
- The 24 hours run on the run's own clock (`now` plus elapsed), so specs can start a run anywhere.
- Sign-in and account mails: nothing in their path changed (`ownMax` and `refused` need `job.budget`, set only by the topic runner); the B11 spec shows that.

## Not done
Nothing from the five items. Not proved: a real relay, or several real processes.

## Round 2 (after the checker's FIX)

Merged `origin/main` first (clean, no contract conflict, nothing regenerated).

### H1: a wrong key or wrong relay address is an outage
- `api/src/mail/mail.service.ts:~495-510` (`postJson`): 401 and 403 now give a new internal result `key-refused`, which `send` turns into `failed` (`:~291`, with an **error** line "the relay refused our service key (401/403)", only for the budgeted topic mails). Only 400, 404, 410 and 422 are `refused`. Every other 4xx (408, 425, ...) is `failed`, not retried as before. That also closes L4.
- `api/src/mail/topic-mail.service.ts:39,~428-532` (`sendAll`):
  - failures (now including 401/403) count toward the five-in-a-row stop as before: `stopped`, error line, next tick tries again.
  - `MAX_CONSECUTIVE_REFUSALS = 10`: 10 refusals with no sent mail between them end the run `stopped` with an error line. The people refused in that run are held in a run-local list and only put on the 24 hour skip list when the run ends some other way (done, budget, cap, five failures); on this stop nobody is skipped. A sent mail resets the count.
  - A run is marked finished only when nobody was left out for refusal and not (nothing sent and someone failed). A `stopped` run is never marked.
- Specs added, `api/test/mail/topic-mail-relay-trouble.spec.ts` (new, 17 tests): C01 and C02 each with 401, 403, 404 to everyone: at most 10 relay calls (in practice 5 for 401/403, 10 for 404), `stopped`, error line (the "service key" line for 401/403), nobody on the skip list, nothing finished, the next tick calls again, and with the relay healthy in the same process everyone (30) is mailed; the same through `tick()`; 408 is trouble, not a refusal; 9 refusals in a row then mail still goes on; 10 in a row stop and nobody is skipped, the next tick asks them again; a sent mail between refusals resets the count; round 1's case (5 bad among good); M2, L2, "all failed with fewer than 5 due is not finished"; "mailed everyone is finished (0 calls next tick)"; B11 with 401 is `failed`, no key line, never `refused`.

### Medium
- **M1 (C02 held to half until noon even when C01 is done): left as it is**, as instructed. Not changed.
- **M2 (a refused person not tried again, not even after 24 hours):** fixed. `topic-mail.service.ts:~399` (`isFinished`) and `:~528-532`: a run that leaves someone out for refusal is not `finished`; it records the time the first skip ends (`rescanAt`) and the next ticks do nothing until then, then the list is gone through again. Spec: "M2: a refused person is asked again after 24 hours without clearing anything, and not before".

### Low
- **L1 (half per UTC day, window per Lagos day):** not changed. Only reachable with TOPIC_MAIL_TOPIC_AT set between 00:00 and 01:00 Lagos; default 06:30 is not affected. A real fix needs a Lagos-day budget, not a small change.
- **L2 (skip keyed by person, not address):** fixed. The skip key is `template|userId|address` (`:449`; `due()` now returns the address). Spec "L2: ... a corrected address is tried at once".
- **L3 (skip list per instance and lost on restart):** not changed; the fix is a table or a shared store, not small. Extra cost stays about 50 refused calls per template per instance or restart.
- **L4 (408, 425 treated as refusals):** fixed by the H1 rule (only 400, 404, 410, 422). Spec "other 4xx (408, 425) are trouble of the relay".
- **L5 (migration index lock, rollback leaves the migrations row):** the index build is left as it is (plain `CREATE INDEX`, 1.1 s on 400,000 rows, and `CONCURRENTLY` is untested under prisma's runner). The rollback now also deletes the `_prisma_migrations` row so a later `migrate deploy` rebuilds the index (`rollback.down.sql`). The rollback was not run here.
- **L6 (three specs lost 06:30 whole-budget coverage):** nothing to change; the split is covered by the M1 specs in `topic-mail-budget2.spec.ts`. Not a fault.

### Specs changed
None. No existing assertion was edited; the round 1 specs all pass unchanged (the 24-hour spec still passes: it clears `finished`, and `rescanAt` is consistent with the same timings).

### Runs (own Postgres 16 on 55460, Redis on 56460, both stopped afterwards)
- `npx tsc --noEmit`: clean.
- eslint on `mail.service.ts`, `topic-mail.service.ts`, the new spec: 0 errors, 0 warnings.
- `test/mail` three times: 8 suites, 120 tests, passed 3 of 3 (120/120 each).
- `admin/ops` and `admin/overrides` (read `/admin/today`): 2 suites, 68 tests, pass (`topic-mail.spec` is in `test/mail`).
- Full API suite (`npm test`): 105 suites passed of 105; 1258 passed, 1 skipped, 1259 total; audio node tests 13 of 13.

### Choices and not done
- 401/403 error line appears once per failed mail (at most 5 per run) plus the run-stopped line.
- A person who fails for a reason other than a refusal (5xx) and whose mail did not go is retried every tick only when nothing at all was sent in the run; otherwise the run is finished as in round 1.
- Not proved: a real relay, whether repeated 401 calls count against the relay's daily allowance, several real processes.
