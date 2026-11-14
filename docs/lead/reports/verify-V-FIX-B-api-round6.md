VERDICT: MERGE

# Verify V-FIX-B round 6, API side

Code under test: `origin/v/fix-b` at ebb7639 in its own worktree; origin/main (4fa9d50) in another. Own Postgres 16 (port 15463, max_connections 300), repo fakes only, no live provider, no `.env` or key file opened. My attack specs (`api/test/zz/*`) are not in the commit.

## R5-1 and R5-2: state

| Finding | State | Run |
|---|---|---|
| R5-1 (burst of edits starves the pool) | **Closed.** | One poster, N edits on N posts at once + another person's `GET /api/v1/me` 150 ms in. Branch: N = 21, 30, 40, 60, 200 all 200; bystander 103 / 29 / 28 / 287 / 780 ms. Main: all 200; bystander 228 / 119 / 203 / 245 / 1362 ms. Ledger right for every post (one live charge of cost(150)-cost(1), text changed). `pg_stat_activity` while it ran: "idle in transaction" never above 11 (6 slots x 2 connections is 12); the fifth check had 20 of 20 held. |
| R5-2 (grow-shrink-grow paid twice) | **Closed, by design.** `Answer.paidChars`. Sequence 33 to 100 / 33 / 100 / 140 / 100 / 140 / 140 costs 2230 / 0 / 0 / 1340 / 0 / 0 / 0, total 3570, equal to main. | See "paidChars: where it differs from main" below. |

## New findings

No BLOCKER, HIGH or MEDIUM.

### LOW
**R6-1: the new 503 on `PATCH /api/v1/answers/{answerId}` is not in the contract.** `docs/contract/src/routes.py:116` lists `errs=[403, 404, 409, 422]` for `editAnswer`; the route can now also answer 503 `UNAVAILABLE` with `Retry-After: 2` (and already answered 402). The builder changed nothing under `docs/contract` (`git diff 134ac44 ebb7639 -- docs/contract` is empty). Contract build (`python3 src/build.py out.yaml`) equals the committed `openapi.yaml` byte for byte, so the gap is in the source, not a stale build. Should: add 402 and 503 to that route's `errs`, rebuild.

**R6-2 (behaviour, not a defect): a burst over about 6 edits that outlasts 5 s turns the tail into 503.** 600 edits by one poster on 600 posts at once: branch 493 x 200, 107 x 503 (5.1 to 5.2 s wait, `Retry-After: 2`, no charge row, text unchanged, resend 200); main 600 x 200 in 7.2 s. Another person's single edit sent 200 ms into that burst waited in the queue and got 200 (7079 ms in total; main 6834 ms). The queue is first come, first in (array of waiters, a timed-out waiter removes itself, a released slot passes straight to the next waiter), so nobody waits for ever, and one person's burst blocks another person's edit for at most the 5 s wait, then a 503 and a new place in the queue. A person can keep the slots busy only by keeping 6 slow edits going; I could make that happen only by holding a wallet lock myself (below).

## Item by item

**1. The gate**
- A stall: poster's wallet row held by me for 7 s, 40 edits at once. At 1 s: 6 lock waiters in `pg_stat_activity` (exactly the 6 slots), connections active 6, idle 5, idle in transaction 7; bystander `/me` 39 ms, a new post 67 ms (201). The 34 waiting edits answered 503 after 5099 to 5192 ms, code UNAVAILABLE, `Retry-After: 2`; none left a charge row or a text change (leaked 0); resend: all 200. The 6 in the slots got 500 ("expired transaction": Prisma's 5 s transaction timeout, because I held the wallet 7 s); they left no live charge. Main has the same 5 s timeout inside its transaction, so this is not new. Another person's edit (own wallet) during this stall also got 503, after 6.1 s: while 6 edits sit blocked, the gate is full for everyone's edits (by design, 5 s at a time).
- 200 edits by 200 different people on 200 posts, plus 20 posts / 20 replies / 20 reads of `/me` from one more person at 100 ms: all 200 edits 200 (slowest 5660 ms, a saturated single process), ledger wrong 0; posts 10 x 201 + 10 x 429 (the post rate limit), replies the same, `/me` 20 x 200 (slowest 3003 ms). Posts, replies and `/me` do get through while edits queue, slowly under load (a saturated event loop, not the gate). My reaction requests used the wrong kind and answered 400: reactions not exercised.
- A slot is always given back: 100 each of 404 (deleted post), 409 (window passed), 402 (poor), 403 (not author), 403 (my "400" case was in fact someone else's post), a write that throws inside (trigger raising, 500 then 409 for the parallel ones), then 20 requests whose clients disconnected while blocked on the wallet. Before the abuse, 14 edits with the wallet held show 6 lock waiters; after it, the same, for a new person and for the abused person: 6 again. No slot leaked.
- Connections held by waiting edits: 0 (waiters are timers in memory; seen directly: 34 waiting, 6 lock waiters, 12 or fewer connections busy).

**2. The filter.** 30 real HTTP error cases on both trees (400 x2, 401 x3, 402 x2, 403 x2, 404 x3, 409 x2, 413 x2, 422 x5, 429 throttle x6, 500 x2, plus unsupported-type attempts that the DTO answers as 422 on both): headers and bodies diff **identical** (ids, handles, timestamps normalised). Plus 20 exception shapes run straight through `AllExceptionsFilter` on both (400, 401, 402, 403, 404, 409, 413, 415, 422, 429 with and without details, 500, 502, 503 plain, 503 UNAVAILABLE without details, 503 with another details key, 504, 400 and 409 carrying `retryAfterSeconds`): identical except the one intended: 503 with `retryAfterSeconds: 2` now sets `Retry-After: 2` (main: no header). The busy middleware's own 503 does not pass the filter and is untouched. I could not make the busy middleware fire from supertest (0 of 8 concurrent answered 503), so that exact case is covered by the filter-level run and by `git diff` showing the middleware untouched; the 429 throttle case (incl. its `Retry-After`) is byte-identical.

**3. paidChars: where it differs from main** (each sequence run on both trees, per-edit cost in milli; "main" in brackets)
- Never more than main, in any sequence I ran. Equal on: 33 -> 100,33,100,140,100,140,140; null post 33 -> 50,33,50; 1 -> 150,1,150,149; the first-growth cost of every sequence.
- Cheaper than main (free where main charges again), all of the "regrow a length already paid for" kind, which is the rule:
  - post 100 paid, edits 1, 100: 0 total (main 3300); 150 -> 1 -> 150: 0 (4970); 100 -> 1 -> 120 -> 1 -> 120: 670 (3970).
  - a post made before the code (null): 100 -> 1, 100, 120: 670 (3970); 33 -> 10, 20, 33, 40: 230 (1000). "First edit shorter": the null post takes the length it had at that moment as paid, so shrinking does not lose it. "First edit longer": 570, same as main.
  - free post of 1 character, edits 100, 33, 100: 3300 (5530); free post of 300 characters, edits 1, 300, 400: 3330 (13300). A free post pays nothing for its own length, then only beyond it; main charges the regrow to a length that was free at creation (shrink a free 300-character post to 1 and back to 300 costs 0 here, 9970 on main). This is the one reading that gives away something main charges and the rule does not name: the post's own free length counts as "paid". Needs the lead's yes; I think it is the intended rule (the person was never asked to pay for that length), but it is a decision.
  - two growths at once from 33: 100 and 140: 3570 on both a posted-by-API and a null post (main 5800); 100,140,5,120 at once: 3570 (main 8700).
- Never charged where main does not: no sequence gave a higher cost for any step.
- Write fails after the charge (trigger raising): 500, charge back to 0, `paidChars` still unset (null) and text length 33; retry 200 for 2230 = cost(100)-cost(33). Refused edits (404, 409, 402, 403) leave no charge row.
- Editors and moderators: no code outside `posts.service.ts` writes an answer's `body` except account deletion (`deletion.service.ts:221-230` sets it null, status deleted, so no later edit exists); so no editor or moderator change touches `paidChars`, and none needs to. Voice posts get `paidChars` null and cannot be edited (422); the voice caption cannot be edited. Deleting a post makes the edit 404 (kept on both); restoring leaves body and `paidChars` as they were.

**4. Migration `20261114280000_fixb_paid_chars`.** On a database migrated from origin/main's own `prisma/` (19 migrations) plus this branch's earlier migrations, with 500,000 answers: `prisma migrate deploy` applied it in 2.6 ms of statement time (1.0 s for the whole command); 400 parallel `select` calls ran through it with no wait; column nullable, all 500,000 rows null, no backfill. Rollback (`rollback.down.sql` plus deleting the `_prisma_migrations` row): column gone, 500,000 answers intact; applied again; `migrate status` up to date; I also set a value, rolled back, re-applied: back to null. Stamps: no duplicate 14-digit stamp in `prisma/migrations`.

**5. Still true**
- 300 plain races, 2 or 3 identical edits (150 each): 750 x 200, wallet = start minus live charges, exactly 1 live charge, no non-final row, 0 bad. 100 races of 4 different lengths (100, 150, 20, 120) at once: 400 x 200, 0 bad: each post's live charges sum to cost(longest paid)-cost(1).
- Held runs (wallet held 300 or 800 ms; 2, 3 and 5 identical edits, every fourth with the poster's delete too): 24 runs, 0 bad, 0 5xx (80 x 200, 6 x 204).
- Deadlock mix (edit 150, edit 100, reply, reaction, poster's delete on one post), 80 times: 0 5xx, slowest 98 ms. (My mix is smaller than the fifth check's: no request, flag, report or editor decision.)
- `git diff origin/main -- api/src/units/units.port.ts api/src/units/units.ledger.ts api/test/units/ledger.spec.ts`: empty.

**6. Gates**
- `npx tsc --noEmit`: 0 errors. eslint `{src,test}`: 0 errors, 44 warnings.
- `test/talk test/units test/admin test/news test/reach`, fresh database, in band: **58 suites, 742 tests: 741 passed, 1 skipped, 0 failed.**
- Whole API suite once, in band, fresh database: **108 suites, 1269 tests: 1267 passed, 1 skipped, 1 failed**; the one failure is `test/vote/vote.spec.ts` "serves a guest the live counts, cached in Redis" because I had not started Redis for that run; with my own Redis on port 16463 the file passes (32 of 32). So 1268 passed, 1 skipped, 0 failed.
- Contract: `python3 docs/contract/src/build.py out.yaml` equals the committed `openapi.yaml` (`cmp`); `schema.prisma` and the other contract files unchanged by the branch (nothing in `docs/contract` in `134ac44..ebb7639`).
- Assertions changed in `134ac44..ebb7639`: none. `git diff --numstat -- api/test` is `286 0 fixb-r4-edit.spec.ts` (additions only).

## Proved by runs
R5-1 against main (5 sizes each), the 503 path with the wallet held (headers, no charge, no text change, resend), slot give-back after 500 bad requests of 5 kinds + 20 disconnects, 600-edit tail, 200 people, 30 + 20 error shapes against main, paidChars sequences against main (16 sequences), migration with 500,000 rows, rollback and re-apply, 300 + 100 + 24 + 80 races, tsc, eslint, all suites, contract build.

## Read only
Gate code (FIFO, timer removal, slot passed on release); that nothing but `posts.service.ts` writes an answer body; the busy middleware not passing through the filter.

## Not proved
Two real API processes (the gate is per process; with two, 12 edits in at once, still under the pool of 20, but 3 or more would not be bounded by it); a smaller `DATABASE_POOL_MAX` than 20; reactions under the burst (my request used a wrong kind); the busy middleware's 503 from a real overload; the voice-post caption edit (not reachable: only TEXT is edited); the lead's deliberate choice on a free post's own length counting as paid (above).

## Why MERGE
A burst of edits can no longer stall or fail other requests (bystander 28 to 780 ms against main's 119 to 1362; no 500 at N = 200; waiting edits hold no connection; a 503 charges and changes nothing); no path gave a longer edit free that main does not already give for a length the person paid for or was given free, and none charged where main does not; the migration applies in milliseconds on 500,000 rows and rolls back. Open for the lead: R6-1 (contract lists no 402 or 503 for the edit route), and the free-post-length reading of `paidChars`.
