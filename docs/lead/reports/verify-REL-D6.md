VERDICT: MERGE
INTERIM

# Check of v/rel-d6 (interim, first 30 minutes)

Branch checked: `origin/v/rel-d6` at 3cf738b. Nothing found yet that should stop it. A lot is NOT yet proven (listed below), so read this as "no problem found so far", not as a full pass.

## Findings so far
- HIGH: none found.
- MEDIUM: none found.
- LOW (not a product fault, a test fault): in `test/talk/rel-d2-lock-order.spec.ts`, when run at 200 rounds (`D2_ROUNDS=200`), the two "one lock at a time" tests ("a moderator's action takes the post before it waits for the item", "an editor's decision holds the post...") failed with "the action never started waiting". The same two tests pass alone and at the normal 20 rounds (10 of 10). I did not find the cause yet; it looks like the test's wait probe after 1,200 earlier rounds, not the product code. Will look again in the full report.

## What held
- The edit path is untouched: `git diff origin/main HEAD` on `api/src/units`, `api/src/talk/shared/units-access.ts` and `test/talk/fixb-r4-edit.spec.ts` is empty. The edit code in `posts.service.ts` is unchanged (the only change there is the reply paging).
- Lock order, six mixes on one post, 200 rounds each, own Postgres 16 (`log_lock_waits=on`, `deadlock_timeout=200ms`), real HTTP:
  - decide + remove: 500s 0, deadlocks 0, counts and books clean
  - decide + remove + edit: 0, 0, clean
  - decide + remove + report: 0, 0, clean
  - decide + purge: 0, 0, clean
  - remove + purge: 0, 0, clean
  - purge + remove + decide: 0, 0, clean
  - "deadlock detected" in the Postgres log: 0. Lock waits were logged (short), no deadlock.
  - I did not yet record whether the retry ever fired (see below).
- Gate: `npm ci`, `prisma generate`, `tsc --noEmit`: clean. eslint without `--fix`: 0 errors, 51 warnings (not yet compared with main).
- The branch's own six new/changed spec files plus `fixb-r4-edit.spec.ts`: 6 suites, 73 tests, all pass.
- Code read, no problem seen: the retry helper (`tx-retry.ts`) wraps only `decide`, `act`, `purge`; mail and file purges in `purge` now run after the commit and only once, outside the retried part. `purgeDue` catches per person and logs no id or name. No code path deletes an answer or reply row for real, so a cursor can never point at a row that is gone (it can only point at a REMOVED one).

## Not proven yet (running now)
- The whole `npm test` on a fresh database (started; still running).
- A: all pairs and triples of actions, the 5,000-likes purge, forced 40P01 retry, mail sent once.
- B: purge dump compare against main, `purgeDue` with a failing person.
- C: paging walks (1, 7, 20; NEW, TOP, DEBATED; filters), old main cursors, forged and oversized cursors, cursor size, nameless admin never in a cursor.
- D: not-public admins on Home, trending, category, answers, replies.
- E: the share picture byte for byte against main.
- F: record flow compared with main, 200 posts with the sweeper.
- G: what each new spec leaves behind.
