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

