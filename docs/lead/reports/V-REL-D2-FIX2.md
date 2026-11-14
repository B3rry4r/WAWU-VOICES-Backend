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

## Suite totals

(see the end of this file, filled in after the last run)
