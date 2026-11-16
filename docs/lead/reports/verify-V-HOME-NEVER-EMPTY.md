VERDICT: FIX

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
