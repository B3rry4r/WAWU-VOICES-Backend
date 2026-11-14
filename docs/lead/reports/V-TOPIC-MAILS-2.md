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
