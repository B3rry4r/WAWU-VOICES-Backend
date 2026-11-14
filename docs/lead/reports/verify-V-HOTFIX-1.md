Tested commit: dca514c373894c04ccba248b7ad026b1f8ad247c (origin/v/hotfix-1 at the end of my run; its code is identical to daeeab4e, which I tested first: the last builder commit only adds `docs/lead/reports/V-HOTFIX-1.md`). Compared against origin/main 4fa9d50 (`git worktree`, scratch).
VERDICT: FIX

Everything below says whether it came from a run ("RAN") or from reading ("READ"). My attack specs and scripts are not committed (kept under the scratchpad; copied into `api/test/talk` only while they ran, then removed).

# Findings

## BLOCKER 1. `GET /people/{userId}/replies` still drops a reply when the viewer and the answer's writer have a block between them, so block / unblock still names the writer of a nameless answer (rule 2)
- Code: `api/src/me/people.service.ts:146`: `answer: { status: PUBLISHED, author: visibleUser(viewer.userId) }`. The builder changed the saved-list path (`:208`, `answerAuthorVisible`) and wrote in its report that "lists of a person's replies" were "about the person, replies are named". The filter is on the answer's author, not the replier, so it is exactly the nameless answer's writer being tested.
- RAN (crawl spec, branch): writer W posts a nameless answer; R replies (named); viewer reads `GET /people/{R}/replies` → 1 item. The viewer `PUT /me/blocks/{W}` → the same route returns 0 items. `DELETE` the block → 1 again. The same happens when W blocks the viewer, for viewers V (member), X (neighbour) and R. A guest cannot block, so nothing changes there. Anyone who suspects a person: block them, read R's reply list, and unblock. The reply stays only if the suspect is not the writer. Two cheap calls per suspect.
- RAN (control, same spec on origin/main): block / unblock changes `/answers/{id}`, both reply lists, the question's answer list in TOP / NEW / DEBATED, search, `/people/{R}/replies` and `/me/saved` for the nameless answer. On the branch every one of those is now identical except `/people/{R}/replies` (and `/me/blocks`, the viewer's own list, expected). For the named answer the branch changes all of them as main does (expected).
- Should: a reply under a nameless answer shows the same whatever blocks exist between viewer and the answer's author (answer status and the author's account status still apply as for everyone). Use `answerAuthorVisible`-style logic in that query. The builder's specs never request this route, so none fails.

## MEDIUM 2. A charge from a request that died after charging is never refunded when the retry also fails (rule 3 as built; old behaviour refunded)
- Code: `api/src/talk/posts.service.ts` `spendThen` (`replayed` → log only, no reverse).
- RAN (branch vs main, same spec): paid voice answer charged (78 000), then I simulated a crash after the charge (answer row and idempotency record deleted, `Charge.refType/refId` null); the clip was attached to another post so the retry's write fails. Retry → 409 on both. Main: charge `REVERSED`, balance 500 000 (refunded). Branch: charge stays `COMMITTED`, balance 422 000, no post under it. The builder lists this as a choice ("a failure leaves it alone"). It follows the rule as written, but a person who paid and got nothing has no automatic way back. Needs an owner decision (a sweeper for COMMITTED post charges with no `refId` older than the key life, or reverse when the charge has no stored post). Also: the same retry with other content writes under the old charge, priced for the old content (builder lists it; not exploitable without a crash).

## MEDIUM 3. Post text stays replayable for 8 days after the author deletes it or a moderator removes it
- RAN: answer posted, then deleted by its author. Inside the 8-day record the same key + body returns `201` with the original body (status `PUBLISHED`, the text) and `Idempotent-Replay: true`. After the record expires: `404 NOT_FOUND`, no post, no charge, no refund (balance and ledger unchanged, 1 charge). Removed by moderation (status REMOVED): inside the record the same stale 201; after expiry `201` with the stored post's view, `status: "REMOVED"`; nothing charged or reversed.
- Meaning: the stored response (`IdempotencyRecord.responseBody`, ~1.2 KB avg per voice/short-text row here) holds the text of a post the person deleted for 8 days instead of 1 (account deletion does clear them: `deletion.service.ts:408`, READ). Check this against the privacy wording on deleting a post. Not a leak to other people.

## LOW 4. Smaller points
- RAN: the writer W who blocked a replier B now receives "Someone replied to your voice" (unread +1) for B's reply on W's nameless answer, but B's reply is not in W's own reply list (it is filtered by `replyNotBlocked`). On main W got nothing. Dangling notice; only W sees it, no leak.
- RAN: report on a nameless answer with `alsoBlock: true` stores `Report.alsoBlocked = true` although no block was made (same as "recorded as before", but a moderator reading the flag is misled). All 6 reasons x with / without `alsoBlock`: 201, `blocked:false`, 0 Block rows, report and moderation item present, `/me/blocks` unchanged. Named post: `blocked:true`, 1 Block row (as main). REPLY target by a named replier: `blocked:true` (as main).
- READ: `build.py` description text still says 24 hours (builder says so); CONVENTIONS.md line states the 8 days.
- RAN: a closed question → replay of an expired key answers the closed-question 409 before the stored-post lookup (builder lists it; not run by me).

# Answers to the brief's sections

## A. Finding the writer (tools)
- RAN: report (6 reasons x with / without `alsoBlock`, targets ANSWER nameless / named, REPLY), block, unblock, like, helpful, save, reply, report as a blocked person; crawl of 45 GET routes (answer, replies with and without stance, where-you-sit, question, moods, what-next, polls, news, three answer sorts, feeds new / trending / trending-questions, home, today, questions, search, news list and tags, calendar, categories, weekly report, people pages, share pages and cards, `/me`, my answers, saved, block list, allowance, notifications, unread count, friends, invite) x viewers {member V, replier R, neighbour X, the writer W} x {viewer blocks writer, writer blocks viewer} x {nameless writer, named writer}, each compared with its own baseline taken twice (the only self-noise was `requestId` in error bodies, which I strip) and again after unblock (back to the baseline in every route). Result: nameless writer: only `/people/{R}/replies` (BLOCKER 1) and the viewer's own `/me/blocks`. Named writer: everything that changes on main.
- RAN: the share page for a nameless and a named answer and their `/card` (404, no card storage configured) did not change; the block list does not show the nameless writer after a report with `alsoBlock`.
- RAN timing: 100 `GET /answers/{nameless}` per case: viewer not blocking 9.8 ms median (p90 12.2), viewer who blocked the writer 10.6 (12.5), the first viewer again 9.0 (10.7); one header shape in all 300 calls. That is not 200 calls x each tool; I found no difference but it is a weak test.
- Not covered by a run: guest-cached routes with a writer (guests cannot block), "question's author", "follower" (no follow route exists in the contract: READ), data export (storage not configured here), mute (no mute route in `src`: READ), mood routes (`/questions/{id}/moods` returned 404 for the questions I built; READ only: no block filter in `src/mood`), news routes (list/detail use `answerNotBlocked`: READ; the crawl's `/news/{id}` was 404 in my setup), DMs (none exist: READ), reaction by a blocked person (my reaction kind was refused 422 on both trees; not proved).

## B. What the rule costs
- RAN (branch vs main, same spec, W blocks B, then B acts): on the nameless answer B now gets 200 on GET, 201 reply, 200 like, 204 helpful, 204 save, 201 report with `blocked:false` (main: 404 on all but the report, which answered `blocked:true` and made a Block). On the named answer all answers are identical to main (404 on GET, reply, like, helpful, save; report 201 `blocked:true`). Nothing answers differently because of a block, so no response reveals the block or the writer. Changes that follow from the rule: B's reply notifies W as "Someone replied" (see LOW 4); W's unread count rises by one.
- RAN: named replies, named posts, notifications about named posts: identical to main in the crawl and in this spec. Profile visibility (`/people/{id}`) identical.

## C. Moderation
- RAN: moderator sees the writer (`author` in `GET /admin/moderation/items/{id}`, 200); the moderator's own block list: main 1 entry after reporting with `alsoBlock`, branch 0 (rule 1, intended); suspended writer: a guest sees the nameless and the named answer (200 both) and the question list shows both, same as main (the spec showed no difference between the trees; I did not diff the suspended list against main separately beyond the JSON compare, which had no differences there).

## D. Replies and a future `Reply.anonymous`
- Today (RAN): replies have no flag. A reply by anyone is filtered by block lists, `alsoBlock` on a REPLY blocks the writer (`blocked:true`), and notices follow the block. Behaviour equals main.
- READ + RAN (trial merge of `origin/v/fix-d` into `v/hotfix-1`, scratch worktree, discarded): one textual conflict, `api/src/reach/reach.service.ts` (two hunks; both sides edit the same lines: the hotfix reads `r.answer.anonymous`, fix-d selects `anonymous` on the reply). Everything else auto-merged. Nothing fails to compile because of the flag, but nothing makes the rules apply to replies either: `replyNotBlocked` (`me/blocks.ts`) and the REPLY case of the report (`nameless = false`) are edited by hand. If fix-d lands first and nobody edits them, fix-d's BLOCKER 1 and 2 stay open for unnamed replies. The builder's comment says this. No spec guards it. (I did not run tsc or tests on a hand-resolved merge.)

## E. Money
- RAN, origin/main: paid voice answer, record expired, replay → `409 CONFLICT`, balance back to 500 000, answer still published, ledger sum 0 (HIGH 3 reproduced). Free text post, record expired, replay → 201 and a second answer (no free post given back since the write succeeded: main duplicates the post).
- RAN, branch: paid voice replay after expiry → `201`, body identical to the original (compared after removing `requestId`), headers identical (both without `Idempotent-Replay`; the response is rebuilt, not read from the record), balance and ledger unchanged (-78 000), 1 answer, 1 charge, 0 reversals. Free text: `201`, same body, free posts stay at 1, 1 answer. Three paid replays in a row (builder's spec) fine.
- RAN: fresh charge whose store fails (clip already on another post, new key): `409`, charge `REVERSED`, balance restored, exactly 1 REVERSAL row.
- RAN: six at once with one key, fresh: all 201, one answer, one charge. Six at once after expiry: all 201, balance unchanged, 0 reversals, 1 answer.
- RAN: same key, different body: `409 IDEMPOTENCY_KEY_REUSED`; after expiry also 409, nothing written. Same key by another person: independent, own post. Same key + same body after expiry: 201, same answer id.
- RAN: deleted by author → after expiry `404`; removed by moderation → after expiry `201` with `status:"REMOVED"`; both: no new post, no charge, no refund (see MEDIUM 3).
- RAN: reply replay after expiry: 201, same reply id, balance unchanged, record kept 8.0 days. Charge without link (`refType` null, as before the deploy): replay returns the stored answer, balance unchanged; with the idempotency record also gone: same answer, free post not returned.
- RAN: same text under two different keys by one person on one question: two answers on both trees (no hijack; one-answer-per-question is not enforced for text on main either).
- RAN: 200 mixed sends (text, voice, bad clip, replays of earlier keys) in parallel by 8 people: 126 x 201, 34 x 404 (bad clip), 40 x 429 (rate limit). For every person ledger sum = wallet = 400 000 - committed charges, 0 duplicate reversals, 0 reversed charges that carry a post. My second pass (every key replayed after expiry) was answered 429 by the rate limiter for 194 of 194, so replay-under-load beyond the six-at-once cases was not exercised; main shows the same 429.
- READ, which routes got 8 days: `talk.controller.ts` answers and replies only (`postKeepMs`). Kept at 24 h: proposals, polls votes and the poll explanation (`vote.controller.ts` + `results/idempotency.service.ts`, fixed 24 h), result posts, admin money (24 h). Text fix: 10 minutes (`TEXT_FIX_KEEP_MS`). Pack and plan checkouts do not use `IdempotencyRecord` (payments use `Payment(userId, idempotencyKey)` unique keys: READ). Poll votes are safe from the same fault: `castVote` pre-checks "already voted" before charging (READ, `poll.service.ts:318-323`). Reaction: an existing reaction returns before any charge (READ). Edit: key names the change, same charge replays and the write is repeatable (READ). I judge the split right for the three faults; proposals and replies for 24 h only matters if the web retries them for 7 days (not checked).
- Records that expired before this deploy: RAN with the `refType` null stand-in above (matched by content); a text replay after an old record matches "same author, question, body, created after the charge".
- Size (RAN for row size, computed for volume): average `responseBody` of an answer row here 1.2 KB (1.5 KB with the row), longest I produced 1.6 KB; a 5 000-character text can reach about 7 KB. 50 000 posts a day x 8 days = 400 000 live rows ≈ 0.6 GB for average rows (up to ~2.8 GB at the largest text), plus the unique and `expiresAt` indexes; before it was 50 000 rows (~75 MB). Cleanup (`textfix-cleanup.service.ts`) deletes `expiresAt < now` every minute using `IdempotencyRecord_expiresAt_idx` (index-only scan in `explain`), about 35 rows a minute at that rate: it keeps up. Not run at that volume.

## F. Existing specs the builder changed
- RAN (`git diff --name-status`): none. Only three new spec files were added (`hotfix1-block-oracle`, `hotfix1-block-report`, `hotfix1-money`). The builder's oracle spec captures 13 routes; it does not include `/people/{id}/replies`, which is why BLOCKER 1 passed.

## G. Migration and contract
- RAN: no change under `api/prisma`, no migration, so nothing to apply or roll back. One config key added (`idempotency.post_keep_days`, default 8, max 60) in the catalogue and reader.
- RAN: `python3 docs/contract/src/build.py <temp>` is byte-identical to `docs/contract/openapi.yaml` (`cmp` clean).

## H. Checks (RAN, Postgres 16 on 5544, Redis on 6390)
- `npx tsc --noEmit`: exit 0.
- eslint on `src/**/*.ts` and the three new specs: 0 errors, 4 warnings (all in existing files).
- Builder's three specs: 3 suites, 16 tests passed.
- Full API suite once (`jest --runInBand`, with my attack specs removed): 103 suites passed, 0 failed; 1161 tests: 1160 passed, 1 skipped, 0 failed. By folder (suites, passed, skipped): `test/talk` 13, 225, 0; `test/units` 6, 115, 0; `test/me` 12, 108, 0; `test/reach` 12, 107, 1; `test/feed` 2, 15, 0; `test/privacy` 9, 28, 0; `test/shared` 2, 62, 0; `src` specs 3, 62, 0; admin 22, 220; mail 6, 75; load 5, 32; vote 2, 36; others as in the JSON. `npm run test:audio` (node test runner): 13 of 13 pass. No failures, so no main comparison was needed.

# Proved by runs
BLOCKER 1 and its main control; the report matrix; blocked-person actions vs main; moderation list and detail; crawl (above); all money cases in E that say RAN; the crash-after-charge case (MEDIUM 2); the delete / remove replay cases (MEDIUM 3); tsc, eslint, contract, specs, full suite; row size and the cleanup query plan; trial merge with fix-d.

# Read only
`spendThen` race analysis (the pre-read of the charge sits outside the ledger transaction, but concurrent same-key requests are serialised by the idempotency record, and different paths with one key get 409: six-at-once runs agree); the 8-day / 24-hour split of every `IdempotencyRecord` route; poll vote, reaction and edit paths; `invite.service` and proposal block checks (named content only); no mute, follow or DM routes; `deletion.service` clears records.

# Not proved
- Anything on a hand-resolved merge with fix-d (tsc, specs).
- Replays after expiry under heavy parallel load (rate limiter answered 429); 200 calls per tool for timing; exhaustive statistics.
- Reaction by a blocked person on a nameless answer (kind rejected in my spec); mood and news detail routes with real data; data export; share cards (no storage); mail contents for a reply on a nameless answer with a blocked replier.
- Table size and cleanup at 50 000 posts a day (computed, not loaded).
- Whether the web retries proposals, polls or the explanation for longer than 24 hours.
