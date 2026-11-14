VERDICT: FIX

# Verify BATCH-C2 (API): v/batch-api-1114c2 (a7af84c) = origin/main 4fa9d50 + V-PRELAUNCH + V-HOTFIX-1 rounds 1-4

Tested head: `a7af84c` on `verify/batch-c2`. Every line says RAN (I ran it and saw the result) or READ. My attack specs live in an untracked `api/attack/` folder and are not in the commit; this report is the only file I commit. No `.env`, no key file, no live provider. Own PostgreSQL 16 (port 55801) and Redis (56801, 56802), stopped at the end.

One finding stops the merge: **HIGH 1** (the sweeper's start time is stamped before the old API stops, so a post made by the old code is refunded 30 minutes later and the post stays). Everything else the brief asked for holds, or is a test fixture or a LOW. The fix is a few lines in `infra/deploy/deploy.sh` (below); a deploy done while no question is open also closes it, so the lead may rule that instead.

# Second hotfix check: MEDIUM 1 to 4 and LOW 5

| # | State | Run |
|---|---|---|
| MEDIUM 1 (dead charge, same person posts again within 5 min, never refunded) | CLOSED | C1, free-post person and paid person: crash 36 min old, second post with a new key; second charge aged 31 min; two sweeps. Dead charge REVERSED, exactly 1 REVERSAL row for the paid one (0 for the free one, free post back once), second charge COMMITTED and linked, balance 499 670 = ledger sum -330. |
| MEDIUM 2 (crash refunded at 30, not 10 minutes) | CLOSED (rule and text now say 30) | `SWEEP_MIN_AGE_MS` / `DEAD_RECORD_MS` = 30 min (`charge-sweeper.service.ts:12,14`); contract text of `Idempotency-Key` says 30 minutes; C3 refunds at 31 min. |
| MEDIUM 3 (retry after a crash: 8 days of REQUEST_IN_PROGRESS, then CONFLICT) | CLOSED | C3: crash, retry at 1 min: 409 `REQUEST_IN_PROGRESS` after 15.2 s (the in-flight wait); record and charge aged 31 min, sweep; retry with the same key: 409 `CONFLICT` in 24 ms, balance back to 500 000, 0 posts; new key: 201, balance 499 600, one committed charge. |
| MEDIUM 4 (removed answer's replay after expiry: 201 and the text stored again) | CLOSED | C4, 4 cases x (inside the record's life, after expiry twice): author-deleted answer 404 / 404 / 404; author-deleted reply 404 / 404 / 404; moderator-removed answer 404 / 404 / 404; moderator-removed reply 404 inside, 403 `CONTENT_REMOVED` after expiry (as the contract text says). No body carries the text, no record holds it, charges and posts unchanged. Restore after removal: not re-run by me (builder spec only). |
| LOW 5 (sweeper read plan; a throwing candidate at the head) | CLOSED | Plan: 500,000 `Charge` rows (400,000 older than the start time, 99,000 linked, 800 reactions, 200 true orphans), `EXPLAIN ANALYZE` of the sweeper's page query: `Index Scan using "Charge_sweep_idx"`, 200 rows, **27.9 ms** cold (round 2 measured 608 ms). C8: 250 real people whose wallet sits at the maximum (the reversal throws) older than 10 good ones: the sweep returned 10, all 10 refunded. |

# New findings

## HIGH 1. The start time is stamped by the migration, minutes before the old API stops; every post the old code takes in between is refunded 30 minutes later and keeps its post
- Code: `infra/deploy/deploy.sh:68` (legacy) and `:228` (current): `prisma migrate deploy`, then `calendar_shift`, then `npm run build` (minutes), and only then `switch` and `roll_api` (`:236-237`, restart). `api/prisma/migrations/20261114220000_hotfix_1/migration.sql:6-7` stamps `startAt = now()` when it runs. `charge-sweeper.service.ts:80` reads every unlinked charge after it. The old code never links a charge to its post (READ: on origin/main `attachRef` has no caller; `refId` is null on every charge it makes).
- What I did (C2b): start time set to 5 minutes ago, a paid text answer posted, its charge unlinked as the old code leaves it (`refType`/`refId` null), the sweeper run 31 minutes later.
- What happened: the charge is `REVERSED` (balance back) while the answer is `PUBLISHED`. The person keeps the post and gets the money back.
- Worse than "a few minutes of overlap": a deploy that fails after the migration (the build fails, or the health check fails and the old release is put back, `deploy.sh:206-207,234`) leaves the stamp standing while the old API keeps serving, and the next successful deploy does not move it. Every post made on the old code in that gap is refunded 30 minutes after the new code starts. With the first question opening at 23:00 UTC, a first attempt that fails at 22:30 and a second that succeeds at 23:45 refunds every post made in between.
- The V-HOTFIX-1 report asks the lead to "apply the migration immediately before the release goes live and stop the old instances first". `deploy.sh` does the opposite and says nothing about it in `infra/RUNBOOK.md`.
- Should: the stamp must be taken at the cut. Either (a) in `deploy.sh`, immediately after the build and before `switch`: `UPDATE "ChargeSweeperState" SET "startAt" = now() AT TIME ZONE 'UTC'` on every attempt (the last write before the restart wins), or (b) stop the old API, then migrate, then start the new one; or (c) as a rule for tonight: deploy before 23:00 UTC, with no question open, so no post can be charged in the window, and re-stamp after any failed attempt. Not a code change in the API.

## MEDIUM 2. `test/talk/c2-joined.spec.ts` is red on this head: the batch report's "6 of 6" and "one failure" are out of date
- RAN: the full API suite, and the spec alone on a fresh database: test 6 ("the sweeper leaves a charge whose post exists...", `c2-joined.spec.ts:708-710`, and again at the second person's `paid()` check, `:749`) fails: `Expected "REVERSED", Received "COMMITTED"`.
- Cause (checked with a copy): the fixture ages the charge 20 minutes (`age(b, 20)`) and never sets the start time. Round 4 made it 30 minutes and "after the start time stored by the migration" (the database was migrated seconds earlier). With 31 minutes and a start time of 2000 the first assertion passes and the next fails on the same fixture (`age(d, 20)`). Not a code fault: the sweeper does what the rule says. The merge of round 4 (a7af84c) came after the batch report's run.
- Should: age 31 minutes and insert the `ChargeSweeperState` row in `beforeAll`, as `hotfix1-r4-sweeper.spec.ts` does.

## LOW 3. A replay with a live retry record after a question moved back before its start answers 201 with the post
- RAN (D): post on an open question, question moved to SCHEDULED in the future (as the launch shift does), the same key and body sent again inside the record's life: `201`, body carries the author's own post text. With the record expired the replay is 404, as it should be. Author only, needs the key, at most 8 days. It is a read of a post under an unopened question; the rule says nothing can be.
- Should: the idempotent replay checks the window (or the readable rule) before it returns a stored post.

## LOW 4. Report and schema drift
- READ: `BATCH-C2-api.md` still says "no migration". There is one (`20261114220000_hotfix_1`).
- RAN: `prisma migrate diff` (database after the migration against `schema.prisma`) differs from origin/main's by one line: `ALTER TABLE "ChargeSweeperState" ALTER COLUMN "startAt" SET DEFAULT CURRENT_TIMESTAMP` (the migration uses `now() AT TIME ZONE 'UTC'`, the schema says `now()`). The rest of the drift (the hand-made search indexes, `searchTsv`) is identical on origin/main. A later `migrate dev` would write that line.

## LOW 5. `test/load/shared-address.spec.ts` timed out once in the full run
- RAN: "300 people behind one address" exceeded its 30 s while my cost runs were using the machine; alone it passes 4 of 4. Flaky under CPU load, not a fault.

# A. The join (RAN, `attack-a-join.spec.ts`: 75 contract GET templates expanded with ids and the sort / limit variants = 111 URLs, 7 viewers: guest, stranger X, V who blocks the writer, B whom the writer blocks, replier R, writer W, moderator; 8 block states: none, V->W, W->V, B->W, W->B, R<->W, all pairs both ways, cleared; windows: not yet open, open, over)
Writer W has, on one question: a nameless text answer (NT), a named text answer (ND), a nameless voice answer with a clip (NV), a named voice answer with a clip (NDV), replies, likes, saves, helpful, reactions, share links and news flags on all of them. Baseline taken twice: 0 noisy cells.
- **Not yet open** (about 7,000 requests per window, about 21,000 in all): the answer ids, clip ids, share codes and the words of the posts and replies appear in no 2xx response for any viewer in any block state, with one exception: the writer reading their own clip (`/voice-clips/{id}`, 200 with transcript), which is the pre-launch ruling ("the clip's owner always reads their own clip") and the same on both of their posts. No other clip read is 200. Writes (reply, like, save, helpful, react, report, report with also-block, share, listen, on NT, ND, NV, NDV, by a stranger and by the blocker, in none / V->W / W->V): every one 404; the posts' counters, W's notices and every Block row unchanged.
- **Open and over**: for every non-writer viewer (guest, X, V, B, R, moderator) the nameless answers (every object that carries NT or NV, every route keyed by them, the share page of NT) are byte-identical in all 8 block states. The only differences were the first-page membership of `answers?limit=1` (which answer is first moves when a named post of the writer appears or goes; the nameless object itself is unchanged). The same crawl on origin/main (own worktree) changes the nameless answer with blocks (as hotfix fixed).
- **Named half against origin/main**: same seed, same states, 6,216 cells (open window) compared after masking ids, handles, times: 0 differences in what the named posts show (7 notice titles differ only by a random handle). Named posts follow blocks exactly as on origin/main (404 for the blocked pair).
- **Writes in open/over**: nameless NT and NV: 201/200/204/204/200/201/201 identical for stranger and blocker in none, V->W, W->V; `reportBlock` on a nameless post answers 201 `blocked:false` and writes no Block row (origin/main answers `blocked:true` and blocks). On the named posts the blocker gets 404 on reply/like/save/helpful/react and `reportBlock` creates the Block row, as on origin/main. Over: reply 409 `QUESTION_CLOSED`, the rest stay open.
- Real seed, 1,030 unopened questions (`seed:questions`, `seed:launch`, the launch shift `--apply` run on a fresh database): at 22:59:59.9 and 23:00:00.0, 262 responses of 18 list routes (calendar, questions, home, today, topics, categories, feeds, news, polls, reports, results) read with cursors by a guest and a member, plus search for 40 unopened question texts and `GET /questions/{id}`: 0 unopened question texts, 0 non-404 by id.

# B. The opening instant on the real seed (RAN, `attack-b-open.spec.ts`, Date faked)
| moment | `/questions/today`, Home | the question by id | post | reply | share link | other question (16 Nov) |
|---|---|---|---|---|---|---|
| 22:59:59.900 | launch question, SCHEDULED; Home `dailyQuestion` SCHEDULED, no voices | 200 SCHEDULED, answers list empty | 409 | n/a | guest 201, page "Opens Sunday 15 November" | 404 by id, post 404, share 404 |
| 23:00:00.000 | launch question, LIVE; Home LIVE, `trending` empty | 200 LIVE | 201 | 201 | guest 201, page "Based on the voices so far" (status field on the page still `SCHEDULED`, known) | 404 |
| 23:00:05 | LIVE; Home shows the voices | 200 | 201 | 201 | same | 404 |
- 30 refused tries at 22:58 by one person (500 free posts): 30 x 409, free posts 500 after, 0 charges, no 429. At 23:00:00.000 the first refused key is accepted: 201, the same key again 201 replay with the same answer id, one charge. A post at the instant by a person with 30 refused tries behind them: 201.
- The code of the early 409 reads `QUESTION_NOT_OPEN` in the prelaunch check; my line did not print the body, so I did not re-prove the string; the status codes above are mine.

# C. Hotfix round 4, money (RAN, `attack-c-money.spec.ts`, 8 tests, all pass; retry records and charges created through the API, the crash made as the builders' `crash` does: the post and its link gone, the record left unfinished)
- C1, C3, C4, C8: above.
- C2: a charge 600 minutes old made before the start time stays COMMITTED after a sweep run 90 days later. (C2b is HIGH 1.)
- C5 the race, 200 of 200 (100 free-post, 100 paid): a request paused between charge and write (the answer write held), charge aged 29.5 min, two sweepers at +2 min running while the write is released: 200 posts stored and linked, 0 post-and-refund, 0 neither.
- C6 five sweeper instances at once over 30 dead charges, one throwing after 5: counts [6, 6, 2, 12, 4], then a sixth pass; every charge reversed once, 0 double reversals, wallet = start - committed for all 30, the 15 free posts back once.
- C7 500 mixed operations in 15-wide batches over 60 people (188 sends, 74 replays, 45 crashes, 38 deletes, 34 expiries, 46 sweeps; some with the clock moved 40 minutes), two final sweeps: wallet / ledger mismatches 0, double or missing reversals 0, posts without a live linked charge 0, live unlinked charges after the two sweeps 0. (67 sends answered 404 while my sweeps ran with the clock 40 minutes ahead: the builder's known clock-lie case, a request in flight whose record the sweeper takes for dead; the post and charge were consistent.)
- 500,000-charge plan: LOW 5 above.

# D. Idempotency after the join (RAN, `attack-d-idem.spec.ts`)
- The same key at once x2 and x6: all 201, 1 answer, 1 charge. After expiry x6 at once: all 201, the same answer id, still 1 answer, 1 charge. Another body with the same key: 409 `IDEMPOTENCY_KEY_REUSED` inside and after expiry, nothing stored.
- Replay on a question that has since closed: record alive 201 (stored post), record expired 409 `QUESTION_CLOSED`; moved before its start: record alive 201 with the post (LOW 3), record expired 404. Nothing charged or stored in any of the four.
- Refused as not open (404, 404, nothing charged), then the question opens, same key x4 at once: 201 x 4, 1 answer, 1 charge.

# E. Migration `20261114220000_hotfix_1` (RAN)
Database migrated from origin/main's own `prisma/` (18 migrations), with 50 users, 2,000 charges, 100 retry records. `prisma migrate deploy`: applied; `ChargeSweeperState.startAt` = 09:39:19 UTC, the moment of the apply (the apply started 09:39:18); both indexes there; 2,000 charges untouched; the sweeper's query finds 0 of them. `rollback.down.sql`: table and indexes gone, 2,000 charges there; `_prisma_migrations` row deleted; applied again: new later start time (09:39:28), indexes back, `migrate status`: up to date, 19 migrations, stamps unique (`ls | cut -c1-14 | uniq -d` empty). Drift: LOW 4.

# F. Contract (RAN)
`python3 docs/contract/src/build.py <temp>` and `cmp` with `docs/contract/openapi.yaml`: identical. Against origin/main (`git diff`, 12 added and 4 changed lines, nothing removed, no type changed): the `Idempotency-Key` parameter text (8 days for posts, the 30-minute rule, 409 `CONFLICT` and the 404 / 403 rules), the `E409` text names `QUESTION_NOT_OPEN`, `ErrorCode` gains `QUESTION_NOT_OPEN`, the `Topic` text says a week that has not started sends 0 and null, the Home text says `trending` is today's question only. Nothing origin/main serves is removed.

# G. Cost (RAN, same data on both trees: 200 questions (141 open), 50,000 answers, 10,000 replies, 2,000 users, one person with 40 answers and 5,000 notices (3,000 unread); statements and SQL time from the PostgreSQL log, mean of 3 warm requests, two rounds, idle machine)
| route | origin/main statements | this code | SQL ms main | SQL ms this |
|---|---|---|---|---|
| `/me` | 19 | 28 | 7.3 / 6.9 | 7.8 / 6.9 |
| `/people/{id}` (self / other) | 17 / 16 | 33 / 32 | 0.6 / 0.6 | 1.7 / 1.3 |
| `/me/answers` | 14 | 22 | 0.4 / 0.3 | 1.0 / 0.9 |
| `/search?type=people` | 24 | 33 | 3.6 / 2.9 | 3.7 / 4.7 |
| `/notifications` | 12 | 14 | 5.7 / 4.5 | 6.3 / 4.5 |
| `/notifications/unread-count` | 7 | 8 | 4.5 / 5.7 | 5.0 / 6.5 |
| `/home` | 43 | 46 | 44.3 / 34.8 | 2.4 / 2.6 |
The known pre-launch MEDIUM (more statements on `/me`, people and bell routes) is there and not counted; the SQL time on my data stays within a few milliseconds except Home, which gets much cheaper (44 -> 2.4 ms).

# H. Static checks and suites (RAN, own database each time)
- `npx tsc --noEmit`: exit 0.
- eslint `{src,test}/**/*.ts`: 0 errors, 47 warnings.
- Requested set (`test/shared test/talk test/feed test/me test/reach test/news test/units src/feed/prelaunch.spec.ts`, fresh database, in band): 56 suites, 54 passed, 2 failed; 694 tests: 691 passed, 1 skipped, 2 failed. The two: `hotfix1-block-oracle.spec.ts` (the known one) and `c2-joined.spec.ts` (MEDIUM 2).
- Known red: `hotfix1-block-oracle.spec.ts` "replying to the nameless answer works and notifies its writer..." fails with 402 `FREE_POSTS_EXHAUSTED` (a new person's 3rd reply). Confirmed cause: a copy with that person given 10 free posts (`makePerson(h, { freePosts: 10 })`, nothing else changed) passes 4 of 4. Nothing else in the oracle is red.
- Whole API suite, fresh database, in band, `jest --runInBand --forceExit`: 114 suites: 111 passed, 3 failed; 1,277 tests: 1,273 passed, 1 skipped, 3 failed. The three: the oracle (known), `c2-joined` (MEDIUM 2), `test/load/shared-address` (LOW 5, passes alone 4 of 4). An earlier whole run was lost when my own PostgreSQL's data folder was made unreadable by the sandbox; its figures are not used.
- `npm run test:audio`: 13 of 13.
- `test/shared/shared1a.spec.ts`: `git diff origin/main HEAD -- api/test/shared` is empty; it passes in the shared batch and in both whole runs.
- The only existing spec edited against origin/main: `test/news/news.spec.ts` (the question is made LIVE; the batch report says "no assertion edited": true, a fixture line).

# Proved by runs
Join crawl and write matrix (A), named half against origin/main, unopened-question sweep on the real seed, the opening instant (B), money specs C1 to C8, idempotency D, migration apply, rollback, apply again, contract rebuild, cost tables, 500,000-charge plan, tsc, eslint, the requested set, the whole suite, test:audio.

# Read only
Deploy order in `infra/deploy/deploy.sh` (HIGH 1 shows the effect by a run, the order by reading); that origin/main has no caller of `attachRef`; `isQuestionOver` treats a stored CLOSED question as readable even if its start is in the future (no post can exist under a question that never opened); `postKeepMs` and the config row for the 8 days.

# Not proved
- Restore of a removed answer, replay then returns the post (builder spec only).
- The string of the early 409 body (status proved).
- The extra-voice-token path of a refused early write; voice posts through the real upload flow (clips created by row).
- A sweep above 500,000 charges or on a database under write load; two real processes (the five instances share one connection pool in one process).
- Share card images (no storage here), data export, mail contents.
- Production's calendar: the launch shift and seed were run on a fresh copy, not production.
