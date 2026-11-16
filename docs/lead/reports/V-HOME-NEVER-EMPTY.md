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
