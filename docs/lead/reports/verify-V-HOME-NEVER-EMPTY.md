VERDICT: MERGE

# Round 3 (head `5d92f71`; `426955b`, the builder's round 3 report, arrived later and changes only that report)

Checked: `5d92f71` "Home admin read: one lateral probe per admin". Commits that arrived after round 2: `5d92f71` (product code, `feed.service.ts` and the spec) and `426955b` (the builder's report only, no product code).
Verdict: **MERGE**. The admin read no longer depends on how many admin accounts there are, the answers are the same as before, and Home is within 10 ms of main at p95 in all four cells, with 3 and with 31 admin role rows. The only failures in the whole suite in one part are the 5 expected ones, plus one timing test that passes alone (finding 1).

## Findings
### 1. LOW, not caused by this change: a timing test fails when the machine is busy
`test/talk/fixb-r4-edit.spec.ts` "round 6, R5-1: 60 edits on different posts at once and a bystander's request ... the bystander is quick" failed once in the one-part run (took 624 ms, limit 500). It tests the edit route, not Home. It failed the same way in my first round 1 run (under load) and passes alone on this head and on origin/main.

### 2. LOW, not caused by this change: `hotfix1-block-oracle` depends on order
In the one-part whole run, `test/talk/hotfix1-block-oracle.spec.ts` PASSED. When it runs after `test/talk/talk.spec.ts` on the same database it fails 3 of 4 tests, on origin/main too (round 1, finding 5). In my last check it failed on this head after other specs had filled the database; I did not repeat that exact pair on main this round, the round 1 proof stands.

### 3. LOW: new spec leaves rows behind (nothing readable)
Three runs in a row on one database, 10 of 10 each time. Readable published answers 0 before and 0 after each run, non-draft questions 1031 and 1031, topics 103 and 103. Left per run: 195 DRAFT questions and 220 answers on them (unreadable).

## What I checked
1. Diff `c73bcb5` to `5d92f71`, `api/src`: only `homeTrending()` changed, and only its admin read, plus the shared window read and one load of full rows for the admin posts and the fill winners. `adminBlock()`, `trendingAnswers()` and every other function are untouched. The spec changed only by adding to the new spec (`git diff c73bcb5 5d92f71 -- api/test`: no existing test file touched).
2. Raw SQL against `adminBlock()`, rule by rule: named (`NOT a.anonymous`), readable (`PUBLISHED`, `deletedAt IS NULL`, and the question readable through `isQuestionReadable` on the window's questions, with `questionId = ANY(...)`), in the window (the same window read), a current admin (`unnest` of `adminIdsOf`; `UserRoleGrant` is unique per user and role, so no id is twice), author status in `PUBLIC_STATUSES` (joined to `User`), newest first by `createdAt` then `id`, cap 3 (3 newest of each admin, then the 3 newest of those, which is exact). Arrays tried: 0 admins (worlds with 0 admins; the read is skipped), 1, 3, 10, 31, 100 and 300 admin ids, and 200 window question ids.
3. Same answers: 120 random worlds again, now with 0, 1, 12 and 40 admins in each world (picked from 7 named kinds plus 40 more people, some BANNED or DELETION_PENDING; admins with no posts, anonymous admin posts, ex-admins, admin posts on questions outside the window and on unreadable ones). The new head matches my plain-JS oracle in all 120, and matches the old implementation at `d46003f` item for item, order included (120 of 120 equal, 90 non-empty).
4. Plan and time of the admin read (EXPLAIN ANALYZE, my database with 50,035 answers, 20 questions, the real admin has 6 posts), today with no voices:

| ADMIN role rows | index | buffers | ms |
|---|---|---|---|
| 1 | `Answer_authorId_createdAt_idx` | 7 | 0.08 |
| 3 | `Answer_authorId_createdAt_idx` | 34 | 0.41 |
| 10 | `Answer_authorId_createdAt_idx` | 44 | 0.36 |
| 31 | `Answer_authorId_createdAt_idx` | 107 | 0.37 |
| 100 | `Answer_authorId_createdAt_idx` | 314 | 0.48 |
| 300 | `Answer_authorId_createdAt_idx` | 914 | 0.72 |
| 50 admins with 20 posts each (1,000 posts) | `Answer_authorId_createdAt_idx`, 51 probes, about 4 rows each | 367 | 0.61 |

In round 2 the same read took 20 to 23 ms at 31 admin rows (15,000 buffers). It no longer does.
5. Home p95 in ms (p50 in brackets), 200 requests per cell, new app per cell, one run each. 31 admin role rows (the case that was 25 to 37 ms over):

| State | Who | origin/main | rule H, new head |
|---|---|---|---|
| today 2,250 voices | guest | 82.1 (64.2) | 80.8 (62.5) |
| today 2,250 voices | signed in | 86.2 (67.8) | 87.7 (68.2) |
| today 0 voices | guest | 76.4 (56.5) | 77.2 (63.8) |
| today 0 voices | signed in | 80.7 (63.0) | 86.3 (71.9) |

With 3 admin role rows:

| State | Who | origin/main | rule H, new head |
|---|---|---|---|
| today 2,250 voices | guest | 89.2 (66.5) | 80.6 (64.3) |
| today 2,250 voices | signed in | 86.3 (66.8) | 83.4 (68.4) |
| today 0 voices | guest | 71.8 (56.1) | 80.8 (66.8) |
| today 0 voices | signed in | 77.2 (61.2) | 82.4 (69.6) |

Largest gap at p95: +9.0 ms (3 admins, no voices, guest), then +5.6, +5.6 and +5.2. All eight cells are inside the 10 ms target, but the no-voices guest cell with 3 admins is close to it (round 2 had the signed-in no-voices cell at +14 to +16; it is +5.6 and +5.2 now). The numbers move by a few ms from run to run on this machine (main's own guest cell with voices moved 82 to 89 between the two sets).
6. Gates: `npx tsc --noEmit` clean. Whole `jest --runInBand` in ONE part on a fresh database: 178 suites, 2,917 tests, 2,910 passed, 1 skipped, 6 failed. The failures: the 5 expected in `test/feed/admin-first-home.spec.ts` (164, 173, 273 times 3: "an admin post on another question is not on Home; a removed admin is not lifted", "five admin posts: the 3 newest, then 2 ranked", and the BANNED, DELETED and DELETION_PENDING cases), and the timing test in finding 1. Nothing else. `hotfix1-block-oracle` passed in this order.
7. Other routes: not re-compared this round (the task did not ask; round 2 found 17 routes identical and this commit changes only the Home read). The whole suite passes except as listed above.

## What I could not prove
- The live number of admin accounts, though the plan no longer depends on it (checked up to 300).
- Production timings (one 4-core machine). The plans, buffers and read counts are the firmer part.
- Whether `fixb-r4-edit` R5-1 passes in CI's order on a busy runner (it is a 500 ms limit).

---

# Round 2 (head `cd38827`), kept as written

Checked: `cd38827` (it holds a merge of main `5a00d54`). While I worked one more commit arrived, `c73bcb5` "Report: round 2, Home cost". It changes only the builder's report, no product code (`git diff cd38827 c73bcb5` is that one file).
Verdict: **MERGE**. The answers are right, nothing else changed, and Home is back to about main's speed in the normal case. One thing to know before release: one of the four timing cells is 14 to 16 ms over main at p95, which is over the 10 ms target (finding 1), and the admin read can fall back to the slow plan when there are very many admin accounts (finding 2). Both are small next to round 1 (+25 to +85 ms). The 5 expected `admin-first-home` failures are the only real test failures.

## Findings, most severe first

### 1. LOW: signed in, today has no voices: p95 14 to 16 ms over main (target was 10)
Same data and method as round 1 (20 questions, about 45,000 readable answers, 300 authors, 1 admin with 6 posts, window 7 days, 200 requests per cell, new app per cell), 3 admin accounts, tables just analysed. p95 in ms (p50 in brackets), two runs each:

| State | Who | origin/main | rule H, new head |
|---|---|---|---|
| today 2,250 voices | guest | 76.6 (61.7) and 85.9 (67.2) | 80.5 (64.2) and 82.9 (65.2) |
| today 2,250 voices | signed in | 84.9 (69.5) and 85.2 (70.8) | 84.8 (70.5) and 86.2 (68.1) |
| today 0 voices | guest | 76.5 (62.8) and 76.2 (59.1) | 81.2 (68.9) and 82.4 (68.8) |
| today 0 voices | signed in | 75.7 (62.4) and 79.3 (63.6) | 91.4 (74.9) and 93.3 (74.5) |

Three cells are within 10 ms (largest gap 6.2 at p95). The signed-in, no-voices cell is +15.7 and +14.0. Round 1 was +25 to +85 in these cells. Cause: 13 more database reads (below), not a slow query: every answer read is now under 2 ms. The home timings in the builder's report are lower overall (its machine), with the same shape.
Database reads of one `/home` request, counted in the Postgres log: today has voices, guest 49 before and 49 after, signed in 56 and 56; today has none, guest 44 before and 55 after, signed in 49 before and 62 after.

### 2. LOW to MEDIUM, depends on the live number of admins: the admin read can go back to the slow plan
The admin read by author uses `Answer_authorId_createdAt_idx` when there are few admin accounts: 1.5 ms with 3 admins and 2.0 ms with 10 (plan checked with EXPLAIN ANALYZE). In my first run my database held 31 ADMIN role rows (test people made by earlier runs, only 1 with posts), and the planner went back to the round 1 plan: question by question through `Answer_questionId_mood_status_idx`, 15,202 to 15,310 buffers, 20 to 23 ms, even after a fresh `ANALYZE`. Home p95 was then 25 to 37 ms over main in all four cells (new head p95 108 to 131 against main 79 to 94; the numbers of that first run are not in the table above).
If the live site has more than about 10 current admin accounts, this may happen. I could not look at live. Ask how many admins there are. The fix, if needed, is small (for example one read per admin id, or a `= ANY` form the planner treats the same way); I did not try it.

### 3. LOW: new spec leaves rows behind (nothing readable)
Three runs in a row on one database (after `talk.spec` and `launch-seed`): 10 of 10 each time. Before and after every run: readable published answers 0 and 0; non-draft questions 1031 and 1031; topics 103 and 103. Left behind per run: 207 DRAFT questions and 225 answers on them (unreadable). Run after it: `src/feed/launch-shift`, `src/feed/feed.spec`, `src/feed/prelaunch`, `test/mood/launch-seed`, `hotfix1-block-report`, `test/people`: 63 of 63 pass.

### 4. LOW, not caused by this change
`test/talk/hotfix1-block-oracle.spec.ts` fails 3 of 4 tests after `test/talk/talk.spec.ts` on the same database, on origin/main too (round 1, finding 5). The builder saw it in its whole run.

## What held
- Diff against origin/main: 5 files. In `api/src` only `feed.service.ts` changed: the `isQuestionReadable` import, the new `homeTrending()`, and the one call in `home()`. `adminBlock()`, `trendingAnswers()` and every other function are untouched. `git diff origin/main origin/v/home-never-empty -- api/test` shows only the new spec (no existing test edited).
- Raw SQL against `answerWhere` rule by rule: `status = 'PUBLISHED'` (same), `deletedAt IS NULL` (same), the question readable (done in JS with `isQuestionReadable`, the same test as the SQL rule `questionReadableWhere`, on the window's questions), blocks in both directions (`viewer.blocked` holds both directions; `answerNotBlockedSql` gives `anonymous OR authorId NOT IN (...)`, the same as `answerNotBlocked`: a nameless post is never hidden), not shown twice (`id <> ALL(have)`). `answerWhere` checks nothing else (not the author's status, not clips). The admin read repeats `adminBlock()`: named, readable, window, current admin, `PUBLIC_STATUSES`, newest first, cap 3.
- Random worlds: 120 worlds (100 ordinary, then worlds with 0, 1 and 200 window questions; window 0, 3, 7 and 30 days; nine question states; held, removed, deleted answers; anonymous posts; BANNED, DELETION_PENDING, DELETED, SUSPENDED and ex admins; blocks in both directions; guest, signed in and admin viewers; today open, not yet open, or missing). The new head and my plain-JS oracle agree in every world. The old implementation at `d46003f`, run on the same worlds, gives the same lists item for item, order included (compared by answer text, 120 of 120 equal, 92 worlds non-empty, no duplicates).
- Other routes: JSON of 17 routes for a guest and a signed-in person (`/feed/trending` pages 1 and 2, trending-questions, new, a question's answers on two questions and page 2, a thread's replies, a category page, search twice, `/questions/today`, a question by id, and `/home` without `trending`) is identical to origin/main (34 files; cursors compared without their timestamp, `requestId` left out). Only `/home` `trending` differs, as intended.
- `npx tsc --noEmit` clean. Lint (read only, no `--fix`): 0 errors, 56 warnings.
- Whole suite on the new head, run in 3 parts on 3 databases at the same time (CI runs one part): 179 suites, 2,919 tests. Failures: the 5 expected ones in `test/feed/admin-first-home.spec.ts` (164, 173, 273 times 3), and two files that failed only because the three parts ran together: `test/mail/launch-open-mail.spec.ts` ("listen EADDRINUSE 127.0.0.1:15092", my three runs shared one port, 9 tests) and `test/talk/fixb-r4-edit.spec.ts` (a 100 second test, timing). Both files pass alone on the new head and on origin/main (30 of 30 each). Nothing else failed. I did not run `npm run test:audio` this round (13 of 13 in round 1; the change does not touch it).

## What I could not prove
- The live number of admin accounts, so whether finding 2 happens on the live site.
- CI's exact file order for `admin-first-home` (it may show more than the 5 there).
- Production timings: one machine with 4 cores; the plans and read counts are the firmer part.

---

# Round 1 (kept as written; its MEDIUM 1, Home slower, is what round 2 answers; its MEDIUM 2 was fixed in `d46003f`)

VERDICT (round 1, head 0181cdc and d46003f): FIX

# Check of V-HOME-NEVER-EMPTY (rule H), full report

Checked: `0181cdc` first, then `d46003f` (arrived while I worked: "Regenerate contract; report for rule H"). `d46003f` touches only `docs/contract/openapi.yaml` and the builder's report. It does not touch product code (`git diff 0181cdc d46003f -- api` is empty).

The one thing to fix: Home now costs a lot more to build (finding 1). Rule H itself gave the right answer in everything I tried.

## Findings, most severe first

### 1. MEDIUM: Home is much slower, in both states
Data: 20 questions in the window, about 45,000 readable answers, 300 authors, 1 admin with 6 posts, window 7 days, one open "today" question.
Method: 200 requests in a row through the real route, own database, no cache, new app per row (so the 300 a minute limit does not interfere). Milliseconds, whole HTTP request.

| State | Who | origin/main p50 / p95 | rule H p50 / p95 (two runs) |
|---|---|---|---|
| today has 2,250 voices | guest | 62.8 / 79.9 | 83.9 / 104.4 and 90.4 / 105.1 |
| today has 2,250 voices | signed in | 65.4 / 80.9 | 86.5 / 105.2 and 93.2 / 113.0 |
| today has 0 voices | guest | 55.3 / 70.4 | 119.5 / 138.2 and 126.3 / 150.1 |
| today has 0 voices | signed in | 57.2 / 72.1 | 123.9 / 145.9 and 132.7 / 157.1 |

p95 up by 24 to 34 ms (30 to 40 percent) when today has voices, and by 68 to 85 ms (about 100 percent) when today has none (the launch-day state). Both pass the MEDIUM line (more than 30 percent and more than 20 ms).

Why (EXPLAIN ANALYZE of the real queries, taken with auto_explain):
- Admin block over the whole window (`adminBlock()` called from `homeTrending()`, `api/src/feed/feed.service.ts` about line 967): 29 to 40 ms, 15,384 buffers. The planner goes question by question through `Answer_questionId_mood_status_idx` (bitmap heap scan) and filters the author after. It does not use `Answer_authorId_createdAt_idx`. On origin/main this read was limited to today's question: 1.5 ms.
- The fill query for the other questions (about line 998, when today has fewer than 2 voices): 60 ms, reads 24,667 answer rows from 11 questions through the same bitmap scan, then a top-2 sort. On origin/main this query did not exist.
- Today's own ranked read uses `Answer_questionId_status_rankScore_idx`: 0.07 ms. Fine.
- No sequential scan over the answers anywhere. The cost is a bitmap scan of every readable answer in the window, twice.
- Same shape as `/feed/trending` page 1 reads today, so this is the cost of that route added to Home, which is the busiest route.

Database reads of `/home` (counted in the Postgres log, per request):
- today has voices: guest 49 before, 49 after; signed in 56 before, 56 after.
- today has none: guest 44 before, 53 after; signed in 49 before, 60 after.

The 5 second guest cache that runs in production would hide part of this for guests. It is off in my runs, and signed-in people never get it.

Idea that keeps the same answers (not tested): take the top 2 of each window question from `Answer_questionId_status_rankScore_idx` (about 20 small reads), and find the admin posts with `Answer_authorId_createdAt_idx`.

### 2. MEDIUM, already fixed in `d46003f`: the contract file did not parse
At `0181cdc`, `docs/contract/openapi.yaml:9525` was edited by hand and held `voices: today's` unquoted. YAML would not read it (`mapping values are not allowed here ... line 9525, column 141`). Two tests failed on it: `test/shared/shared2.spec.ts` "item 8 table: every signed-in write route in the contract refuses a non-active status" (`YAMLException: bad indentation of a mapping entry (9525:141)`) and `test/launch/contract-source.spec.ts` "docs/contract/src regenerates openapi.yaml byte for byte". Both pass on origin/main. The builder's report says the shared2 cause was not proven; it is this line.
At `d46003f`: the file parses, `build.py` output is byte for byte the same, and I ran `shared2`, `contract-source` and the new spec there: 3 suites, 36 tests, all pass.

### 3. Existing tests that fail (rule H, expected)
All in `api/test/feed/admin-first-home.spec.ts`; no existing test was edited (`git diff origin/main -- api/test api/src` shows only `feed.service.ts` and the new spec). Each fails only because the admin post `AO` (on a second open question) is now lifted, which is exactly the old rule being replaced:
- line 164 "an admin post on another question is not on Home; a removed admin is not lifted": expected `[A1,R1,AN]`, got `[AO,A1,R1,AN]`.
- line 173 "five admin posts: the 3 newest, then 2 ranked": expected `[A5,A4,A3,R1,AN]`, got `[AO,A5,A4,R1,AN]`.
- line 273, three cases "an admin whose account is not public is not lifted" (BANNED, DELETION_PENDING, DELETED): same expected and got as above.
Not failing, although you named them: `src/feed/prelaunch.spec.ts` (334, 491, 534) and `src/feed/feed.spec.ts` (477). Their data has no post that rule H would add, so they still hold. They pass on both.
The builder saw 8 failures in its whole run (also lines 143, 147, 152, 225), caused by another spec leaving a readable admin post on an open question. In my runs (3 parts, different order) those did not fail. So under rule H `admin-first-home.spec.ts` depends on what ran before it. I could not reproduce CI's exact file order.

### 4. LOW: new spec leaves rows behind (nothing readable)
Three runs in a row on one database, 9 of 9 each time. Before and after each run: readable published answers 0, 0; non-draft questions 1031, 1031 (so what it moved is put back). Left behind per run: 4 DRAFT questions, 13 answers on them (published but unreadable), 2 `scheduledFor` dates on DRAFT questions, 7 test users. Other specs do the same. If the run is killed in the middle, the other specs' questions stay DRAFT.
Run after other post-counting specs: new spec first, then `test/mood/launch-seed`, `src/feed/launch-shift`, `src/feed/feed.spec`, `src/feed/prelaunch`, `hotfix1-block-oracle`, `hotfix1-block-report`, `test/people`: 9 suites, 67 tests pass.

### 5. LOW, not caused by this change: `test/talk/hotfix1-block-oracle.spec.ts` depends on order
After `test/talk/talk.spec.ts` has run on the same database, 3 of its 4 tests fail (first one on a `nextCursor` timestamp, then 404 and a count). The same happens on origin/main (checked, same files, same order). It passes alone and on a fresh database. Listed so nobody blames rule H.

### 6. LOW, same as `/feed/trending`
- An anonymous admin post is not lifted, but it can take a ranked place. A block does not hide an anonymous post (the old rule, `answerNotBlocked`).
- A published post by a BANNED, DELETION_PENDING or DELETED author is not lifted, but can still take a ranked place on Home, because the ranked read does not look at the author's status (`feed.service.ts` about line 830, the same on `/feed/trending`). The owner may want to know.

## What held (rule H)
- My own oracle test (plain JS, written from the rules, not from the code): 60 random worlds. Window 0, 3, 7 and 30 days; nine question states; held, removed, deleted-by-author and `deletedAt` answers; anonymous posts; BANNED, DELETION_PENDING, DELETED, SUSPENDED and ex admins; blocks in both directions; guest and signed-in viewers; today open, not yet open, or missing. Every world matched in content and order. No duplicate anywhere.
- By hand: today 0, 1 and 5 voices give `[admin, top, second]`, `[admin, today's one, top of others]` and `[admin, today's top 2]`. Blocked author hidden in the ranked places and the blocked admin still shown. Cap 3, newest first (a fourth admin post may take a ranked place). Draft and not-yet-open questions give nothing. Closed 6 days ago shown, 8 days ago not shown (window 7); shown again at window 30; window 0 keeps only open questions. A person who stopped being an admin is not lifted. `isMine` is true on one's own post only; `iLiked` true after a like.
- Nothing else changed: on one 50,000 answer database, the JSON of 17 routes for a guest and for a signed-in person is the same on origin/main and on this branch (cursors compared without their timestamp). The routes: `/feed/trending` pages 1 and 2, `/feed/trending-questions`, `/feed/new`, a question's answers (two questions, page 2), a thread's replies, a category page, search (two terms), `/questions/today`, a question by id, and every field of `/home` except `trending`. The only other difference was a `requestId` in an error answer.
- Diff: 4 files. Outside `homeTrending()`, the one call in `home()`, the new spec and the contract words, nothing changed.

## What I ran
- `npx tsc --noEmit`: clean. Lint (without `--fix`): 0 errors, 56 warnings.
- Whole suite at `0181cdc`, in 3 parts on 3 databases (CI runs it in one part): 182 suites listed, 4 of them my own check files, which fail only because they need my data. The rest, 178 suites: 3 failed (finding 3's file, `shared2`, `contract-source`); tests: 2,919 passed and 8 failed, of which 5 are `admin-first-home` and 2 are finding 2. `npm run test:audio`: 13 of 13. On origin/main the five files `admin-first-home`, `shared2`, `contract-source`, `prelaunch`, `feed.spec` all pass (73 tests). I did not run the whole suite on origin/main.

## What I could not prove
- A voice answer whose clip is not READY: not built. The Home read has no clip test; neither has `/feed/trending`, so they agree by code, not by a run.
- `iSaved` and `myReaction` with a positive value, and the "label" text, on a trending item: not checked by hand (they come from the same `answersOut` as before).
- CI's exact file order, so whether `admin-first-home` fails in 5 or 8 places there.
- Real production timings. Numbers are from one local machine with 4 cores; the shape (plans and read counts) is the firmer part.
- Whole suite on origin/main (not run; targeted files only).
