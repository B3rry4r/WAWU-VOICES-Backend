# V-REL-D2-FIX2

Branch `v/rel-d2-fix2`, cut from `origin/main` 6eccda4. No pull request. No schema change. Items: H2, M2, M3, L2, L3. H1 was already on main, M1 and L7 stay as they are, M4 was not touched (`posts.service.ts` edit transaction and `units.charge` are as they were).

## H2: one lock order

The order on every path: 1 the post row (`Answer`, `FOR NO KEY UPDATE`; a reply: its answer first, then the `Reply`), 2 the moderation items, 3 the `Question` counters (id ascending), 4 anything that needs the `User` row.

### What I changed

- `api/src/admin/trust/news.service.ts` `decide` (about line 224): the plain `FOR UPDATE` (`lockRow`) is now `SELECT id FROM "Answer" ... FOR NO KEY UPDATE`. No key column is changed by a decision. The "send to moderation" upsert and the item updates already came after the post lock, so they now follow the order. The body is wrapped in the retry helper.
- `api/src/admin/trust/moderation.service.ts` `act` (about line 689): reads the item's target without a lock, locks the post (`lockPost`: an answer, or a reply's answer then the reply), then locks every moderation item of that target by id ascending (`lockItemsOf`, `FOR NO KEY UPDATE`), then reads the item again and refuses (409, "Someone has already decided this item.") if it is not about the same target. The existing checks after that (already resolved, final appeal, and so on) still decide whether the item is still open. In `setContentStatus` the question counter update now comes before the person's `voiceCount` update (it was the other way round). The body is wrapped in the retry helper.
- `api/src/me/deletion.service.ts` `purge` (about lines 150 to 230): after the role advisory lock it reads, without locks, every answer it will touch (its own, those it replied to, liked, reacted to or listened to), locks them by id ascending, locks the author's question counter rows by id ascending, and only then takes the person's `User` row `FOR UPDATE`. The rest of the body is as it was. The transaction is split into `purgeOnce` and wrapped in the retry helper. The ID-file purge and the "deleted" mail stay after the commit and outside the retry.
- `purgeDue`: a failure of one person is caught and logged with the error class and code only (no id, no name). The person stays `DELETION_PENDING` and is tried again next run. The batch goes on.
- `api/src/talk/engagement.service.ts` `report` (about line 530): the report transaction now locks the post first (an answer, or a reply's answer then the reply) before it touches the moderation items. This file is not one of the three you named; the check saw a report 500 in the three-way mix, and a report that updates the "reported" item and then the "priority" item could cross a moderator who holds both. Not wrapped in a retry.
- New `api/src/common/prisma/tx-retry.ts`: `withTxRetry` runs a transaction body again (at most 2 more tries, wait 20 to 100 ms at random) on Postgres 40P01 or 40001 (also Prisma P2034). Any other error is thrown at once. Used ONLY on `decide`, `act` and `purge`. In all three the body does nothing outside the database before the commit: the mail and the alert in `decide`, the mail in `act`, the ID-file purge and mail in `purge` all run after the commit. I did not wrap the report.

### What already followed the order (read, not changed)

- Edit (`posts.service.ts:641`) and Verified News request (`news/news.service.ts:359`): the post first, `FOR NO KEY UPDATE`. They touch no moderation item. (The edit's charge on a second connection is M4, not mine.)
- News flag (`news/news.service.ts` `flag`): report row, then the post counter. No moderation item, no cycle.
- Appeal filing (`engagement.service.ts`): item then appeal row, no post. No cycle with the above.
- Results posts (`results.service.ts`) use their own moderation item upsert on a result post, not an answer.

### What is left

- Items of a target that is not an answer or a reply (a person, a proposal, a result post, a DM): a report and a moderator can still take that target's "reported" and "priority" items in different orders. The moderator takes them by id ascending, the report in the order reported then priority. There is no post row to serialize on. I did not see this in the check and did not touch it.

### Proof (real HTTP, own Postgres 16, `log_lock_waits` on, `deadlock_timeout` 200 ms)

Spec `api/test/talk/rel-d2-lock-order.spec.ts`. One post per round with a like, a reaction, a reply, an open "reported" item, a news tag and (for edit and purge) a wallet with a ledger. The requests start together (0 to 6 ms apart). A purge is the service call, because it is a job and not a route. After each mix: like, reaction, reply and flag counts equal the rows, every ledger transaction sums to zero, every wallet equals its ledger.

With 200 rounds each (`D2_ROUNDS=200`), on this branch:

| mix | 500s | deadlocks | checks failed |
|---|---|---|---|
| decide + remove | 0 | 0 | 0 |
| decide + remove + edit | 0 | 0 | 0 |
| decide + remove + report | 0 | 0 | 0 |
| decide + purge | 0 | 0 | 0 |
| remove + purge | 0 | 0 | 0 |
| purge + remove + decide | 0 | 0 | 0 |

"deadlock detected" in the Postgres log: 115 before the run, 115 after (0 new). The retry never fired, so 0 is from the order alone, before any retry.

The same spec on clean `origin/main` (60 rounds each, requests 0 to 6 ms apart): decide + remove 28 x 500 (23 decide, 5 remove) and 26 deadlocks; decide + remove + edit 14 x 500 (8 remove, 3 decide, 3 edit) and 15 deadlocks. The other four mixes gave 0 or 1 deadlock on main in my setup. I could NOT reproduce the check's purge and report 500s (152 of 200 purges in "remove + purge") on main with this harness, so for the purge and the report path my proof is the lock-order tests below and the 0 on this branch, not a before-and-after number.

The suite keeps 20 rounds of each mix (about 30 s). It asserts counts only: 0 x 500, the checks above, and 0 new deadlocks in `pg_stat_database`. No test waits a fixed time to decide anything.

Four order tests (no timing, no luck): one connection holds a row, the action starts, and a second connection asks `NOWAIT` which locks the action holds while it waits. They show: a moderator's action holds the post while waiting for the item; an editor's decision holds the post with `FOR NO KEY UPDATE` (a `FOR KEY SHARE` still gets through) while waiting for the item; a purge waiting for a post does not yet hold the person's row; a report holds the post while waiting for the item. All four fail on `origin/main`.

## M2: an admin post twice across pages

- `api/src/feed/cursor.ts`: `encodeCursor` can carry the ids of the admin-first block (`a`); `decodeCursorFull` reads them; `pageOf` passes them on. A cursor without `a` is read exactly as before (no 400).
- `api/src/feed/feed.service.ts` (about lines 988 to 1050): page 1 builds the block (at most `ADMIN_FIRST_CAP` = 20, named only) and puts its ids in every next cursor. Later pages leave out exactly those ids. An admin who posts, or whose post is removed, after page 1 neither pushes a post out of the block into the list nor loses one. An old cursor falls back to the old rule.
- Also in `feed.service.ts`: the page query no longer uses Prisma's `skip: 1` after the cursor. When the cursor's own post had been taken down after the page was served, `skip: 1` dropped the next real post (this is what lost an item in my first test). The cursor row is dropped only if it is still the first row.
- `api/src/talk/posts.service.ts` `listReplies` (about lines 1011 to 1085): the cursor gets a third part with the block's ids. Two-part cursors still work.

Spec `api/test/talk/rel-d2-admin-walk.spec.ts`: 24 named admin answers (more than the cap), one nameless, 30 ordinary; pages of 7 under NEW, TOP and DEBATED; an admin posts between every pair of pages, and separately a post is taken down between pages: 0 duplicates, 0 missing (except the one taken down). Same for replies, and a reply posted after page 1 shows up. Old-format cursors still answer 200. Nameless admin answers stay out of the block. On `origin/main` the six answer walks fail and the reply walks pass (the reply case I could not make fail on main except for the lost new reply, which the new assertion checks).

## M3: pick-one-word picture

- `api/src/reach/share.service.ts` `cardSpecFor` (line 114): `pick` is set only when the question has at least one word choice.
- `api/src/reach/card-renderer.ts` `render` (line 412): the pick layout is drawn only when `pick.words` is not empty. Belt and braces; `pickSvg` itself is untouched, so the existing pick specs are unchanged.
- Spec `api/test/reach/rel-d2-pick.spec.ts`: for a question with no words the spec has no pick part; the picture bytes equal the plain question card (also when a spec carries an empty pick part); with words it still differs. Fails on main.
- The record screen itself (the pick-one-word screen in the app) is not touched.

## L2, L3

- L2: `api/src/media/media.controller.ts`: the purpose check is now a small validator that lists `DM` only while `DMS_LIVE` is on. With DMs off, `DM` and `NOPE` give the same 422 with the same details, and neither names DM. With DMs on the list names DM as before.
- L3: `api/src/talk/engagement.service.ts` `report` (DM case, line 477): with DMs off a report on a DM answers the plain 404 and nothing is written (no report, no moderation item).
- Spec `api/test/dm/rel-d2-dm-off.spec.ts`. Fails on main.

## Could not prove

- The check's purge and report 500s on `origin/main` (see above): no before-number for them from my harness.
- Residual order gap for non-post targets (above).
- A real production-size data set; anything live.

## M4: a paid edit holds one connection (added by the lead through the scheduled routine at 19:01)

Merged `origin/main` (a818f92, #31) into the branch first (a normal merge, no conflicts); `spendThen`, `reverseCharge` and the sweeper are untouched.

- `api/src/units/units.ledger.ts`: `charge` takes an optional last argument `join` (`{ tx, plan }`). With it the charge runs on the caller's transaction and commits or rolls back with it. Without it, it opens its own transaction exactly as before. New `prepareCharge()` reads, on the shared pool, the config numbers a charge needs (`costOf` was split into `loadCostInputs` and a pure `costFrom`; `costOf` still does both for the other callers). This matters: the config read is a database query, so without it a joined charge would still ask the pool for a second connection.
- `api/src/units/units.port.ts`, `units.service.ts`, `api/src/talk/shared/units-access.ts`: the same optional argument and `prepareCharge` pass through the port.
- `api/src/talk/posts.service.ts` `editAnswerInSlot`: reads the plan before the transaction opens, then charges with `{ tx, plan }` after the post row lock. Lock order: post row, then wallet row. The two refund calls (a failed write, a failed commit) are gone, because the charge now goes with the rolled-back edit; there is nothing outside the transaction left to give back. The create path (`spendThen`) is not touched.
- Wallet versus post: I read every holder of a wallet row. `charge` and `reverseCharge` touch the wallet, ledger, charge, usage and allowance rows, never an answer. The purge held the person's row and the wallet and then took the answers (the reverse of an edit); my H2 change in `deletion.service.ts` now takes the answers first, so that path follows post then wallet too. No path holds a wallet row and then waits for a post row.
- Proof, `api/test/talk/rel-d2-pool.spec.ts`: pool 4 with 8 edits of 8 different posts, and pool 3 with 10 edits, all at once (one author per run has an empty wallet). Every answer is 200 except the poor one, which is a clean 402; 0 x 500, 0 x 503. Ledger: every transaction sums to zero, every wallet equals its ledger, exactly one edit charge per paying author. Both runs fail on clean main (the check's 500s). 

### Two existing tests now fail because of M4 (not edited)

`test/talk/fixb-r4-edit.spec.ts`: "only reversal left: a write that fails after this call's own charge gives it back, ..." (line 290) and "round 6 > R5-2: a write that fails after its charge leaves the stored length as it was, with the reversal" (line 728). Both expect a `REVERSED` charge row after a failed write. With the charge on the edit's own transaction there is no charge row left at all (the balance still equals the start, the stored text and length are unchanged, and the retry pays once). This is the new behaviour the lead asked for ("a failed edit then rolls its charge back with it"), but the two assertions encode the old one. I did not change them. They need a ruling: expect no charge row instead of one `REVERSED` row. The other 23 tests in `fixb-r4-edit.spec.ts` and `lock-no-key.spec.ts` pass; I did not manage ten runs in a row for them (see below).

## Suite totals

Tooling: `tsc --noEmit` clean; eslint (no `--fix`) 0 errors on every touched file (a few "unused disable" style warnings only).

New specs (all pass on this branch): `test/talk/rel-d2-lock-order.spec.ts` (6 mixes x 20 rounds plus 4 order tests, about 30 s), `test/talk/rel-d2-admin-walk.spec.ts`, `test/talk/rel-d2-pool.spec.ts`, `test/reach/rel-d2-pick.spec.ts`, `test/dm/rel-d2-dm-off.spec.ts`.

Full `npm test`, run 1 (before the merge and M4): 149 suites, 148 passed; 2,439 tests, 2,436 passed, 2 failed, 1 skipped. The one failing suite was `test/shared/shared2.spec.ts` (2 tests): my lock-order spec left moderation rows that pushed its rows off the list's first page. It passes alone on clean main and on this branch; the spec now cleans up (fixed). `npm run test:audio`: 13 of 13.

Full `npm test`, run 2 (after the merge and M4): 155 suites, 153 passed; 2,489 tests, 2,485 passed, 3 failed, 1 skipped. The failures:
1. and 2. `test/talk/fixb-r4-edit.spec.ts` lines 290 and 728: the two M4 tests above. They pass on clean main and fail on this branch by design; they need a ruling.
3. `test/talk/hotfix1-block-oracle.spec.ts` "the nameless answer reads the same for V ...": failed in the full run only (it passes alone, 2 of 2 runs, and passes on clean main). The cause was my `rel-d2-admin-walk.spec.ts` leaving answers with rank scores of 1000 that crowded the trending feed. That spec now deletes its rows; the two specs pass together. I did not run the whole suite a third time, so that is checked in a pair only.
`test:audio` did not run after run 2 (jest returned non-zero, so the chain stopped); it passed 13 of 13 in run 1 and nothing it covers was touched.

Not done: ten runs in a row of `fixb-r4-edit.spec.ts` and `lock-no-key.spec.ts` (the first run showed the two intended failures, so I stopped the loop).
