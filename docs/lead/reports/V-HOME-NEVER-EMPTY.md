# V-HOME-NEVER-EMPTY (rule H), prepared, not released

Branch `v/home-never-empty` from origin/main b727150 (plus later commits on main). Code pushed first, this report second. No PR.

## What changed
- `api/src/feed/feed.service.ts`: new private `homeTrending()` (just above `home()`); `home()` now calls it for `trending`. It reads only the ranking window: (1) `adminBlock()` over the whole window, cap `HOME_ADMIN_FIRST_CAP` (3); (2) today's open question's top 2 with `answerWhere(viewer, now)`, minus the admin posts; (3) if fewer than 2, one more read of the other questions in the window, same order as `/feed/trending` (rankScore, createdAt, id). Empty window gives `[]`. Same output shape.
- `docs/contract/src/schemas.py` (Home description) and `docs/contract/openapi.yaml` (regenerated with `build.py`): the words "only today's question" are replaced. No shape change.
- New `api/test/feed/home-never-empty.spec.ts` (9 tests). `/feed/trending`, `questionAnswers`, `listReplies`, category top voices and search are untouched.

## Database reads (guest, home())
Counted at the pg driver, with today having 2 voices (1 admin) and one other question. Prisma counts its includes as reads, so the numbers are raw.
- Before: about 54. After: 60. The trending part went from 16 to 22 raw reads (one extra admin read over the window and, when today has fewer than 2 ranked voices, one fill read). When today has 2 ranked voices there is no fill read. The "before" figure is the old trending reads measured alone, swapped into the new total; I did not run the old build for the whole of `home()`.

## Runs
- `npx tsc --noEmit`: clean. `eslint` on the two touched files: clean.
- New spec, 3 times in a row on the same database: 9/9 each time.
- `src/feed` + `test/feed`: 8 suites, 83 tests, 5 failed (all in `admin-first-home.spec.ts`, listed below). `prelaunch.spec.ts` and `feed.spec.ts` all pass; none of the lines you named fails.
- Whole suite (1 run): 178 suites, 2916 tests: 2904 passed, 1 skipped, 11 failed.
  - 8 in `test/feed/admin-first-home.spec.ts` (below).
  - `test/launch/contract-source.spec.ts` "regenerates openapi.yaml byte for byte": my first hand edit of the yaml did not match the generator. Fixed by regenerating; passes now (not re-run in the whole suite).
  - `test/shared/shared2.spec.ts` "item 8 table: every signed-in write route...": failed in the whole run, passes alone (with contract-source) after the regeneration. I did not prove the cause; I did not run it on origin/main.
  - I did not run the whole suite on origin/main, so I cannot say which of these also fail there. The admin-first-home failures are caused by rule H (see below).

## Existing tests that fail (not edited)
All in `api/test/feed/admin-first-home.spec.ts`. All fail only because they pin "only today's question": the spec has an admin post `AO` on a second open question (created at line ~122, posted at ~167) and rule H lifts it.
- line 164 "an admin post on another question is not on Home; a removed admin is not lifted": expects `[A1,R1,AN]`; rule H returns `[AO,A1,R1]` (AO newest admin post in the window). Pins the old rule directly.
- line 173 "five admin posts: the 3 newest, then 2 ranked": expects `[A5,A4,A3,R1,AN]`; rule H returns `[AO,A5,A4,R1,AN]` (AO is newer than A3).
- line ~262 "an admin whose account is not public is not lifted" (BANNED, DELETED, DELETION_PENDING cases): same expected list `[A5,A4,A3,R1,AN]`, same extra AO.
- Only in the whole-suite run: line 143 "no admin post", 147 "one admin post", 152 "top ranked one is shown once", 225 "category top voices". A named admin post of another spec, on a question still open in the window, was lifted (an `<uuid>` first in the list). That row was gone when I looked. This is a leftover from an earlier spec in the whole run, so under rule H these tests depend on no other spec leaving a readable admin post. Not caused by my new spec (it sets its own questions to DRAFT in `afterAll`). Category top voices (225) also failed there; that route is unchanged by my code, so it is the same leftover.
Owner's choice: update these expectations to rule H (AO lifted), or keep the old rule for them.

## New spec and cleanup
Covers the three examples, blocked author, anonymous admin post, non-public admin (BANNED), no repeats, window edge (closed longer ago than `ranking.window_days` gives `[]`, a day ago comes back), guest and signed-in, nothing open gives `[]`. Because rule H reads every open question, the spec sets other rows' open questions to DRAFT and clears their `scheduledFor` while it runs, and puts both back in `afterAll`; its own questions end as DRAFT and its topic is deleted.

## Could not prove
- Whole-suite results on origin/main (not run).
- The cause of the shared2 failure and the leftover admin post in the whole run.
- The query counts are raw driver reads from one local scenario, not live numbers.

---

# Round 2: Home must not be slower (checker MEDIUM 1)

Code: `cd38827` (and `f6ae4f0`), merged with origin/main 5a00d54 (merge commit, no rebase). Same answers as round 1.

## What changed (`api/src/feed/feed.service.ts`, `homeTrending()`)
- Admin block for Home: now read by author (`authorId IN current admins`, named, readable, public account, question in window, newest first, `take 3`). `adminBlock()` itself is untouched, so `/feed/trending` and the category page are byte-identical.
- Fill: one read of the window's questions (id, status, dates), kept only if `isQuestionReadable`; then ONE raw SQL read with a lateral probe per question (top `need` by rankScore, createdAt, id from `Answer_questionId_status_rankScore_idx`, id/score/date only; same rules as `answerWhere`: published, not deleted, blocks via `answerNotBlockedSql`), best `need` of those in `/feed/trending` order. Full rows (`answerInclude`) are loaded only for the 1 or 2 winners.
- Skips kept: no fill when today's question fills both places; no admin read when there is no admin.
- More than 40 questions in the window: no cap needed. It is still one read (one index probe per question); the spec runs 2 worlds with 45 open questions. A first version looped 19 separate reads per request and was still slow with no voices (SQL under 1.5 ms each, the cost was the number of reads), which is why it is one read.

## Timing (200 requests each, real route, new app per cell, 20 questions, 45,000 readable answers, 300 authors, 1 admin with 6 posts, window 7 days; p95 in ms, p50 in brackets)
Same machine and same database for both. Two runs each.

| State | Who | origin/main run 1 | run 2 | rule H (round 2) run 1 | run 2 |
|---|---|---|---|---|---|
| today 2,250 voices | guest | 37.7 (29.8) | 39.4 (31.1) | 36.9 (29.1) | 41.7 (30.1) |
| today 2,250 voices | signed in | 54.7 (38.2) | 38.3 (31.7) | 40.3 (33.0) | 44.0 (34.2) |
| today 0 voices | guest | 33.0 (25.0) | 29.7 (24.1) | 38.7 (30.7) | 41.2 (33.0) |
| today 0 voices | signed in | 36.5 (28.4) | 36.3 (28.5) | 44.8 (35.2) | 42.1 (35.5) |

Before this round (round 1 code, one run): 38.6 / 40.3 / 50.0 / 65.3 for the same four cells.
Target "p95 within 10 ms of main": met in all four cells in run 1 (largest gap 8.3). In run 2, no-voices guest is 11.5 ms over (41.2 against 29.7); the two-run averages are 8.6 over. This is the cell I could not get cleanly inside 10 ms in every run; the machine is noisy (main's own signed in with-voices p95 moved 54.7 to 38.3 between runs). Typical cost is 4 more reads when today has no voices (admin read, window question read, fill read, loading winners).

## Plans (EXPLAIN ANALYZE through auto_explain, no-voices state)
- Admin read: `Index Scan Backward using "Answer_authorId_createdAt_idx"` (filter deletedAt, anonymous, status), 4 rows, 0.11 ms, 35 buffers. The question-in-window check is a join by primary key (`Question_pkey`, Memoize).
- Fill: `unnest` of 19 question ids, per question `Index Scan Backward using "Answer_questionId_status_rankScore_idx"` (loops=19, 2 rows each, Incremental Sort), top-N heapsort of 38 rows, 0.66 ms, 120 buffers. No bitmap scan, no sequential scan.
- Today's own read: `Answer_questionId_status_rankScore_idx` as on main (0.07 ms).
- Every SQL read of Home is under 1.3 ms.

## Same answers
New test in `home-never-empty.spec.ts`: "the fast path gives the same list as a plain reference over 30 random worlds": a reference written in the spec (loads everything, applies every rule by hand) against the route, for a guest, two signed-in people and an admin, 4 viewers per world. Worlds vary blocks both ways, anonymous posts, BANNED / SUSPENDED / DELETION_PENDING authors, admin, ex-admin, held / removed / deleted-by-author / `deletedAt` answers, ties in score and date, questions open, closed inside and outside the window, not yet open, draft, and today open / not open / missing; the last 2 worlds have 45 open questions. Spec: 10 of 10 passing (the 9 from round 1 plus this one).

## Runs
- `npm run typecheck`: clean. `npm run lint`: 0 errors, 29 warnings. NOTE: `npm run lint` is `eslint --fix` and reformatted 21 existing test files; I restored them by name (`git restore`), nothing of that is committed.
- Whole `npm test` (jest part), once, after the merge: 178 suites, 2917 tests: 2908 passed, 1 skipped, 8 failed.
  - 5 in `test/feed/admin-first-home.spec.ts`, the known ones (lines 164, 173, 273 x3), untouched.
  - 3 in `test/talk/hotfix1-block-oracle.spec.ts` ("a named post by W still vanishes for V when either blocks", "replying to the nameless answer works and notifies its writer unless the writer cannot see that reply (blocks either way)", "the nameless answer reads the same for V before, after V blocks W, after W blocks V, and after both"). The checker found this file order-dependent (fails after `test/talk/talk.spec.ts` on the same database, also on origin/main), and it passes alone. I did not run it alone or on origin/main this round, so that is the checker's finding, not mine.
  - The audio part of `npm test` was not shown in my output (jest failed first), so I did not run `test:audio`.
- The perf spec and the 2 databases are temporary; the perf spec is not committed.

## Could not prove
- Production timings (one 4-core machine; the plans and counts are the firmer part).
- The no-voices guest cell being within 10 ms in every run (one of two runs is 11.5 over).
