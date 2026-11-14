# C2.1-COST: the hot signed-in routes cost what origin/main cost

Branch `v/c21-cost`, cut from `v/batch-api-1114c2` (a7af84c). Build, specs and measurements by the builder; nothing here has been checked by a second person.

## What it does
When no unreadable question holds any post (the normal state), `/me`, `/people/{id}`, `/me/answers`, people search, the notification list and `notifications/unread-count` run no `Question` join and no `hiddenCounters` work. When some do, the answers are exactly what the direct rule gives (proved on 300 random worlds, below).

## What built it (file:line)
- `api/src/feed/question-window.ts:150-232` the list. `loadUnreadableQuestionIds` (:181) reads every question holding an answer or proposal and keeps those `!isQuestionReadable(...)`: the ONE rule, in code, no second copy. `unreadableQuestionIds` (:205) caches it for at most 15 s (one load shared by callers that arrive together; a load that was overtaken by an invalidate is not stored). `invalidateUnreadableQuestions` (:174). `answerReadableByList` (:235): `{}` when the list is empty, else `questionId NOT IN (list)`; `null` list = the direct rule.
  - Why not `NOT questionReadableWhere`: in SQL a question with no start or end date makes the readable test NULL and `NOT NULL` is NULL, so it would drop out of the list. The first draft did that; the 300-world spec's "the list is exactly the unreadable questions with a post" check caught it.
  - Why "`NOT IN` equals the rule": an answer is itself a post, so its question is in the list exactly when it is not readable (up to the freshness below).
- `api/src/me/views.ts:117-165` `hiddenCounters` takes the list: empty list = no query; non-empty = three small counts of what sits under the listed questions (the old "all minus readable" stays for callers that pass no list). `:184-` `profiles(ids, ownerId, viaList)`: the two readable filters and the hidden counters use the list. `authorRefs` (:~322) reads profiles through the list too (it only uses the name fields; this is what removed 8 statements from `/me/answers` and the people page).
- `api/src/me/me.service.ts:347` (`/me`), `api/src/me/people.service.ts:83` (`/people/{id}`) call `profiles(..., true)`; `people.service.ts:98` (profile's recent answers) and `:181` (`/me/answers`) use `answerReadableByList(list)`.
- `api/src/feed/feed.service.ts:1130-1165` people search: counts and hidden counters through the list; no count queries when the page has no person.
- `api/src/reach/reach.service.ts:265` (list), `:544` (unread): `fast` when the list is empty. Fast: no `question` join under replies and voices, no proposal read; the notices about a question itself (which may hold no post, so the list cannot decide them) still read their question and use the direct rule; unread count is main's count plus those. Non-empty list: the code of a7af84c, unchanged.
- Other routes (feed, news, search of answers, clips, saved, admin) keep the direct rule.

## Every place the list is dropped (`invalidateUnreadableQuestions()`, always after the write has committed)
| write | file:line |
|---|---|
| override create (moves questions, sets status/dates) | `admin/overrides.service.ts:611` |
| override cancel (puts them back) | `admin/overrides.service.ts:712` |
| override clock: starts (SCHEDULED to LIVE) / ends (to CLOSED) | `admin/overrides.service.ts:744`, `:767` |
| topic edit and move (shifts its questions' dates) | `admin/topics.service.ts:399` |
| question create (also bulk and pool add: they call it) | `admin/topics.service.ts:638` |
| question edit | `admin/topics.service.ts:719` |
| question move / swap on the calendar | `admin/topics.service.ts:814` |
| pool: put a question on a day (and the one it displaces) | `admin/pool.service.ts:307` |
| calendar launch shift (`applyShift`, a script; also drops the list of the process that runs it) | `feed/launch-shift.ts:419` |
| launch question seed, question import (scripts) | `feed/launch-question.ts:92`, `feed/seed.ts:206` |
Writes that only move a counter (`answerCount`, `voiceCount`) cannot change the window and do not call it: `talk/posts.service.ts`, `vote/poll.service.ts`, `admin/trust/moderation.service.ts` (moderation never changes a question's dates or status). A spec scans `src` for every `question.create/update/updateMany/upsert/delete` and fails if a file is not in this table or the counter list, so a new writer cannot be forgotten.

## Why a stale list can only hide
Time moves a question one way: not open, then open, then over. A question that was readable when the list was made stays readable; one that was not may have opened since, and the stale list then hides it for up to 15 s longer. Dates and status change another way only through the writes above, which drop the list. A question with no post cannot get one before it opens (every write on it is refused), so it never needs to be in the list. It is written in the code comment (`question-window.ts:~134`) and proved in a spec (below).

## Cost table (same data, one warm request, median of 9, Postgres 16, the Postgres log: "execute" lines)
Data: 200 questions (141 started, 59 not), 50,000 answers (all on started questions: the normal state, list empty), 2,000 users, 10,000 replies, 20,000 reactions, 5,000 notices for one person (3,000 unread: replies, reactions, polls, plain, questions), one topic. origin/main and a7af84c in separate worktrees on the same database; the bench is `api/test/bench/c21-cost.bench.ts`, the loader `api/test/bench/c21-cost-load.sql`. The list is cached 15 s.

| route | statements main / a7af84c / head | head ÷ main | SQL ms main / a7af84c / head | head ÷ main |
|---|---|---|---|---|
| home guest | 40 / 43 / 43 | 1.07 | 22.9 / 1.8 / 1.9 | 0.08 |
| home member | 47 / 50 / 50 | 1.06 | 19.4 / 1.9 / 1.8 | 0.09 |
| notifications unread-count | 11 / 15 / 13 | 1.18 | 6.8 / 4.3 / 5.0 | 0.74 |
| notifications list | 20 / 28 / 24 | 1.20 | 5.8 / 4.3 / 4.1 | 0.71 |
| me | 23 / 35 / 25 | 1.09 | 6.1 / 5.2 / 4.0 | 0.66 |
| me/answers | 14 / 22 / 14 | 1.00 | 0.5 / 1.0 / 0.5 | 1.00 |
| people/{id} (guest) | 13 / 29 / 13 | 1.00 | 0.5 / 1.8 / 0.5 | 1.00 |
| people/{id} (member) | 16 / 32 / 16 | 1.00 | 0.6 / 2.0 / 0.6 | 1.00 |
| search people | 24 / 33 / 25 | 1.04 | 1.2 / 6.9 / 1.8 | 1.50 (see below) |

- Statement counts: all within 1.2 (the notification list is exactly 1.20; the 4 extra over main on the list and 2 on the unread count are not the window: they are hotfix 1's reads of the nameless flag, and the one `Question` read that a notice about a question itself needs).
- SQL time: every route is at or below origin/main except people search, where the SQL is the same statements as main's (two count queries on 1 ms of total). Two repeat runs on both trees: head 1.7, 1.7 ms; main 1.7, 1.3 ms. This is noise on a total of about 1.5 ms (the same statement varies between 0.3 and 1.0 ms from run to run), not a plan change. I did not tune it further. a7af84c was 6.9 ms.
- Home is not a hot-route change: it is the a7af84c Home (43 vs 40 statements), 1.07 and 1.06 of main in count and 10 times lower in SQL time (main's trending seq-scans the answers).
- With one unreadable question holding a post (the list non-empty), head against a7af84c, statements / SQL ms: me 31 / 5.1 (35 / 6.2), me/answers 18 / 0.7 (22 / 1.3), people 21 / 0.9 (29 / 2.3), people member 24 / 0.9 (32 / 2.3), search 29 / 2.3 (33 / 8.5), unread 15 / 4.2 (15 / 5.5), notification list 28 / 6.0 (28 / 4.8; same code path as a7af84c, the 1.2 ms is run noise). The non-empty case is cheaper than a7af84c everywhere but the notification routes, where it is the same code.

## Specs added
`api/test/feed/c21-list.spec.ts` (5 tests):
1. 300 random worlds (seeded, reproducible): questions in every status and window position (before, inside, past, no start, no end, none), with and without answers (text and voice, named and nameless, published and held), replies, proposals, reactions, saves and 8 kinds of notices (answer, reply, proposal and question targets in mixed case, with and without posts under them, read and unread). Per world: the list equals "not readable and holding a post" (computed with `isQuestionReadable`), then 8 requests (`/me`, `/people/{id}` as another person and as the owner, `/me/answers`, people search, notifications, unread-only notifications, `unread-count`) with the list in use against the direct rule (`setDirectRuleOnly(true)`), compared as text (a cursor's issue time `iat` is left out: it is the clock of the call). 2,400 comparisons, **0 differences**; at least 10 worlds with an empty list and 100 with a list (it asserts both).
2. Stale list: a question opens at +10 s; at every probed moment before that the list holds it (never early); at +12 s and +14.999 s the 15 s-old list still holds it (hides, allowed); at +15 s it is gone. A clock that goes back does not trust a list from its future.
3. The same on the real route and the real clock (`/me/answers`): hidden before, hidden for the 3 s after it opens, shown at 15 s after the first call.
4. A status edit through the admin service (`updateQuestion`: open to DRAFT, then back to LIVE) changes `/me/answers` at once with a 15 s cache.
5. The scan of every question writer (above).
Test setup: `api/test/list-ttl-off.ts` (jest `setupFiles`, `package.json`) sets `QUESTION_WINDOW_LIST_TTL_MS` to 0 unless already set, so the suite never caches the list: many existing specs set a question's dates straight through Prisma, which no API write sees. The cache is on only in the specs that set it and in the bench.

## Runs (exact counts)
- `npx tsc --noEmit`: exit 0.
- eslint `"{src,test}/**/*.ts"`: 0 errors, 47 warnings (a7af84c: 47 warnings, 0 errors).
- Contract: `python3 docs/contract/src/build.py <temp>` then `cmp` against `docs/contract/openapi.yaml`: identical (no route or shape changed).
- Step 0: `test/talk/hotfix1-block-oracle.spec.ts` 4 of 4.
- `test/feed/c21-list.spec.ts`: 5 of 5 (the 300-world test takes about 65 s).
- `src/feed/prelaunch.spec.ts` and `test/shared/shared1a.spec.ts`: pass, unchanged.
- `test/shared test/talk test/feed test/me test/reach test/news src/feed/prelaunch.spec.ts` on a fresh database: **50 suites passed of 51; 582 tests passed, 1 skipped, 1 failed (584)**. The one failure is `test/talk/c2-joined.spec.ts` "the sweeper leaves a charge whose post exists, and reverses one whose write was refused as not open" (expected REVERSED, got COMMITTED, line 710).
- Full API suite once on a fresh database (`jest --runInBand`): **114 suites passed of 115; 1,280 tests passed, 1 skipped, 1 failed (1,282)**. The same single test. `test:audio`: 13 of 13.
- **That c2-joined failure is not from this change.** It fails the same way on a7af84c (checked in a separate worktree, alone, on a fresh database: 5 passed, 1 failed, same line). The spec ages the charge by 20 minutes (`age(b, 20)`) and the sweeper of a7af84c reverses only charges older than 30 minutes (`SWEEP_MIN_AGE_MS`, `talk/charge-sweeper.service.ts:12`, hotfix 1 round 4): the spec still has the old 15-minute rule. The brief said c2-joined must pass unchanged; I cannot make it pass without editing its assertion or the sweeper, both forbidden here. It needs the lead's ruling (change the 20 to 31 in the spec, or the rule).


## Choices
- Step 0: the lead's ruling said "that spec's person". The red test is the replier (`v`), who replies three times, so the fixture line is `v = await makePerson(h, { freePosts: 10 })` (line 34). 4 of 4 pass. The brief said two unused `eslint-disable` lines in `prelaunch.spec.ts`: there are none (its single directive, with three rules, uses all three: removing it gives 47 errors). The 2 extra warnings on that file are two `no-unsafe-argument` on `new Date(x.startsAt)`; I typed them (`as string`), no assertion changed.
- Where the list is stored: a module variable in `question-window.ts`, not Redis. It is per process. If the API runs in more than one process, a write that moves a question's start LATER on one process leaves the other processes' lists up to 15 s stale, and in that one direction a question already listed as readable could show early for up to 15 s. Time alone never does this. If production runs one process (as far as I know it does), nothing to do; if it runs several, say so and I will key the invalidate through Redis. Scripts (`calendar:launch-shift`, seeds) run in their own process and cannot drop the API's list: after a shift the API's lists are up to 15 s stale in the same one direction. The safer choice (shows less) is not available here without a shared store, so I report it instead of hiding it.
- The list holds questions with any answer, proposal or (through an answer) reply of any status, soft-deleted included: broader than "published", so it can only hide more.
- A notice about a question itself keeps the direct rule on every path, because such a question may hold no post.
- `authorRefs` now reads through the list for every route that shows an author (feed, talk, news too). Their output does not change (it uses only name fields); only the hidden counters it never used are no longer computed when the list is empty.
- Production boot cost: the list is one query (questions with a post, about a thousand rows at most) at most every 15 s per process.

## Not done
- The one-process question above is not settled by code.
- No load test: single requests on one shared CPU, as the verifier's item 10.
- Not run on the live database, Spaces, Flutterwave, Resend, WAWU ID or Gemini.
