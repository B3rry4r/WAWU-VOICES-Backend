VERDICT: FIX

# Verify V-FIX-B round 5, API side

Code under test: `origin/v/fix-b` at 134ac44, in its own worktree. Origin/main (4fa9d50) in another. Own Postgres 16 (port 15453) and two Redis (16393, 16394), repo fakes only, no live provider, no `.env` or key file opened. My attack specs (`api/test/zz/*`) are not in the commit.

## R4-1 to R4-3: state

| Finding | State | Run |
|---|---|---|
| R4-1 (longer text, no live charge) | **Closed.** I found no way left to end with a longer text and no live charge, or a live charge and no longer text. | Held runs: 72 cases (charge held before or after the real charge; 2, 3, 5 identical edits; the poster asks for Verified; decision DECLINE, KEEP, SEND_TO_MODERATION, APPROVE, CHANGE_TAG Verified, the poster's DELETE; ask-first and decision-first). 72 of 72 right. Plain races, 2 or 3 identical edits, ask at 25 or 45 ms and decision 20 ms later, 300 each: DECLINE/KEEP/SEND mix, CHANGE_TAG Verified, APPROVE, poster's DELETE = 2400 runs, 0 bad. Each run checked: wallet = start minus live charges, no non-COMMITTED row, longer text only with exactly one live charge of cost(150)-cost(1), old text only with no rows, no 5xx. Mixed interleavings did occur (edit 409 after the lock rule, ask 409, delete 404). |
| R4-2 (spec could not see it) | **Closed.** `onCreated` is gone; the specs were rewritten and my own runs above cover the creator-refused shape. | |
| R4-3 (prefix count) | **Closed.** Exact key (`base` or `base:r<n>`). Seeded REVERSED rows `edit:id:1:150`, `:1:15`, `:1:1500:0`, `:1:150:00`, `:1:150:r1`, `:11:150:0` (old format and look-alikes): the edit answered 200 with one COMMITTED charge, key `1:150:0`, no `:r` suffix. A REVERSED row of the exact state key makes the retry `:r1`, charged once. | |

## New findings

### MEDIUM
**R5-1: a burst of edits starves the connection pool: 500s and a 5 s stall for every other request.**
`api/src/talk/posts.service.ts` `editAnswer` (the `$transaction` around the lock, about lines 444-510). The post lock transaction now holds one pool connection while `units.charge` opens its own transaction (needs a second connection). The pool is `max: 20` (`prisma.service.ts:22`). With about 35 or more edits in flight at once, every connection is held by an edit transaction waiting for a connection for its charge.
What I did: one poster, N edits on N different posts at once (rows inserted directly, so the post rate limit does not apply), plus one other user's `GET /api/v1/me` 150 ms in. N = 21, 30: all 200. N = 40: 14 x 200, 26 x 500 ("Unable to start a transaction in the given time" and "expired transaction"), bystander GET took **5013 ms**. N = 60: 25 x 200, 35 x 500, bystander 5030 ms; resending the 500s: 14 x 200 then the last 21 x 500 again.
Money stays right in every run: the 500s that had charged were REVERSED (20 rows in both bursts), per-post mismatches 0, wallet = start minus live charges. A resend then succeeds.
Origin/main, same spec: N = 21, 30, 40, 60 all 200, bystander 51 to 248 ms.
Should happen: no connection held while waiting for a second one: for example charge on the same transaction/connection, or take the post lock, read and price, then charge inside the same connection scope, or bound concurrent edits below the pool. One user with 40 posts in the edit window can stall the API for 5 s, repeatedly.
Not a money hole, an availability regression against main.

### LOW
**R5-2: grow, shrink, grow now pays the second grow; main did not.** Steps 33 to 100 / 33 / 100 / 140 / 100 / 140 / 140 cost: this branch 2230 / 0 / **2230** / 1340 / 0 / **1340** / 0; origin/main 2230 / 0 / 0 / 1340 / 0 / 0 / 0 (main's key is only from-to, so a repeat is free). The branch follows the ruling (pay the difference from the current text); it is more than main's sequential total, not more than the rule. Needs a lead decision, not a defect in code.

## Item by item
- **2 Different edits at once** (6 runs each): 33 to 100 + 33 to 140: always 3570 = cost(140)-cost(33) (rows 2230+1340, or one 3570 when 140 ran first). Main: always 5800 (both from 33). 3 different (100, 120, 140): 3570 every time, main 8700. Grow + shrink (100, 20 from 33): 2230 (or 2660 when 20 ran first then 20 to 100 = sequential); main 2230. Shrink then two grows from 60: 4000, main higher. Never more than the sequential total for the order that ran; less than main. Wallet = live charges in all.
- **3 Retry**: same text again after success: 200, 0. Same text after an unrelated change (x100, y100, then x100 again, z50, x100): 2230 / 0 / 0 / 0 / 0 / 1660 on the branch and on main alike (the last is 50 to 100). Grow/shrink/grow: see R5-2.
- **4 Write fails after the charge** (forced): 500, charge REVERSED once (ledger transaction for it shows), balance back to start, same edit then 200, rows REVERSED then COMMITTED `:r1`, charged once; a third send: 200, no new row.
- **5** 402: post untouched, an editor decision straight after took 39 ms (lock released), after top-up the edit went through. Slow units (1.5 s): the edit 200, an editor decision waited 1435 ms for the lock then 200. Failing units: 500, no row left, retry 200, one charge. 20 edits on 20 posts by one poster: all 200, 20 live rows, no deadlock (25 also fine; 40 fails, R5-1). The deadlock run (edit, second edit, request, reply, reaction, report, flag, decision, delete, 80 times): 0 5xx, slowest call 210 ms, none over 2 s.
- **6** Done under R4-3.
- **7** `git diff origin/main -- api/src/units/units.port.ts api/src/units/units.ledger.ts api/test/units/ledger.spec.ts`: empty. A one-request post with no tag and N-4 (edit against the poster's delete: del family 600 runs, 0 bad) hold. N-5 and N-6: only through the branch's own specs (fixb-r2, fixb-r4 N-6 60 races), which pass; not re-run by me separately.
- **8** `tsc --noEmit`: 0 errors. eslint `{src,test}`: 0 errors, 44 warnings. Fresh database: test/talk 11 suites 222 passed; test/units 6 suites 115; test/admin 27 suites 268; test/news 1 suite 12; test/reach 13 suites 114 passed 1 skipped. Whole API suite once, in band: **108 suites, 1258 passed, 1 skipped, 0 failed.** (A run on a database full of my attack rows failed 1 shared2 moderation-list test and 1 talk test; both are the pagination of my polluted data, both pass on a fresh database.)
- Assertions changed in `f7f4444..134ac44`: `fixb-r2.spec.ts` N-1 (title, comment, and `charge` called once + `reverse` with `c-r3` to charge 0 times and reverse 0 times, plus the removed `onCreated` mock) = the new rule and nothing else. `fixb-r4-edit.spec.ts`: the N-3 two-edits, N-3 60 races, N-9 and N-4 rows rewritten as the builder lists (held runs for 2, 3, 5 now all 200; refused leaves no row; write-failure is the only reversal; deleted gap = 404 and no row). One removed `expect(fn()).toBe(true)` goes with `onCreated`. Nothing else.

## Proved by runs
R4-1 (72 held, 2400 plain races), R4-3 seeds, items 2, 3, 4, 5, 7 diff, 8 counts, R5-1 against main.

## Read only
Lock order claim (no path holds a wallet then waits for a post); the units port/ledger diff.

## Not proved
N-5 and N-6 by my own runs; two real API processes; a larger pool (`DATABASE_POOL_MAX`) moving the R5-1 threshold (expected to move it, not remove it); R5-1 with edits from many posters (I used one poster; the wallet lock queue made the test harsher, but the pool is the limit).

Why FIX: no money path is left (MERGE condition on money is met), but R5-1 is a regression against main that turns a burst of about 35 concurrent edits into 500s and a 5 s API stall.
