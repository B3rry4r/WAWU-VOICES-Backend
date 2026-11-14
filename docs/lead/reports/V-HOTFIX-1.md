# V-HOTFIX-1: three live faults

Branch `v/hotfix-1` from `origin/main` (755aa15). Code under `api/`. No migration. No route, response field or config key renamed or retyped; one config key added.

## Fault 1: "also block" on a nameless post

Rule as built: on a post made without a name, a report is recorded exactly as before, no Block row is created, the response says `blocked: false`. A named post blocks as before.

- `api/src/talk/engagement.service.ts:435-448` and `:585`: the ANSWER case sets `nameless` from `answer.anonymous`; `alsoBlock` only blocks when `!nameless`.
- Other places a block can be created: only `PUT /me/blocks/:userId` (by person id, `me/blocks.ts` `block`) and this report path. Shares, notifications and replies create none. A Reply has no `anonymous` flag on this model, so the REPLY case is unchanged; when the flag is added, set `nameless` from it there (comment in place).
- Spec: `test/talk/hotfix1-block-report.spec.ts` (3 tests): block list unchanged, no Block row, report and moderation item present, second report 409; a named post still blocks.

## Fault 2: block / unblock as a test that names the writer

Rule as built: a nameless answer is shown or hidden the same for every viewer whatever blocks exist either way. Blocks never filter it, never change a count that includes it, and never suppress or reveal a notice about it. One helper set in `api/src/me/blocks.ts`: `blockHidesAuthorOf`, `answerNotBlocked`, `answerNotBlockedSql`, `answerAuthorVisible`, `replyNotBlocked`.

Every read path found and changed:
1. `talk/posts.service.ts` `visibleAnswer` (answer by id / direct link 404).
2. `talk/posts.service.ts` `getAnswer` reply count recount (via `replyNotBlocked`).
3. `talk/posts.service.ts` `createReply` block 404 checks (skipped for a nameless answer).
4. `talk/posts.service.ts` reply notice and reply mail to the answer's author (not suppressed for a nameless answer).
5. `talk/posts.service.ts` `listReplies` and `stanceCounts` (through `replyNotBlocked`; replies are named, behaviour unchanged).
6. `talk/engagement.service.ts` `publishedAnswer` (like, react, save, helpful 404).
7. `talk/engagement.service.ts` reaction notice fold to the author.
8. `talk/engagement.service.ts` `listen` (play report 404).
9. `feed/feed.service.ts` `answerWhere` (question answers list, trending answers, category lists, counts built on it).
10. `feed/feed.service.ts` search raw SQL (answers, totals).
11. `feed/ranking.service.ts` `person` (rank score and so trending order no longer move with a block on a nameless answer).
12. `news/news.service.ts` list and get.
13. `me/people.service.ts` saved answers (`answerAuthorVisible`).
14. `reach/reach.service.ts` `render` (reply notices; also feeds `unread`): a notice about a reply on a nameless answer is served, the blocked replier shown as "Someone".

Looked at and left unchanged (not about a nameless post): `visibleUser` on a person's page and lists of a person's replies (about the person, replies are named), `faces`/`recentVoices` (already `anonymous: false`), results posts (no anonymous flag), invites, proposals.

Spec: `test/talk/hotfix1-block-oracle.spec.ts` (4 tests). 13 routes captured for V (home, question, answers NEW/TRENDING/DEBATED, trending, new, search x2, news, answer, replies, replies by stance); identical before, after V blocks W, after W blocks V, after both, after unblock. A named post by W still vanishes. Replies to the nameless answer succeed and notices are served under blocks both ways. Rank score unchanged when W blocks a liker. Confirmed failing when the helpers ignore `anonymous`.

## Fault 3: expired key refunds a posted answer

Rule as built: a reversal only undoes a charge this request created. If the charge existed before the request asked for it, it is never reversed. If its post is stored, that post is returned and nothing is written, charged, reversed, given back, notified or mailed. If the same charge is sent with other content and it belongs to a stored post, 409 `IDEMPOTENCY_KEY_REUSED`.

- `talk/posts.service.ts` `spendThen` (about `:120-175`): pre-reads the charge row; `replayed = !!prior`; `find` callbacks in `createAnswer` and `createReply`; after a successful write the charge gets `refType/refId` (existing columns).
- Stored post lookup: by `refId` plus content, else for old charges by clip, or author + target + same text since the charge time.
- Retention: `talk/talk.controller.ts` passes 8 days for answers and replies; config key `idempotency.post_keep_days` (default 8, `talk/shared/config-reader.ts`, `admin/config-catalogue.ts`). Other routes keep 24 hours. Note added to `docs/contract/CONVENTIONS.md`; `openapi.yaml` regenerated output is byte-identical (unchanged).
- Specs: `test/talk/hotfix1-money.spec.ts` (9 tests): paid voice replay x3 (balance, ledger, one answer), free post, old charge without link, different body refused after expiry, honest reversal once, six at once, different clip refused (before and after expiry), 8 days and config override, reply replay. 6 of 9 fail with the fix disabled.

## Existing specs changed

None. (My first attempt added a `replayed` field to the units port result and broke `test/units/ledger.spec.ts` "same key twice"; I removed the field, the spec is unchanged.)

## Runs (own Postgres 16 on 55432, Redis on 56379)

- `npx tsc --noEmit`: exit 0.
- eslint on `src` and the new specs: 0 errors, 4 warnings, all in existing files.
- New specs: report 3/3, oracle 4/4, money 9/9.
- `test/talk test/units test/me test/reach test/feed test/privacy`: 54 suites, 598 passed, 1 skipped, 0 failed.
- Full API suite (`jest --runInBand`): 103 suites, 1160 passed, 1 skipped, 0 failed. `npm run test:audio` not run.
- Contract: `build.py` output identical to `openapi.yaml`.

## Choices

- Nameless reply notice for a blocked replier is served with "Someone replied" (safest: no reveal, no suppression).
- A nameless answer replied to by someone the writer blocked now accepts the reply and notifies the writer (the rule says blocks never change it).
- Stored post deleted by its author: 404.
- Replay of a charge with no stored post (crash or very old charge): the write goes on under that charge and a failure leaves it alone (never reversed).
- Reply side: no flag exists, so replies still follow blocks.

## Not done / residual

- Old charges without `refId` are matched by content and time; a same-key replay with other content against an unlinked old charge still writes under that charge.
- If the question is closed when an expired key is replayed, the closed-question 409 comes before the stored-post lookup.
- `build.py` parameter text still says "24 hours".
- `test:audio` not run.

# Round 2

## Findings fixed

- **BLOCKER 1** (`GET /people/{userId}/replies`): `api/src/me/people.service.ts` `listPersonReplies` (the `answer:` filter, was `author: visibleUser(viewer.userId)`) now spreads `answerAuthorVisible(viewer.userId)`, the helper round 1 used for the saved list. A reply on a nameless answer is listed whatever blocks exist; the writer's account status still applies. A named answer still follows the blocks.
- **Found by the audit below** (not in the checker's list): `api/src/reach/reach.service.ts` `render`, the REACTIONS notice. It dropped a blocked reactor from the count and suppressed the notice when every reactor was blocked, also when the answer is nameless. Now, on a nameless answer: the count keeps every reactor, the notice is never dropped, and a blocked reactor is not named ("Someone ..."). `anonymous` is now selected on the answers read there.

## Every place in `api/src` that filters, counts or joins by the viewer's blocks

"Nameless path?" = can a nameless post, or anything attached to it, pass through it.

| Place | What it does | Nameless path? | Done |
|---|---|---|---|
| `me/blocks.ts` `visibleUser` | author relation filter (status + both block directions) | yes, if used on an answer author | callers below; `answerAuthorVisible` is the nameless-safe form |
| `me/blocks.ts` `hiddenUserIdsOf`, `BlocksService.hiddenUserIds/isBlockedEitherWay/assertCanInteract` | lists people hidden | only via callers | callers below. `assertCanInteract` and `isBlockedEitherWay` have no caller in `src` outside `blocks.ts` (grep) |
| `me/blocks.ts` `answerNotBlocked`, `answerNotBlockedSql`, `blockHidesAuthorOf`, `answerAuthorVisible` | the round 1 helpers, nameless exempt | exempt | none needed |
| `me/blocks.ts` `replyNotBlocked` | drops replies by hidden people | a reply is a named post (no flag on replies); it hangs on the nameless answer | left as on main: a named reply by a blocked person leaves the blocker's thread and count. Rule 2 is about a post made without a name; the reply names its writer |
| `me/people.service.ts:146` replies list | answer author filter | **yes** | **fixed** (above) |
| `me/people.service.ts:211` saved list | `answerAuthorVisible` | exempt | none |
| `me/people.service.ts:47-59` `visiblePerson` | person page 404 / "blocked by me" | no (about a person; their page never lists a nameless answer, checked in the crawl) | none |
| `me/people.service.ts:288` block list | the viewer's own blocks | no | none |
| `me/views.ts:384` faces on a question | `visibleUser` on answers with `anonymous: false` | no, nameless excluded by the query | none |
| `me/invite.service.ts:48,187` | inviter counts friends not blocked; needs a named answer | no, nameless answers never count (ruling LC) | none |
| `me/deletion.service.ts:428` | deletes blocks of a deleted account | no | none |
| `feed/feed.service.ts:48` viewer filter, `:1059` search SQL | `answerNotBlocked` / `answerNotBlockedSql` | exempt | none |
| `feed/feed.service.ts:1067` people search | drops blocked people from people results | no (people, not posts) | none |
| `feed/present.ts:111` question faces | filters blocked authors from the faces | no, faces are named answers only | none |
| `feed/ranking.service.ts:48` `person` | block anti-manipulation guard on score signals | yes | exempt for a nameless answer (round 1) |
| `news/news.service.ts:168,205` | `answerNotBlocked` | exempt | none |
| `results/actor.service.ts:69` `blockedEitherWay`, `results/results.service.ts:285` | filters result-thread posts | no: `ResultPost` has no `anonymous` and is not an answer | none |
| `reach/reach.service.ts:234,430` | notification list and unread count | yes | REPLY exempt (round 1); REACTIONS **fixed** (above) |
| `vote/proposal.service.ts:412,427` | notice to the author of an improved proposal | no (proposals, named) | none |
| `talk/posts.service.ts:369` `visibleAnswer` | 404 by direct link | exempt | none |
| `talk/posts.service.ts:382` `getAnswer` reply count | counts replies the viewer can see | counts named replies, not the answer | as on main (named replies) |
| `talk/posts.service.ts:523-536` | reply gate | exempt when `anonymous` (round 1) | none |
| `talk/posts.service.ts:619,634` | notices after a reply / report | exempt | none |
| `talk/posts.service.ts:713,719,768` reply list and stance counts | named replies | as above | as on main |
| `talk/engagement.service.ts:63,228,385` | like / react / save / listen gates and notices | exempt via `blockHidesAuthorOf` | none |
| `talk/engagement.service.ts:586` report `alsoBlock` | makes a Block | exempt for a nameless post (rule 1) | none |

What a nameless post's replies, reactions, saves, reports, notices, share links, mood, listens and counts go through: replies (named, follow blocks like any named post), reactions and likes (gates exempt; the REACTIONS notice fixed), saves (list exempt), reports (no Block row), notices (REPLY and REACTIONS exempt), share links (no block filter in `reach/share*`; crawled), mood (no block filter in `src/mood`, read), listens (gate exempt), counts in feeds, search, question lists (exempt, crawled).

## The crawl spec

`api/test/talk/hotfix1-crawl.spec.ts` (3 tests). A nameless answer on one question and a named answer by the same writer on another; two named replies, saves and likes on the nameless one. 5 viewers (V who blocks, neighbour X, replier R, writer W, a guest) read 36 GET routes of `docs/contract/openapi.yaml` that can carry a post or a count (my answers, saved, person pages and replies, questions and today, the question's answers in each sort, feeds, search, news, answer, replies by stance, where-you-sit, card, videos, moods, polls, what-next, notifications, unread count, share page, friends, invite, weekly report) in 8 or more states: before, V/X/R blocks W and unblocks, W blocks V/X and both ways, cleared. Every response must equal the baseline (status and body; clock fields and page markers masked). Test 2: the named answer is 200, then 404 for the blocked pair only, still shown to others and guest, back after unblock. Test 3: the REACTIONS notice about the nameless answer keeps its count and stays when W blocks or is blocked by a reactor. Where R and W block each other, R's own named reply and person page legitimately leave the thread of that pair; the pair's snapshots are skipped, all other viewers are still compared. Home, today, moods, where-you-sit, card, videos and news detail answer 404 in this setup (no scheduled topic, no card storage): compared as the same 404, not exercised with data. Mutation checks: with the people fix reverted, test 1 fails; with the reach fix reverted, test 3 fails.

## Runs (own Postgres 16 on 5544, Redis on 6390; both stopped at the end)

- `npx tsc --noEmit`: exit 0.
- eslint on `people.service.ts`, `reach.service.ts`, `hotfix1-crawl.spec.ts`: 0 errors, 0 warnings.
- `test/talk/hotfix1*` (7 suites, includes round 3 specs from the other session): 32 passed, 0 failed.
- Crawl spec alone: 3 of 3 passed.
- `test/talk test/me test/reach test/feed test/privacy`: 52 suites, 499 passed, 1 skipped, 0 failed.
- Full API suite (`jest --runInBand`): 107 suites, 1176 passed, 1 skipped, 0 failed. `npm run test:audio` not run.

## Existing specs changed

None changed by me in round 2. (`hotfix1-block-oracle.spec.ts` was edited by the other session in round 3, not by me.)

## Choices

- A reply is a named post: replies by a person hidden from the viewer still leave that viewer's thread, list and counts, as on main. They are not "a post made without a name"; when replies get a nameless flag only `replyNotBlocked` and `blockHidesAuthorOf` change.
- A blocked reactor on a nameless answer is counted but not named (privacy first), for the writer.

## Not done

- Checker LOW 4 / MEDIUM 2 / MEDIUM 3 were left to the other session (round 3 commits touch them); not re-run by me.
- Home, today, moods, where-you-sit, card, videos and news detail were 404 in the crawl's setup, so they are compared as the same 404 only.
- `npm run test:audio` not run. The Prisma client was generated locally (`prisma generate`, gitignored output).

# Round 3

Migration: none. Added on top of round 2; every route outside these cases answers as before. Commits carry `[skip ci]`.

## 1. MEDIUM 2: sweeper for post charges that paid for nothing
- `api/src/talk/charge-sweeper.service.ts` (new, registered in `talk.module.ts`; `shared/units-access.ts` gets `reverseCharge`, which returns whether this call did the undo). Same style as `listen-retention.service.ts`: `setInterval` every 10 minutes (`CHARGE_SWEEP_INTERVAL_MS` overrides), off when `NODE_ENV=test`, `unref`ed, `sweep(now)` callable.
- A charge is swept when: POST_TEXT/POST_VOICE, `COMMITTED`, older than 10 minutes, no older than 30 days, `refId` null, and all of:
  - **No stored post.** `spendThen` writes `refType/refId` onto the charge right after the post is stored, so a charge that belongs to a stored post has `refId`, and stays untouched even if the post was later deleted by its author or removed by a moderator (those rows still exist, and the charge keeps its link). For charges with no link (made before the link existed, or a link that failed to save) the job also looks for an answer or reply of the same kind by the same person created from the charge time to 10 minutes after it; one found means the post is stored.
  - **None in flight.** No unfinished idempotency record (`completedAt` null) for the same person and key younger than 30 minutes.
- Why it cannot be wrong for a slow request still running: the post is written seconds after the charge and the HTTP request ends within 5 minutes, so at 10 minutes the request is over. A retry of the same key creates a fresh unfinished record, which blocks the sweep for 30 minutes. The candidate is also re-checked by id right before its reversal.
- Reversal is the ledger's `reverse` (wallet row lock, one REVERSAL, second call returns `reversed:false`; a used free post is given back in the same call). Three sweeps at once reverse once.
- Spec `test/talk/hotfix1-sweeper.spec.ts` (7): crash after charge + failing retry (balance back, ledger sum 0, one REVERSAL); free post returned once; stored post left alone; author-deleted and moderator-removed post charges left alone; old unlinked charge with a stored post left alone; 9-minute-old and in-flight left alone (swept later); three at once.

## 2. MEDIUM 3: deleted post's text leaves the retry record
- `api/src/common/idempotency-clear.ts` (new): on delete or removal, the record of the request that made the post (matched by actor and `responseBody.answer.id` / `.reply.id`) gets the body `{"gone":true}`; the record stays. Called from `posts.service.ts` `deleteAnswer` / `deleteReply` and `admin/trust/moderation.service.ts` `setContentStatus` (REMOVED, answers and replies), all in the same transaction. Account deletion already clears records.
- `talk/shared/idempotency.service.ts`: a replay (or a wait on an in-flight one) of a cleared record answers 404 `NOT_FOUND`. Nothing is charged or reversed. Other post-creating routes that use this service store no post text.
- Spec `test/talk/hotfix1-gone-record.spec.ts` (4): author delete, moderator removal, deleted reply (record has no text; replay 404; balance, charges, reversals, answers unchanged), untouched post still replays 201.

## 3. LOW 4
- `Report.alsoBlocked` is `alsoBlock && author && !nameless` (`talk/engagement.service.ts:532`). Spec `hotfix1-r3-notice.spec.ts`.
- `posts.service.ts` `createReply`: no reply notice and no mail to the writer when the replier is hidden from the writer by a block either way (the writer's own list leaves that reply out). Only a nameless answer can reach this, since a named one 404s earlier. Spec: two worlds (W blocks B or not); W's notices, unread and reply list are 0 against 1; X's and B's answer, replies, notifications and unread responses are identical in both worlds.
- Contract text: `docs/contract/src/build.py:66` says "(8 days on posting an answer or a reply)"; `openapi.yaml` regenerated with `build.py`.
- Closed-question order left as is (closed-question 409 before the stored-post lookup); not changed.

## Specs changed
- `hotfix1-block-oracle.spec.ts`, test "replying to the nameless answer…": old: W blocks V, V replies → W's REPLY notices start+2, unread +2, then +3 after V blocks W. New: the same steps keep start+1 and unread +1 (the blocked replier's reply sends W nothing). Title adjusted.
- `hotfix1-crawl.spec.ts`: lint only (prettier, unused parameter renamed); no assertion changed.

## Choices
- A sweep misses a charge whose post was created more than 10 minutes after it and whose link failed to save (money stays with the person's post; never the other way round).
- Records of removed posts answer 404 inside the window, the same as a deleted one, and stay so if the post is restored.

## Runs (own Postgres 16 on 55433, Redis on 56380; both stopped afterwards)
- `npx tsc --noEmit`: exit 0 (also after merging the other session's last commit 662d1e3).
- eslint on `src/talk`, the new files, `moderation.service.ts` and `test/talk/hotfix1-*.spec.ts`: 0 errors.
- Round 3 specs: sweeper 7/7, gone-record 4/4, notice 2/2; oracle 4/4 and crawl pass.
- `test/talk test/units test/me test/reach test/admin test/privacy` (one run, `-i`): 78 suites, 815 passed, 1 skipped, 0 failed, on the DB the hotfix specs had already used. That run showed `hotfix1-block-oracle.spec.ts` failing (3 tests) when it ran after other specs left rows behind (a global list cursor moved); the same spec fails the same way on round 2's code (89e04a5) on such a database, and passes on a fresh one. So I dropped the database and re-ran everything on a fresh one.
- Full API suite, `jest --runInBand`, fresh database: 107 suites passed, 0 failed; 1177 tests: 1176 passed, 1 skipped. It started before I merged the other session's `reach.service.ts` commit; after the merge I re-ran `test/reach` and `test/talk/hotfix1*`: 19 suites, 139 passed, 1 skipped, 0 failed. `test:audio` not run.
- Contract: `build.py` output is what is committed in `openapi.yaml`.

## Not done
- Closed-question order left as is (asked).
- Round 2's oracle spec is order-fragile on a database that other specs have filled (see above); not changed.

# Round 4

Code under `api/`. Migration `20261114220000_hotfix_1` (with `rollback.down.sql`). Contract regenerated (`build.py` output compared with `cmp`: identical). Commits carry `[skip ci]`. Nothing merged in from another branch.

## The rulings and what built them

1. **Sweeper by link and start time, no content matching.** `api/src/talk/charge-sweeper.service.ts` (page query `page()`, guard in `sweep()`): a charge is an orphan when it is POST_TEXT or POST_VOICE (text or voice answer, reply), `COMMITTED`, `refId` null, made after `ChargeSweeperState.startAt`, older than 30 minutes, and no unfinished retry record younger than 30 minutes exists for the same person and key. The "another post by the same person" rule and every look at `Answer`/`Reply` rows are gone. The reversal is the ledger's own and gives the free post back once when the charge used one.
   - **Start time: a one-row table `ChargeSweeperState` (`id` = 1 by a CHECK, `startAt`)**, created and filled with `now()` (UTC) by the migration, i.e. the moment it is applied (`prisma/migrations/20261114220000_hotfix_1/migration.sql`, model in `schema.prisma`). A config row was not used: the admin config screen lists every `ConfigEntry`. With no row at all, nothing is read (the query compares with a null): tested.
2. **30 minutes, not 10** (`SWEEP_MIN_AGE_MS`, `DEAD_RECORD_MS`, charge-sweeper.service.ts:12,14, its comments, the contract text of the `Idempotency-Key` parameter, this report). The job itself still runs every 10 minutes.
3. **Dead retry records.** A record unfinished for more than 30 minutes is dead.
   - When the sweeper reverses a charge it deletes that request's dead unfinished record **in the same transaction**: the guard runs inside the ledger's reversing transaction after the wallet row is locked (`units.ledger.ts:434` `reverseGuarded`, the call at `:461`; also `units.port.ts` `ReverseGuard`, `units.service.ts`, `talk/shared/units-access.ts`). It re-checks the conditions there, deletes the record, then the ledger reverses. If the reversal throws, the record deletion rolls back with it. A retry with the same key then reaches the ledger and is answered at once with the existing 409 `CONFLICT` "Start again with a new key"; a retry that arrives while the guard runs waits on the wallet lock and sees either the committed charge (guard said no) or the reversed one.
   - `clearDeadRecords` (same file) also deletes dead unfinished records of post requests (`POST` on a path ending `/answers` or `/replies`) that never charged, or whose charge is linked or already reversed, so the retry simply runs. A record younger than 30 minutes is never touched. Choice: this cleanup also runs when a reversal failed (ledger down): the retry then reaches the ledger and posts under the old charge once (spec).
4. **Replay of a removed post.** `posts.service.ts:343` (answer): a replay that finds its stored answer `REMOVED` (as for `DELETED_BY_AUTHOR`) answers 404; the thrown error makes the retry record go, so nothing is stored, inside the window and after expiry. Reply, `posts.service.ts:624`: **found by my spec, not by the checker: after expiry a replay of a reply removed by a moderator answered 201 with the removed text and stored it again, the same hole.** It now answers 403 `CONTENT_REMOVED` (the answer the ruling names), no text, nothing stored. (The checker's 403 for replies was the case where the parent answer is removed: unchanged, `:518`.) Restore: the record stays gone inside its window (as in round 3); after expiry the replay returns the post (spec).
5. **Partial index and a failing candidate.** Migration: `Charge_sweep_idx` on `Charge("createdAt","id") WHERE status='COMMITTED' AND "refId" IS NULL AND action IN ('POST_TEXT','POST_VOICE')`, and `IdempotencyRecord_unfinished_idx` on `("createdAt") WHERE "completedAt" IS NULL` (for the dead-record removal and the in-flight check). The read pages by `(createdAt, id)` keyset, 200 a page, at most 50 pages a pass, so a candidate that throws (logged, remembered for 60 minutes by that instance) never blocks the ones behind it, in this pass or the next.
6. **Left as it is:** LOW 4d (a closed question answers 409 before the stored-post lookup); the writer of a nameless answer replying under it under their own name (another task owns replies without a name).

## Query plan (own Postgres 16, 500,599 `Charge` rows: 400,000 old unlinked from before the start time, 99,000 new linked, 800 reactions, 200 orphans of 9 days; 99,050 retry records)

```
Limit  (actual time=11.896..11.966 rows=200)
  InitPlan: Index Scan using "ChargeSweeperState_pkey"
  ->  Nested Loop Anti Join
        ->  Index Scan using "Charge_sweep_idx" on "Charge" c (actual time=11.868..11.892 rows=200)
              Index Cond: (createdAt > $0) AND (createdAt < now-30min) AND (ROW(createdAt,id) > ROW(...))
        ->  Index Scan using "IdempotencyRecord_unfinished_idx" on "IdempotencyRecord" i (rows=0)
Execution Time: 12.006 ms      (first, cold run 26.1 ms; the empty last page 0.11 ms)
```
Round 2's measurement for the old query was 608 ms. The 400,000 pre-deploy charges are never read (they are before the index range).

## Specs added (all in `api/test/talk`)
- `hotfix1-r4-sweeper.spec.ts` (13 tests): the checker's MEDIUM 1 case (dead text charge, same person posts again within 5 minutes with a new key, at 31 minutes the dead charge is reversed once, ledger sum = wallet, the second keeps its charge); a charge made before the start time never reversed, 5 hours old and 90 days on the clock, with and without a matching post, and with no start-time row; MEDIUM 3 on both paths (answer, reply): record left unfinished, retry at 1 minute 409 `REQUEST_IN_PROGRESS` (waited the full 15 s, record untouched), after the sweep at 31 minutes the record is gone and the retry is 409 `CONFLICT` in under 3 s, balance back, ledger 0, no post, then a new key 201 charged once; a dead record that never charged removed and the retry runs, a 29-minute record and another route's old record stay; 29 minutes untouched then 31 swept; MEDIUM 4 for an answer (404 inside the window, 404 after expiry twice, no record, no text, nothing charged; restore, replay returns the post) and for a reply (404 inside, 403 `CONTENT_REMOVED` after expiry, record holds no text, balance and reply count unchanged); 250 candidates that throw ahead of 10 good ones (the 10 reversed in the first pass; a new one in the next pass; a fresh instance too); an instance that dies inside the reversal changes nothing (record deletion rolled back); a failing ledger still removes the dead record and the retry posts once under the old charge; five instances sweeping 30 dead charges at once, one dying after 5 (each reversed once, 15 REVERSAL rows for the 15 paid, free posts back once, record gone, 0 people wrong); the race, 200 of 200 (100 free, 100 paid): a request paused between charge and write with the charge aged 29.5 minutes and two sweeps 2 minutes later.
- `hotfix1-r4-chaos.spec.ts` (1 test, run 7 times): 500 mixed operations in 15-wide batches on 60 people (sends, replays, crashes, author deletes, moderator removals, sweeps with the clock moved), then two final sweeps. Per person: wallet = start - committed charges and ledger sum = wallet - start, free allowance consistent, REVERSAL rows exactly one per reversed paid charge and none otherwise, every post has a committed charge linked to it, no committed unlinked charge left, and no retry record holds the text of a deleted or removed post. 0 mismatches, 0 double reversals, 0 posts without a charge each run (about 260 sends, 90 to 100 crashes, 40 replays, 20 removals, 25 deletes, 50 sweeps per run).

## Specs changed, with old and new
`hotfix1-sweeper.spec.ts` (round 3 file; each change follows a ruling):
- beforeAll: new, sets the start time to 2000-01-01 (the specs back-date charges).
- Every age of 20 minutes became 31 (rule 30). Test "a charge 9 minutes old…" became "29 minutes old" (title and age 9 → 29); its comment "ten minutes more" became "two minutes more (31 minutes)".
- Test "an old charge from before the link existed, whose post is stored, is left alone" (old rule: the content match found the post and spared the charge; new rule: no content matching) was replaced by "an unlinked charge made before the start time is never reversed, with or without a matching post" (old: asserted COMMITTED because a post matched; new: asserts COMMITTED because the charge is older than the start time, with and without a post).
No other existing spec's assertion changed.

## Runs (own Postgres 16 on 55701, Redis on 56701, both stopped at the end)
- `npx tsc --noEmit`: exit 0. eslint on `src/talk`, the ledger/port/service files and `test/talk/hotfix1-*.spec.ts`: 0 errors; warnings only (unused eslint-disable lines in older hotfix specs).
- Hotfix specs, 9 suites, 46 tests: passed on a fresh database (twice; once in a combined run with the crawl and oracle). `hotfix1-r4-sweeper` alone: 13 of 13, three runs. Chaos: 7 of 7.
- Migration: a database migrated from the parent state (all earlier migrations) with 2,000 unlinked charges in it: migration applied (start-time row stamped, both indexes there, 2,000 charges untouched, the sweeper query finds 0 candidates), `rollback.down.sql` (table and both indexes gone, 2,000 charges still there), `_prisma_migrations` row removed, applied again (new, later start time, indexes back, 2,000 charges).
- Full API suite, fresh database, `jest --no-cache --runInBand`, Redis on: **109 suites passed, 0 failed; 1191 tests: 1190 passed, 1 skipped (`test/reach`), 0 failed.** (Before this last run, two full runs had failures that were not in code: see below.)

## Found on the way, fixed in my own specs
- A first full run had no `REDIS_URL` set to my Redis: `test/vote` failed on that alone; the rerun set it.
- My chaos spec, run before `hotfix1-block-oracle`, broke that spec's cursor comparison (the same order fragility round 3 noted: rows left in the global lists). My new specs now delete the answers, replies, moderation rows and question they made. Oracle and crawl pass after them.
- Two full runs failed sweeper specs (returned 0 reversals). Cause, found at the end: some other spec wipes tables, and the `ChargeSweeperState` row went with them; the sweeper then reads nothing (fails closed, as designed) and my specs' `UPDATE` hit 0 rows. The three sweeper specs now insert the row (`INSERT ... ON CONFLICT`) in beforeAll. In the same runs `hotfix1-crawl` failed once when another spec's "hello" answer sat in a global list: the order fragility round 3 already described, not touched by this round; it passed in the final run. In production the row is never wiped; if it were missing, the sweeper does nothing.
- A simulated clock jump while a request is in flight deletes its retry record (the request then answers 404 although it posted): only possible when the clock lies; the chaos spec moves the clock by at most 10 minutes next to running requests.

## Choices
- Deploy order matters: a charge made by OLD code after the migration is applied but before the new code runs is unlinked and after the start time. Apply the migration immediately before the release goes live (old and new instances overlapping for a few minutes would also leave unlinked charges from old instances in that window; the post exists, the charge would be reversed after 30 minutes and the person keeps the post free). The safe way is the lead's: apply the migration as the release starts, and stop old instances first.
- A post whose charge link failed to save (logged) is reversed after 30 minutes; the person keeps the post and the money comes back (never the other way round).
- No 30-day look-back any more (the start time bounds the read).
- A used free post comes back once, through the same ledger call.

## Not done
- LOW 4d and the nameless writer's self-reply: left as asked.
- `npm run test:audio` not run. No load above 500,599 charges.
