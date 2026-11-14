VERDICT: FIX

# Verify V-FIX-B round 3, API side

Code under test: `origin/v/fix-b` at 9b66b7c (round 3). The merge into `verify/v-fix-b` was clean (merge commit 4f01bd6; no conflict). Run on my own Postgres 16 (port 15433) and two Redis (16381, 16382), all stopped now; the repo's fakes only; no live provider; I never opened an `.env` or key file. My attack specs are not in the commit (copies in `/var/tmp/pgv3/specs/`, outside the repo). Only this report is committed. The builder's round 3 report is not in the repo (`docs/lead/reports/V-FIX-B-builder-report.md` has no round 3); I used the commit message of 9b66b7c and the diff `4e5340e..9b66b7c` (3 source files and `test/admin/fixb-r2.spec.ts`).

Why FIX: no BLOCKER, no HIGH. Every round 2 finding the builder claimed is closed on the paths I built. One MEDIUM that loses money is **new in round 3** (N-3): the refund the lock gives back for a refused edit can be made to refund an edit that stood, so a poster can make a longer edit free by sending the same edit twice and asking for Verified in the same moment. Everything else is LOW.

## Round 2 findings and their state

| Round 2 | State | Run |
|---|---|---|
| N-1 edit lock check-then-write | **Closed for the race it named; N-3 is a new hole beside it** | Gap held open after the charge, 12 cases (below). 200 random races: 0 problems, 0 trigger violations. 80 runs of 8 or 9 paths at once: 0 5xx, no deadlock. |
| N-2 request stays OPEN after KEEP, CHANGE_TAG, SEND_TO_MODERATION | **Closed** (LOW notes N-5, N-6) | Table below. |
| L-1 poll sweep starves | **Closed** | 52 stuck + 55 real ended polls. |
| L-2 announced twice (Verified, Gossip, Verified) | **Closed** for the named path (LOW N-7 for a side effect) | Below. |
| L-3 old closed question announced on first approval | Open, unchanged, owner call | Not in the delta. |
| L-4 advert link shapes | Open, unchanged | Run again: `https:good.example`, `HTTPS://GOOD.EXAMPLE`, `https://good.example/a b` still accepted on FEED_CARD and BANNER (201); `http:`, `javascript:`, `data:`, `ftp:`, `//x`, bare host, `localhost`, `user:pw@` all 422. |
| L-5 busy skip takes no marker | Open, unchanged | Read only. |
| L-6 topic poll question id | Open, unchanged | Read only. |
| L-7 three eslint warnings in the builder's spec | Open | `eslint "{src,test}/**/*.ts"`: 0 errors, 44 warnings (same 44 as round 2; origin/main was 41 in round 2, not re-run). |
| L-8 markers cleaned only by sweep | Changed on purpose: the cleanup now deletes only `tag-follow:%` rows, so the `verified-announced:<id>` rows stay for good (one row per Verified post; grows slowly, harmless) | Read. |

### N-1 in detail: gap held open (the edit is stopped just after `units.charge`, then something else is let in)

Poster has 50,000 milli; the longer text costs 2,230 milli. "Delta" = tokens the poster is down at the end.

| What lands in the gap | Edit | Body | Tag | Charge | Delta |
|---|---|---|---|---|---|
| poster asks for Verified, editor approves | 409 `VERIFIED_NEWS_LOCKED` | old | Verified | 1 charge, REVERSED, 1 reversal txn | 0 |
| editor CHANGE_TAG to Verified (no request) | 409 `VERIFIED_NEWS_LOCKED` | old | Verified | REVERSED, 1 reversal | 0 |
| editor CHANGE_TAG to Verified (request open) | 409 `VERIFIED_NEWS_LOCKED` | old | Verified | REVERSED, 1 reversal | 0 |
| poster's own new request | 409 `VERIFIED_REQUEST_OPEN` | old | Unverified | REVERSED, 1 reversal | 0 |
| CHANGE_TAG to Gossip | 200 | new | Gossip | COMMITTED, 0 reversals | 2,230 |
| KEEP | 200 | new | Unverified | COMMITTED | 2,230 |
| SEND_TO_MODERATION | 200 | new | Unverified | COMMITTED | 2,230 |
| request, then DECLINE | 200 | new | Unverified | COMMITTED | 2,230 |
| request, then KEEP | 200 | new | Unverified | COMMITTED | 2,230 |
| request, then SEND_TO_MODERATION | 200 | new | Unverified | COMMITTED | 2,230 |
| request, then CHANGE_TAG to Gossip | 200 | new | Gossip | COMMITTED | 2,230 |
| the poster deletes the post | **200** | new | Unverified | COMMITTED | **2,230** (N-4) |

So with one edit in flight the token comes back exactly once when the edit is refused, and is kept when it goes through. A database trigger I put on `Answer` (records any body change while the old row is Verified, VERIFIED_REQUESTED or has an OPEN request) recorded 0 violations in this run and in the 200 random runs below.

- 200 random races (decision kind rotated over approve, decline, CHANGE_TAG to Verified, CHANGE_TAG to Gossip, KEEP, SEND_TO_MODERATION, poster's own request; a request open before in half of them; one or two edits; the decision delayed 0 to 12 ms): responses over all calls in the runs: 184 x 200, 203 x 409, 80 x 201 (requests), 0 5xx. Checked after each run: wallet equals start minus live charges, no more reversals than reversed charges, "edit 200" only with the new body, "edit 409" only with the old body and no live charge left. 0 problems.
- Deadlocks: 80 runs, each with an edit, a second edit, a decision (CHANGE_TAG to Verified or KEEP), a reply, a reaction, a report, an editor flag, a request and (every fifth run) a delete, all at once: 5xx 0 (replies 80 x 201, reactions 80 x 200, reports 80 x 201, flags 80 x 201). The edit's transaction takes only the answer row lock and reads/writes only that row, so no cycle is possible with the paths that lock the answer first; run agrees.
- Edit racing delete: see N-4.
- Two edits at once: see N-3 and N-8.

## New findings

### MEDIUM

**N-3. A refused edit refunds the charge it shares with an identical edit that went through: a poster can make a longer edit free** (proved, with the gap held and in 1 of 60 plain races).
- `api/src/talk/posts.service.ts` `editAnswer`: the charge key is `edit:<answerId>:<from>:<to>`; two identical edits at once have the same key and share one charge row. The new `catch` reverses `charge.chargeId` for any edit that fails in the transaction. If edit A commits and edit B is refused a moment later (the poster's own request, or an editor's decision, landed between them), B reverses the charge A paid for.
- What I did: two identical longer edits, both stopped after their (shared) charge (both paid once: 1,870 milli); A released: 200, body new; the poster asks for Verified: 201; B released: 409. Result: the charge is REVERSED, the post carries A's new text, the poster paid **0**. The poster did it alone, with three requests (edit, edit, request). In the unforced race of 60 with an editor's CHANGE_TAG: `edits=200,409 tag=VERIFIED_NEWS body=NEW charges=1:REVERSED` once; the other 59 gave the right ledger (58 both refused with one reversal, 1 both accepted with the charge kept).
- Should happen: reverse a charge only when this call made it (not when `charge` came back already used by another edit), or key the reversal on a per-call id, or give each edit a key that includes a request id.
- How far: it gives away the price of one longer edit each time (here 1,870 to 3,200 milli); the person must send the edit twice in parallel and ask in the same moment. That is why it is MEDIUM and not HIGH. It is new in round 3 (before, a refused edit was not possible at the write, so nothing was reversed).

### LOW

**N-4. An edit that races the author's own delete succeeds on the deleted post and keeps the charge** (proved: 10 of 10 parallel edit + delete, and the gap case). `editAnswer` re-reads the lock rule under the row lock but not `status`: the answer ends `DELETED_BY_AUTHOR` with the new body, the edit returns 200, 2,230 milli paid. Same on origin/main (no lock there). Should: re-read `status` under the lock and refuse with 404 (and give the charge back).

**N-5. After KEEP or SEND_TO_MODERATION closes the open request, the poster is told nothing** (proved: `posterTold=0`, request row DECLINED with the editor's id). The poster sees the request vanish. CHANGE_TAG, APPROVE and DECLINE each send one `TAG_CHANGED` notice (proved: 1 each). Owner call whether KEEP and SEND_TO_MODERATION should say "not approved" too.

**N-6. A request that races an editor's CHANGE_TAG to Verified can land on a post already Verified and stay OPEN** (proved: 25 of 60 races: request 201, tag Verified, `newsReviewStatus = VERIFIED_REQUESTED`, 1 OPEN row; the other 35 ended right: row APPROVED, review RESOLVED). `NewsService.requestVerified` reads `newsTag` before it takes the row lock and does not read it again under the lock (`news.service.ts:328-357`). The poster cannot edit a Verified post anyway, so the effect is a Verified post shown to the editors as "asking" until one of them decides on it. Sequentially it is a 409 (proved: `ALREADY_VERIFIED`). Should: re-read the tag under the lock.

**N-7. The "announced once" marker is taken before the work, so anything that stops the work loses the announcement for good** (proved). `alerts.service.ts` `tagPost` inserts `verified-announced:<id>` first, then claims the hour. (a) The fan-out throws: the hour marker is given back (as designed) but the post's own marker stays; the next try returns 0 (run: failed once, retry an hour later returned 0, follower got 0). (b) A second Verified post in the hour a first one already claimed: returns 0, and in the next hour also 0 (post B never announced; before round 3 it was also never retried, because `tagPost` runs only at the post and at the first approval; so the loss is the same, it is now written down). (c) A post approved while a moderator had removed it is not announced and not marked (returns before the marker), and restoring it never announces it (no caller on restore; read). These are the one-per-tag-per-hour rule and error paths, not a double announcement. Should: take the post's marker only after the hour claim and give it back with it on failure.

**N-8. Two different edits sent at once, and an edit that grows, shrinks and grows back, are charged wrongly** (proved; **identical on origin/main**, so not caused by this branch). From 33 characters, edit to 100 and edit to 140 at once: both 200, charges 2,230 + 3,570 = 5,800, final text 140 (sequential: 3,570; one edit alone: 3,570). Grow to 100, shrink to 33, grow to 100 again: the third edit costs 0 (same key as the first charge). Figures on main and on this branch: 5,070 concurrent / 3,200 sequential and single / the third step free. The lock does not change this: the charge is computed from the body read before the lock. Reported because the lead asked about two edits at once; not part of the round 3 change.

**N-9. After a refused edit, the same edit cannot be made again** (proved). Edit refused (charge reversed), editor declines the request, the poster sends the same text again: 409 "That attempt was reversed. Start again with a new key." (the key `edit:id:from:to` belongs to a reversed charge). One more character works. Only reachable through the race; the message is for a developer.

**N-10. The `rollback.down.sql` comment for `20261114230000_fixb_alerts_2` is stale.** It says the markers only say a fan-out started and "dropping them loses nothing"; since round 3 the table also holds one `verified-announced:<id>` row per announced Verified post. Dropping it means a Gossip then Verified round trip after a rollback and re-apply could announce a post a second time. Correct the comment (or say so).

## N-2 in detail (item 2)

One post per row, member asks (real route), second ask, an edit while open, the editor decides, then: request rows, tag, review, poster notices, announced to a follower of Verified News, audit rows, edit after, ask again. One editor decision each; "announced" counted only after the hour marker was cleared where noted.

| Decision | Request row | Tag | Review | Poster told | Edit after | Ask again |
|---|---|---|---|---|---|---|
| KEEP | DECLINED (editor id set) | unchanged | RESOLVED | 0 (N-5) | 200 | 201 |
| SEND_TO_MODERATION | DECLINED | unchanged | RESOLVED | 0 (N-5) | 200 | 201 |
| CHANGE_TAG to Unverified (from Gossip) | DECLINED | Unverified | RESOLVED | 1 | 200 | 201 |
| CHANGE_TAG to Gossip | DECLINED | Gossip | RESOLVED | 1 | 200 | 201 |
| CHANGE_TAG to Verified (request open) | APPROVED | Verified | RESOLVED | **1** | 409 (locked) | 409 `ALREADY_VERIFIED` |
| APPROVE_VERIFIED | APPROVED | Verified | RESOLVED | 1 | 409 | 409 |
| DECLINE_VERIFIED | DECLINED | unchanged | RESOLVED | 1 | 200 | 201 |

- A second request while one is open: 409 `ALREADY_REQUESTED` (every row). Edit while open: 409. A request on a post an editor already made Verified: 409 (sequential; race in N-6).
- Ask and decline eight times in a row: 201 eight times (no limit; LOW-7 of the first check, unchanged).
- "CHANGE_TAG to Verified with a request open counts as approved": poster told once (1 `TAG_CHANGED` notice "Your post is now tagged Verified News"), announced to followers once (1 `TAG_FOLLOW`, with the hour marker cleared; with it in place a second post in the same hour is held back, as designed), request row APPROVED, 1 `TagChange` row (Unverified to Verified, with the editor's reason), 1 `news.decision` audit row: `before = {tag: UNVERIFIED_NEWS, sourceName: null, reviewStatus: VERIFIED_REQUESTED}`, `after = {tag: VERIFIED_NEWS, decision: CHANGE_TAG, sourceName: "NAN", reviewStatus: RESOLVED}`, actor the editor, reason the editor's text. The audit row does not say that a request was closed (the row's own status does). APPROVE gives the same row with `decision: APPROVE_VERIFIED` and the request's source name.

## L-1 (item 3)

- 52 stuck polls (draft question, ended 1 to 50 hours ago) + 55 real ended polls with one voter each, behind them in time: sweep 1: `polls 50`, 50 voters told; sweep 2: `polls 5`, all 55 told; nobody told twice; the 52 stuck ones not marked.
- A poll whose question was a draft: 0 notices before; question set LIVE, two sweeps: exactly 1 notice, poll marked.
- Three `AlertsService` instances sweeping at once (6 polls, 18 voters): returns 15 / 0 / 3; each voter has exactly 1 notice (18 of 18); the notice key plus the marker held.

## L-2 (item 4)

- Verified, Gossip, Verified (post published as Verified by an editor): 1 notice (direct calls, three hours apart); with real routes and the hour marker cleared: 1.
- Three instances at once on the same post, different hours: returns `[7, 0, 0]`, follower got 1.
- Member asks, editor approves (1), editor2 moves to Gossip and back to Verified (marker cleared so only the per-post rule stands): still 1; a second `APPROVE_VERIFIED` after that: 409.
- Verified, removed by a moderator (REMOVE 200), restored (RESTORE 200): 1 notice in all; restore announces nothing (no caller; read).
- A post an editor published as Verified, then moved to Gossip, then asked for and approved by another editor: 1 in all.
- Fan-out failure and same-hour loss: N-7.

## Item 5: nothing else moved

- Same script on origin/main (4fa9d50, own worktree and database) and on this branch, ids and times masked: plain text post `{kind, body}` 201, `{isNews: false}` 201, Gossip 201, Unverified 201, `VERIFIED_NEWS` directly 403, GET answer 200, shorter edit 200, longer edit 200, `/news`, `/news/tags`, `/notifications`, empty body 422, bad tag 422, delete 204, edit of a deleted post 404: **the whole output is identical** (`diff` empty). The question's answer list answered 404 in my script on both sides (wrong route in my script, not compared).
- Notices only from readable questions; TAG_FOLLOW only on first publish and first approval; per-day cap: unchanged by round 3 and covered by the builder's passing specs (`fixb-r2`, `fixb-alerts`, 56 tests green); my own runs above agree (publish 1, editor KEEP and CHANGE_TAG to Gossip 0, first approval 1, return trips 0).
- Roles (guest 401, member, MODERATOR, EDITOR, AD_MANAGER, ADMIN):
  - `POST /news/{id}/request-verified`: guest 401; member, MODERATOR, EDITOR, AD_MANAGER, ADMIN on another person's post 404; the owner 201.
  - `POST /admin/news/{id}/decision` and `GET /admin/news/items`: guest 401; member, MODERATOR, AD_MANAGER 403; EDITOR and ADMIN 200. `PATCH /answers/{id}` on another person's post: guest 401, all others 403 (editor and admin too).
  - `POST /voice-clips`: guest 401. `OVERRIDE_NOTE`: member, MODERATOR, AD_MANAGER 403 `ROLE_REQUIRED`; EDITOR and ADMIN past the role check. `AD_AUDIO`: member, MODERATOR, EDITOR 403; AD_MANAGER and ADMIN past it. (Past the role check the answer is 503 `UNAVAILABLE` in my harness because there is no object store; a plain `ANSWER` clip gives 503 for everyone for the same reason. The clip itself was not made end to end by me.)
  - `POST /admin/ads`: guest 401; member, MODERATOR, EDITOR 403; AD_MANAGER, ADMIN 201. `POST /admin/overrides`: guest 401; member, MODERATOR, AD_MANAGER 403; EDITOR 201; ADMIN 409 (an override of the same time already live; the role check passed).
  - Advert links http(s) only: see L-4 row (every non-http(s) shape 422, same on FEED_CARD and BANNER; not repeated for the other two kinds this round). The override link lines were cut off in my output and are not in my record (see Not proved).

## Item 6: against `origin/v/batch-api-1114c2` (4ee61be, main plus pre-launch; it adds no migration)

`git merge --no-commit origin/v/batch-api-1114c2` into a scratch worktree of `origin/v/fix-b`: **3 conflicts**, nothing else (docs/contract merged by itself; the contract rebuilt from the merged tree is byte for byte equal to the merged `openapi.yaml`):

1. `api/src/feed/question-window.ts`. Both define `isQuestionReadable` and `questionReadableWhere` (same rule; round 2 proved the two Prisma filters and functions give the same answer on 100 windows). **What must change here so there is one set:** take pre-launch's file whole. It exports everything fix-b imports (`isQuestionOpen`, `isQuestionOver`, `questionOpenWhere`, `isQuestionReadable`, `questionReadableWhere`) and also `questionOverWhere`, `answerReadableWhere`, `replyReadableWhere`, `lagosDateWords`, `isShownComingUp`, `notOpenYet`. Delete fix-b's own copies of the two helpers (lines 53 to 67 of its file). No import in fix-b changes: `alerts.service.ts`, `admin/trust/news.service.ts`, `reach/weekly-draft.ts` and `reach/reach.service.ts` use the same names.
2. `api/src/news/news.service.ts`. Imports: keep `UnprocessableEntityException` (fix-b) and add `answerReadableWhere` (pre-launch); in `visible`, take pre-launch's `...answerReadableWhere(new Date())` (fix-b's `question: questionReadableWhere(new Date())` is the same filter), then fix-b's `questionReadableWhere` import is not needed in this file.
3. `api/src/reach/reach.service.ts`. Keep both: fix-b's `pollIds/polls/topicQuestions/pollQuestion` block (for POLL_CLOSED `questionId`) above, and pre-launch's widened `Promise.all` (replies, reactions, answers, questions, proposals, appeals with `QUESTION_WINDOW`).

I made exactly these three resolutions in the scratch worktree: `npx tsc --noEmit` clean; `test/news test/admin/fixb* test/reach test/talk test/feed`: 29 suites, 379 passed, 1 skipped, 0 failed; `src/feed` specs (`--runInBand`): 3 suites, 44 passed. The merge was not committed or pushed anywhere (worktrees removed).

## Item 7: migrations

Folders this branch adds: `20261114160000_fixb_alerts` and `20261114230000_fixb_alerts_2` (round 3 added none). Stamps are unique among origin/main's (latest `20261114170000_subscription_terms`), this branch's and `origin/v/batch-api-1114c2`'s (it adds none). Out of name order with `170000` (160000 sorts before it), applied by `migrate deploy` anyway.
- A database built from origin/main's 18 migrations with 2 UserSettings, 2 polls (one ended, one future), 3 questions (past, future, draft): both applied; `notifyTagFollows = true` on both rows; the ended poll and the past question marked, the others not; `AlertMarker` empty; counts 2/2/3 unchanged.
- Rollback in order (230000 then 160000), rows present: both ran, columns and table gone, counts 2/2/3. Migration rows deleted and `migrate deploy` run again: both re-applied, rows intact.
- Rollback of 230000 with one person who switched tag alerts off: `ERROR: rollback refused: people have switched news tag alerts off`, nothing changed (column still there). After setting it back: rollback ran; running the same rollback twice: the second fails cleanly (column missing).
- Empty database: up, both rollbacks, clean.
- N-10 (stale comment).

## Item 8: contract

`python3 docs/contract/src/build.py <temp file>` (the script takes a file path): exit 0, 194 routes, 167 paths, 300 schemas; `cmp` with `docs/contract/openapi.yaml`: identical. Against origin/main (a script walking every path, method, response code, parameter, schema property, required list and enum): nothing removed; one new path `POST /news/{answerId}/request-verified`, two new schemas (`RequestVerifiedRequest`, `VerifiedRequestReceipt`); the only change in an existing schema is `Settings` gaining a required `notifyTagFollows` (response-only schema, used by the two `/me/settings` responses; the request schema has it optional). Nothing retyped.

## Item 9: checks (exact)

- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"` (no `--fix`): 0 errors, 44 warnings (L-7).
- `test/talk`: 10 suites, 211 passed. `test/feed`: 2 suites, 15 passed. `test/admin`: 27 suites, 268 passed. `test/reach`: 13 suites, 114 passed, 1 skipped. `test/news`: 1 suite, 12 passed.
- The branch's own specs (`test/admin/fixb-*`, `test/reach/fixb-alerts`, `test/news`, `test/app.contract`): 6 suites, 56 passed.
- Whole API suite once (`jest --runInBand --forceExit`): **107 suites, 1,247 passed, 1 skipped, 0 failed**. No failure, so nothing to compare with origin/main.

## Item 10: assertions changed in `4e5340e..9b66b7c`

None. The diff of `api/test` in that range has no removed line (`git diff 4e5340e 9b66b7c -- api/test | grep '^-[^-]'` is empty): `fixb-r2.spec.ts` gains imports, one more person (`poster3`) and a `round 3` block of four new tests. Across the whole branch against origin/main, the only removed test line is the one round 2 already explained (`news.spec.ts`: the question now has `status: "LIVE"`).

## Proved by runs

The gap-held table, the 200 random races with the trigger and ledger checks, the 80-run deadlock sweep, the shared-key refund (N-3, forced and in a plain race), the edit/delete and two-edit runs (also on origin/main), the N-2 table with notices, audit and tag change rows, the request race (N-6), L-1 (52 + 55 polls, later readable, three servers), L-2 (round trip, three instances, two editors, remove and restore, failure, same-hour loss), the identical-output compare with origin/main, the role matrix, the pre-launch merge with its three resolutions compiled and tested, the migration runs, the contract build and compare, tsc, eslint, per-folder and full suites.

## Read only

- That `tagPost` has no caller on a moderator's restore, and is called only at posting and at a first approval (grep: `posts.service.ts:328`, `news.service.ts:446`).
- The busy-flag skip and a process dying mid fan-out (L-5): not run.
- The editors' queue listing a request on a post whose question went back to unreadable: not run.

## Not proved

- A voice clip made end to end for `OVERRIDE_NOTE` or `AD_AUDIO` (no object store in my harness; only the role check).
- The advert link rows for `AUDIO_SLOT` and `WALLET_OFFER`, and the override link rows, in this round (my output was cut; round 2 proved them and the code did not change).
- The droplet's `.calendar-launch-shift-done` marker (MEDIUM-4 of the first check).
- Two real API processes (I used several service instances against one database).
- eslint on origin/main this round (41 warnings in round 2).
- The "first approval" rule with the real 50,000-follower fan-out: not re-run, the delta did not touch the fan-out.
