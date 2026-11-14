Tested commit: 67ea461 (origin/v/hotfix-1, fetched again at the end; its code is identical to 7f98f01: the last two builder commits only add `docs/lead/reports/V-HOTFIX-1.md`). Control tree for "as on main": 755aa15 (the merge-base of the branch; `origin/main` has since moved to 4fa9d50, which adds `author.verified` and other changes, so comparing against it would show noise). A trial merge of `origin/main` 4fa9d50 into the branch has no textual conflict (`git merge-tree`); nothing was built or run on that merge.
VERDICT: FIX

Everything below says "RAN" (I ran it and saw the result) or "READ". My attack specs and scripts are not committed (they were copied into `api/test/talk` only while they ran and removed afterwards; kept in the session scratchpad). No live provider, no `.env`, no key file was touched. Own Postgres 16 on 55601 and Redis on 56601, stopped at the end.

# First check's findings

| # | Finding | Status | Run |
|---|---|---|---|
| BLOCKER 1 | `/people/{userId}/replies` drops a reply on a nameless answer when a block exists | CLOSED | Crawl, world A (below): `people.R.replies`, `people.M.replies`, `people.X.replies` identical in every state for every viewer but W; the same crawl on 755aa15 changes 37 routes per state |
| MEDIUM 2 | A charge from a request that died after charging is never given back | PARTLY CLOSED. The sweeper gives it back, but later than the rule and not always: see NEW 1, NEW 2, NEW 3 | C1, C2, `CR2` below |
| MEDIUM 3 | Post text replayable 8 days after delete / removal | CLOSED inside the record (`{"gone":true}`, replay answers 404, nothing charged); OPEN at one edge after the record expires: see NEW 4 | D1, D2, D4 |
| LOW 4a | W gets "Someone replied" for a reply W cannot see | CLOSED | A-write: W's notices 1 (the stranger's reply), unread 1 for a blocked person's reply and a stranger's reply |
| LOW 4b | `Report.alsoBlocked` true with no block | CLOSED | B: 6 reasons x {no flag, false, true} on a nameless answer: all `alsoBlocked` false |
| LOW 4c | Contract text said 24 hours | CLOSED | `build.py` output byte-identical to `openapi.yaml` (`cmp`) |
| LOW 4d | Closed question answers 409 before the stored-post lookup | OPEN, accepted by the builder, not run by me | |

# New findings

## MEDIUM 1. A dead charge is never given back when the same person posts again within 10 minutes (rule 4)
- Code: `api/src/talk/charge-sweeper.service.ts:68-82`. A charge with `refId` null counts as "has a stored post" when any answer (or reply) of the same kind by the same person was created in the 10 minutes after the charge. The match does not check that the post already belongs to another charge. Every post made since this branch links its own charge (`refId`), so for a new charge `refId is null` already means "no post", and the content heuristic only hurts.
- RAN (`vx-sweeper` C2): person pays for a text answer, the request dies (answer, link and record gone); within 5 minutes the same person posts again with a new key and it works. The dead charge is 24 hours old at the sweep: still `COMMITTED`, balance 499 200, ledger sum -800 (two charges of 400, one post). Never refunded, however often the sweep runs. A deploy restart in the middle of a request, followed by the person tapping Post again, is exactly this case.
- Should: a post found by the heuristic only counts if no other charge links to it (`NOT EXISTS (SELECT 1 FROM "Charge" c2 WHERE c2."refId" = a."id")`), or the heuristic is limited to charges made before the deploy.

## MEDIUM 2. A real crash is refunded after 30 minutes, not 10 (rule 4), and only if nothing else touches the record
- Code: `charge-sweeper.service.ts:83-86` (unfinished retry record younger than 30 minutes blocks the sweep) and `talk/shared/idempotency.service.ts` (a process that dies leaves its record unfinished).
- RAN (C1, real crash: record left unfinished, answer gone): charge aged 11 minutes: `COMMITTED`; 25 minutes: `COMMITTED`; 31 minutes: `REVERSED`, balance back, ledger 0. The builder's sweeper spec deletes the retry record when it simulates the crash, so it never meets this.
- Should: say 30 minutes in the rule, or treat the record as dead sooner. Not money-losing, but it is not "every 10 minutes after 10 minutes".

## MEDIUM 3. After a crash, retries with the same key are blocked for 8 days and then refused for ever; main delivered the post after 24 hours
- Code: `idempotency.service.ts` (`waitForInFlight` timeout answers 409 `REQUEST_IN_PROGRESS` while the unfinished record lives; the record now lives 8 days), `units.ledger.ts:268-275` (a reversed charge answers 409 `CONFLICT` "Start again with a new key").
- RAN (`vx-crash2`, same spec on both trees): request dies after the charge; the web retries the same key 1 hour later: 409 `REQUEST_IN_PROGRESS` on both. After the record expires: main 201 (post created under the old charge, no second charge); branch 409 `CONFLICT`, balance back (the sweeper reversed it), no post. The person who kept a recording queued for retry (the web retries for up to 7 days) never gets it posted, and the client sees "still being handled" for 8 days instead of 1.
- Should: a record that has stayed unfinished longer than any request can run (say 30 minutes) is treated as dead: let the retry through to the ledger (it then answers the reversed-charge 409 at once, so the client can re-key), or delete it when the sweeper refunds the charge.

## MEDIUM 4. Replaying the key of a moderator-removed answer after its record expired answers 201 with the removed text and stores it again for 8 days (rule 5)
- Code: `posts.service.ts` `createAnswer` (`stored` and `status` REMOVED returns the view), `idempotency.service.ts` (an expired record is deleted and re-created, then filled with the returned body).
- RAN (`vx-d4`): answer posted, reported, removed by a moderator: record body `{"gone":true}`; replay inside the window 404 (good). Record expired by hand, replay: `201`, `answer.status: "REMOVED"`, body contains the text; the new record holds the text (`responseBody` read from the row), expires in 7.99 days; the next replay returns it again. Same for a reply removed by a moderator: after expiry the replay is `403 CONTENT_REMOVED`, so answers and replies differ. After a restore the replay returns the post (201, `Idempotent-Replay: true`).
- The author can read the same text with `GET /answers/{id}` (200) and `/me/answers`, so this is not a leak to others; it is rule 5 as written ("a replay answers that the post is gone, never the old text") not holding after the first expiry.
- Should: a replay that finds its post REMOVED answers like a deleted one (404, nothing stored), or the new record stores `{"gone":true}`.

## LOW 5. Smaller points
- RAN: the sweeper query reads the whole 30-day window every 10 minutes: 500 289 charges, 499 733 answers: 608 ms (parallel seq scan of `Charge`, external sort of 200 000 rows, 6 to 9 MB temp per worker, 200 000 index probes on `Answer(authorId, createdAt)`; no lock beyond a read). Each of up to 200 candidates is re-checked by id (about 30 ms each, generic plan): about 7 s a sweep in the worst case. Every charge made before this deploy has `refId` null (`attachRef` has no caller on main), so the first sweep after deploy scans all of them and then refunds true orphans 200 at a time. A partial index on `Charge(createdAt) WHERE status='COMMITTED' AND "refId" IS NULL AND action IN (...)` would make it small. Not run at higher volume.
- READ + RAN: `ORDER BY createdAt LIMIT 200`: a candidate whose reversal always throws (a refund that would put the balance over `MAX_BALANCE_MILLI`, `units.ledger.ts:446`) stays at the head every pass; 200 of them would stop all refunds. Unlikely.
- RAN (`vx-selfreply`, same on main, not caused by the branch): the writer of a nameless answer can reply to it and the reply shows the writer's handle to every viewer. That unmasks the writer by their own action; worth a ruling.
- RAN: a replay after expiry answers with a rebuilt body (same fields as the original in my run, `Idempotent-Replay` header absent on both). Counters in the rebuilt view (likes, replies) are current, not the original snapshot.

# What I swept for rule 2

READ the builders' crawl (`hotfix1-crawl.spec.ts`): 36 routes, 5 viewers (V who blocks, X, R, W, guest), the nameless and the named answer on two different questions, so it never has both by one writer on one question; no voice answer, no mood question, no news flag, no listen; never reads the writer's replies list, `/people/{W}`, `/me/blocks`; the oracle is "every response equals baseline". Run: 3 of 3 pass (all builder specs: 7 suites, 32 tests, pass). It misses nothing I could find, but it covers the single-question split only.

My crawl (`vx-crawl`, fresh database per run, one `X-Forwarded-For` per request, every id, handle, token and timestamp masked to a label, baseline taken twice: no noise). Writer W; viewers: guest, M (member), R (replier), X (neighbour), QA (the question's `createdById`), W, Mo (moderator). Content on each W post: three replies (R, M, X), likes and saves (M, R, X, QA, Y), helpful (R, Y), reactions (M, R, X), a report (X), a share link (M), a news flag, rank score; a mood question with a mood word; a voice answer with two listens (member and visitor). 2 other people's answers as controls. 51 to 65 GET routes per viewer (the sort variants TOP / NEW / DEBATED, `limit=1`, replies with and without stance, `/news/{id}`, `/answers/{id}/videos`, `where-you-sit`, people pages and replies of W, R, M, X, Y, `/me`, `/me/answers`, `/me/saved`, `/me/blocks`, `/me/friends`, `/wallet`, notifications and unread count, share page, categories, calendar, weekly report, home, today, questions, feeds, search x2, news and news tags, questions' moods, polls, what-next) plus `voice-clips/{id}` and `/play` in a separate run. States: before (twice), the four viewers block W, unblock, W blocks the four, unblock, both ways, unblock.
- World A (W has only nameless posts), branch: for guest, M, R, X, QA and Mo, every route is identical in every state except `/me/blocks` (the blocker's own list) and `/people/{W}`, `/people/{W}/replies` (W's own page, which hides when a block exists: about the person, shows `voiceCount 0`, no nameless post). Same crawl on 755aa15: 36 to 37 routes change per state (answer, replies, question lists, trending, search, news, saved, people replies, ...). So the crawl detects the fault and the branch removes it.
- World B (W has only named posts), branch vs 755aa15: 4 472 captured cells, 4 424 identical; the 48 that differ are `/me` `referralCode` (random).
- World C (W has a nameless and a named answer on the same question), branch: each nameless answer object is byte-identical in every state for every non-W viewer (196 changed-route cells checked); the named answer disappears and the question header, lists, search and feeds change by that answer only, as on main.
- Not swept: share card images (404, no card storage), data export, `topics/*`, `result-threads`, polls (no post).
- Write side (`vx-rule1`): W blocks Z; Z and a stranger S each GET, reply, like, save, helpful, share, report with `alsoBlock`, list the replies: identical statuses and shapes for Z and S (200, 201, 200, 204, 204, 201, 201 `blocked:false`, 200), and no Block row. (My reaction call used a kind both refused, so reaction is not proved: 422 on both.)
- W's own view: W sees only the replies of people W has not blocked and who have not blocked W (W's reply list, reply counts and `/people/{blocked}` pages change; `/me/blocks` grows); W's notices for a reply by a blocked person are not created (W notices 1, unread 1 after a blocked person and a stranger both replied); notices created earlier stay and read "Someone replied" once the replier is hidden. Twin check: two writers, one blocks Z, one does not, Z replies to both: a stranger T, Z and S see the same shape on both (statuses, notices, unread); nothing about another person's response moved because of W's block.

# B. Rule 1

RAN (`vx-rule1`, nameless answers by a fresh writer each, 42 combinations): HATE_OR_HARASSMENT, THREAT_OR_VIOLENCE, SCAM_OR_SPAM, PERSONAL_DETAILS, ABOUT_ME, OTHER, each with `alsoBlock` absent, false, true: 201, `blocked:false`, 0 Block rows, `/me/blocks` empty, `Report.alsoBlocked` false, moderation item present and its detail names the writer (`author` holds the writer's id and handle). MISLEADING_NEWS_TAG answers 422 on a non-news answer (same on main). A named answer with `alsoBlock:true`: 201, `blocked:true`, 1 Block row, `alsoBlocked` true; without the flag 0 rows. REPLY target with `alsoBlock`: `blocked:true` (replies are named; as main). USER target with `alsoBlock`: `blocked:true` (a report about a person, as main).

# C. Sweeper (RAN, `vx-sweeper`, `vx-chaos`)
- Dead charge, builder-style crash (record gone): given back once, free post given back once, `ledger sum = wallet`.
- 9 minutes: left. With a stored post: left. Author-deleted and moderator-removed (status REMOVED) before the sweep: left (the charge keeps `refId`), balance unchanged.
- Kinds: POST_TEXT and POST_VOICE charges reversed; REACTION, VOTE, EDIT_TEXT, TEXT_FIX charges, committed and old, left. The `Charge` table is the only one read; pack and plan payments are ledger payment rows and `Payment` rows (READ: not selected); 22 other ledger transactions existed and none was touched. No DM exists on this branch (READ).
- Race 200 times: a slow request (post written after a pause between charge and write), charge aged to 9:59.5, two sweeps at once run at 10:01.5 while the request is still open, then the write completes: 200 of 200 posts stored and charged, 0 post-and-refund (the unfinished retry record blocks the sweep). 100 with a free post and 100 paid. This only holds while the record is younger than 30 minutes.
- Two sweeps at once (above) and five app instances sweeping 30 dead charges at once, one instance crashing after 5 reversals: counts [1, 0, 0, 19, 10], then a second round 0: each charge reversed once, 15 REVERSAL rows for 15 paid charges, free posts returned once, 0 people wrong.
- 500 mixed operations in 15-wide parallel batches (230 sends, 47 replays, 58 crashes, 39 deletes, 19 removals, sweeps with a clock moved forward, 33 slow requests overlapping sweeps), 60 people: ledger sum = wallet = start - committed charges for every person (0 mismatches); 0 charges reversed twice or missing a reversal row; 0 posts without a committed linked charge; 0 committed unlinked charges left after two final sweeps; free allowances all consistent.

# D. Rule 5 (RAN, `vx-money` D1 to D3, `vx-d4`)
Author deletes (text with free post, voice with paid clip): the record row is `{"gone":true}`, `statusCode` 201 kept; replay inside the window: 404 `NOT_FOUND`, no `Idempotent-Replay` header; same key with another body: 409 `IDEMPOTENCY_KEY_REUSED`; after expiry text 404 `NOT_FOUND`, voice 404 `CLIP_NOT_FOUND`; no record holds the text; balance, free posts, charges: unchanged, 0 reversals. Moderator removal of an answer and a reply: both records `{"gone":true}`, both replays 404 inside the window, nothing charged or reversed. After expiry: see MEDIUM 4. Restore: the answer comes back; the record stays gone inside its window (404); after expiry the stored post answers. Account deletion (`DELETE /me`) starts the 14-day grace; the purge deletes the records (READ, `deletion.service.ts:408`), and 14 days is longer than 8, so nothing outlives it.

# E. Rule 3 (RAN, `vx-money` E1, final head)
Paid voice answer, record expired, replay: 201, same answer id, balance and ledger unchanged, 0 reversals, body fields identical to the original. Free post: 201, free post count stays, 1 answer. Honest reversal (clip already on another answer): 409, charge `REVERSED`, balance restored, exactly 1 REVERSAL row. Six at once fresh: 201 x 6, 1 answer, 1 charge; six at once after expiry: 201 x 6, 1 answer, balance charged once. Other body with the same key: 409 `IDEMPOTENCY_KEY_REUSED` inside and after expiry, nothing written. Another person's key: 201, their own answer. Crash after charge: see MEDIUM 3.

# F. Specs, migration, contract
- RAN: `git diff --name-status origin/main...origin/v/hotfix-1 -- api/test api/prisma`: only seven added files (`hotfix1-*.spec.ts`), nothing under `api/prisma`. No existing spec changed in any round (the assertion edit the builder lists in round 3 is inside its own new `hotfix1-block-oracle.spec.ts`: old W+2 notices, new W+1; it follows rule 2's exception). Migration: none, so nothing to apply or roll back.
- RAN: `python3 docs/contract/src/build.py <file>` is byte-identical to `docs/contract/openapi.yaml` (`cmp`).
- READ: a hidden dependency on the sweeper: a deploy with the branch charges nothing different; the config key `idempotency.post_keep_days` (default 8, max 60) is a new row only if an admin sets it.

# G. Checks
All RAN on 67ea461 with my attack specs removed from the tree, Postgres 16 on 55601, Redis on 56601, a fresh database migrated from the branch's migrations.
- `npx tsc --noEmit`: exit 0.
- eslint (`src/**/*.ts` and `test/talk/hotfix1-*.spec.ts`, no `--fix`): 0 errors, 7 warnings (4 in existing files, 3 "unused eslint-disable" in the new specs).
- The seven hotfix specs: 7 suites, 32 tests, all pass.
- Full API suite once (`jest --runInBand`, fresh database): 107 suites passed, 0 failed; 1177 tests: 1176 passed, 1 skipped (`test/reach`), 0 failed. By folder (suites, passed, failed, skipped): `test/talk` 17, 241, 0, 0; `test/units` 6, 115, 0, 0; `test/me` 12, 108, 0, 0; `test/reach` 12, 107, 0, 1; `test/feed` 2, 15, 0, 0; `test/admin` 22, 220, 0, 0; `test/privacy` 9, 28, 0, 0; `test/shared` 2, 62, 0, 0; `test/mail` 6, 75; `test/load` 5, 32; `test/vote` 2, 36; `test/mood` 2, 14; `test/news` 1, 12; `test/results` 1, 21; `test/launch` 2, 7; `test/textfix` 1, 2; `src/feed` 2, 33; `src/me` 1, 29; `test/*.spec.ts` 2, 19.
- `npm run test:audio`: 13 of 13 pass.
- No failure, so no comparison with main was needed. (A run of the builder's oracle spec on a database other specs had filled once failed for the builder, a known order dependence; on a fresh database it passes.)

# Proved by runs
Crawl A, B, C and the main control; the report matrix; the blocked-person write side and W's own view; clip routes; sweeper cases C1 to C6 and the 500 mixed run; the 500 000-charge EXPLAIN; rule 5 replays and the D4 hole; rule 3 money runs; the crash-then-retry comparison with main; tsc, eslint, contract, specs.

# Read only
`spendThen` ordering and the replayed-charge branch; `clearPostRecord`; no hard delete of `Answer` or `Reply` rows in `src` (grep); account deletion clearing records; pack and plan payments not in `Charge`; the trial merge with `origin/main` (textual only).

# Not proved
- Reaction by a blocked person on a nameless answer (my kind was refused).
- Mail contents for a reply on a nameless answer; data export; share card images; news and mood detail with real moderation data beyond the crawl's flags.
- Anything on the merge with `origin/main` 4fa9d50 beyond "no textual conflict" (it changes `posts.service.ts`, `config-reader.ts`, `views.ts`, `units/*`).
- A sweep at volumes above 500 000 charges, or with a database under real write load.
- Timing side channels (not measured again; the first check measured 100 calls per case).
