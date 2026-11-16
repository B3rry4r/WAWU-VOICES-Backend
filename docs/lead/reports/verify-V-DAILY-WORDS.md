VERDICT: MERGE
INTERIM

# Check of V-DAILY-WORDS (interim)

Tree checked: origin/v/daily-words at 519f3e2. `git merge-base origin/main origin/v/daily-words` = 5a00d54 (today's main, as expected). No newer commits on the branch yet.

## So far: no HIGH or MEDIUM finding. Still running: the full test suite, the way back, the route checks.

### Held
- Diff against origin/main: only `seed.ts` (+3), `topics.service.ts` (+3), the migration folder (2 files), 2 new specs, the builder's report. No existing test edited. Nothing of main lost in the two source files (the diff is only the added lines).
- Deploy order (infra/deploy/deploy.sh, `deploy_api`): `prisma migrate deploy` runs BEFORE the new app is switched in and restarted. The old app keeps serving during the build and migrate, and for a few seconds more until the restart. Main already enforces words on any question that has them, so the old app and the new app behave the same on a migrated row.
- Migration on a database built at origin/main (all migrations), calendar seeded, launch question seeded, plus my own rows. Rows that got words: the DAILY that opens in 5 minutes, DAILY DRAFT with no start, spare DAILY with no start, and the 1,025 future SCHEDULED calendar days. Rows left alone: launch question (12 answers with words), today's open question with 0 answers, an open DAILY with 3 answers, LIVE DAILY with no start, LIVE DAILY already started, SCHEDULED DAILY whose start has passed, SCHEDULED DAILY past its end, CLOSED DAILY with and without answers, a future DAILY whose only answer is removed, FLASH, FOLLOW_UP, OVERRIDE, and a DAILY with two words. Second run: "No pending migrations", and running the SQL by hand again changes 0 rows.
- Timing: 5,000 questions, 500,000 answers, 20 people posting answers in a loop to the open question the whole time. The migration took 23 to 41 ms. The slowest post during the run was 44 ms (4,492 posts, median 3 ms). No post blocked anywhere near 2 seconds.
- Lint: 0 errors, 27 warnings (run without `--fix`). Typecheck: clean.

### Not done yet
Full `npm test`, the way back, the release-moment routes (3a, 3b, 3c), item 5 routes, item 6 and 7. A final report will replace this one.
