# BATCH-C2 (API): v/prelaunch + v/hotfix-1 on origin/main

Branch `v/batch-api-1114c2`. Base: origin/main 4fa9d50 + v/prelaunch bdf0aab (lead's merge 4ee61be). Merged `origin/v/hotfix-1` (67ea461 at the last fetch; its code head was already in the merge). One migration (`20261114220000_hotfix_1`, from hotfix-1 round 4; see Round 3), no contract change, nothing under `.github/`.

## A. The six conflicts (file:line after the merge; which rule from which side)

| File | Resolution |
|---|---|
| `feed/feed.service.ts:53-54` `answerWhere` | `AND: [answerReadableWhere(now)]` (pre-launch) **and** `...answerNotBlocked([...viewer.blocked])` (hotfix). Hotfix's plain `question: { status in SCHEDULED, LIVE, CLOSED }` line is **dropped**: the readable rule (open or over, never a draft, never before the window) is strictly stricter than that line, so nothing it allowed is lost. The readable rule stays inside `AND` so callers that spread `question: {...}` (`:375`, `:710`) cannot overwrite it. |
| `me/people.service.ts:9-13` imports; `:152-153` replies of a person; `:219-220` saved answers | Both helpers on both lists: `...answerAuthorVisible(viewerId)` (hotfix, the nameless answer ignores block lists, account status still applies) **and** `...answerReadableWhere(new Date())` (pre-launch). The two return disjoint keys (`OR`/`author` and `question`), so the spreads do not overwrite each other. The old `author: visibleUser(...)` lines are gone from these two lists (it is inside `answerAuthorVisible`). |
| `news/news.service.ts:1-2` | Both imports. The readable rule is in `visible` (`:60`), the block rule in list `:180` and get `:215`, as each side had it. |
| `reach/reach.service.ts:325-440` `render` | Pre-launch's query (reply, answer, question, proposal windows) **plus** hotfix's `anonymous`: the reply read selects `answer: { anonymous, question: window }` (`:337`), the answer read selects `anonymous` and `question` (`:360`). Loop: the window check comes first (`:437`, a notice under a question that has not opened is dropped for everyone), then hotfix's rules (`:448` a blocked replier on a nameless answer is shown as "Someone", never dropped; `:467-473` reactions keep their count and the notice on a nameless answer). |
| `talk/posts.service.ts:536-538` `createReply` | `throw (await notOpenYet(...)) ?? gone()` (pre-launch) then `if (!a.anonymous) { ...both block 404 checks... }` (hotfix). |
| `talk/talk.controller.ts:141-170, 213-224, 359-370` | Constructor takes both `limiter: RateLimitGuard` and `config: ConfigReader`; both helpers kept (`notCountedWhenNotOpen`, `postKeepMs`). `createAnswer` and `createReply` wrap the idempotent run: `notCountedWhenNotOpen(u, async () => this.once(..., await this.postKeepMs()))`. So a refused early write gives its try back, and the 8-day record keeps for a post that is stored. |

`tsc --noEmit` is clean after the merge. Merge commit f2581f4.

## B. Past the conflict markers

Pre-launch rule on what hotfix added or changed:
- people replies list `me/people.service.ts:152-153`: both rules (above).
- sweeper (`talk/charge-sweeper.service.ts`): reads no post for any viewer; it only looks at answers/replies by the charge's own author to see whether a post is stored. Not a read path. Joined spec checks it with a refused early write.
- crawl spec (`hotfix1-crawl.spec.ts`): its questions are made open, so it proves the open half; the joined spec runs the same routes (plus clip routes, `/me`) with the question not yet open.
- notice rule (`posts.service.ts:635-640`, "no notice to W for a reply by someone W blocked"): a reply cannot be written before the window, so no notice is born early; a notice made earlier is dropped by `render` until it opens (spec).
- `clearPostRecord` and the gone-record 404: a replay of a deleted post is 404 as before; not a read of a post.
- idempotent replay after the question closed or moved: the window check (409 `QUESTION_CLOSED` / 404 / 409 `QUESTION_NOT_OPEN`) runs before the charge and before the stored-post lookup, so nothing is charged, written or reversed (spec).

Nameless-post rule on what pre-launch added or changed (none of them has a block filter, so a block cannot change what they show; the only block-aware ones go through the hotfix helpers):
- clip routes `media/clips.service.ts:373-400` (readable via answer/reply/proposal rule; no block test), voice-video `media/voice-video.service.ts:142,236`, share subjects `reach/share-subject.ts:434,520`, share `reach/share.service.ts:348`, mood `mood/mood.controller.ts:48,70`, coming-up card (`feed/feed.service.ts` question(), `today-question.ts`), unread badge (through `render`), profile counters `me/views.ts:117` `hiddenCounters` (counts by window only), `me/invite.service.ts:57,126` (named answers only), faces `feed/feed.service.ts:420-432` and `me/views.ts:462-470` (`anonymous: false`, so a nameless post is never a face, whatever blocks exist). All 40 crawl routes are identical in 8 block states for every viewer, window not yet open and open (spec).

### Every block filter and window filter in `api/src` (after the merge)

Block rule, one helper per use (`me/blocks.ts`):

| file:line | what | helper |
|---|---|---|
| feed/feed.service.ts:54 | `answerWhere` (answer lists, trending, category, home, counts) | `answerNotBlocked` |
| feed/feed.service.ts:1069 | search answers (raw SQL) | `answerNotBlockedSql` |
| feed/feed.service.ts:1077 | people search (people, not posts) | person list, not a post rule (`id NOT IN`) |
| feed/ranking.service.ts:48 | anti-manipulation signals | `anonymous OR NOT EXISTS block` in SQL, nameless exempt (hotfix r1) |
| feed/present.ts:112 | faces | list holds named answers only (`anonymous: false` at the query) |
| news/news.service.ts:180, 215 | news list and item | `answerNotBlocked` |
| me/people.service.ts:51, 62-63 | person page access | `visibleUser` (about a person) |
| me/people.service.ts:152, 219 | replies of a person; saved answers | `answerAuthorVisible` |
| me/views.ts:467 | faces on a question | `visibleUser` with `anonymous: false` |
| me/invite.service.ts:59 | friends count | `id notIn hidden` on people, named answers only |
| reach/reach.service.ts:402, 448, 467-473 | notifications and unread | `hidden` set, nameless exempt through `answer.anonymous` |
| results/results.service.ts:300 | result thread posts | result posts have no nameless flag |
| talk/posts.service.ts:383, 637 | answer by id, reply notice | `blockHidesAuthorOf` |
| talk/posts.service.ts:401, 735, 784 | replies, counts | `replyNotBlocked` |
| talk/engagement.service.ts:65, 230, 388 | like/react/save/helpful, listen | `blockHidesAuthorOf` |

Window rule, one helper per use (`feed/question-window.ts`):

| file:line | helper |
|---|---|
| feed/feed.service.ts:42,43,53,89,260,375,430,710,903,1095,1136,1147 | `questionOpenWhere`, `questionOverWhere`, `answerReadableWhere`, `questionReadableWhere` |
| me/people.service.ts:96,152,179,219,233 | `answerReadableWhere`, `questionReadableWhere` |
| me/views.ts:137,148,218,229,440,453,468 | `answerReadableWhere`, `replyReadableWhere`, `questionReadableWhere` |
| me/invite.service.ts:57,126 | `answerReadableWhere` |
| news/news.service.ts:60 | `answerReadableWhere` |
| media/clips.service.ts:382,390,398 | `answerReadableWhere`, `replyReadableWhere`, `questionReadableWhere` |
| media/voice-video.service.ts:142,236 | `isQuestionReadable` |
| mood/mood.controller.ts:48,70 | `isQuestionReadable` |
| reach/reach.service.ts:437 | `isQuestionReadable` |
| reach/share.service.ts:348; reach/share-subject.ts:434,437,520 | `isQuestionReadable`, `isShownComingUp` |
| reach/weekly-draft.ts:171 | `questionReadableWhere` |
| vote/poll.service.ts:455,478,485,487; vote/proposal.service.ts:119,122,124 | `isQuestionOpen`, `isQuestionOver`, `isQuestionReadable`, `notOpenYet` |
| talk/posts.service.ts:236,536 | `isQuestionOpen`, `isQuestionOver`, `notOpenYet` |
| talk/talk.controller.ts:149 | `notCountedWhenNotOpen` (the give-back) |

No hand-written copy of either rule found. Hand-written lists that are not a copy: people-search `NOT IN` (people), `visibleUser` (a person), `feed/launch-shift.ts:337` and `vote/poll.service.ts:191-237` (`startsAt <= now` for a list of questions or polls, not an answer: the question and poll lists, V-27, not part of the rule for what is under a question).

## C. Specs

- New: `api/test/talk/c2-joined.spec.ts`, 6 tests, passes (real clock; "not yet open" is made by moving the question's window, like the launch shift does):
  1. a nameless text answer, its replies, a nameless voice answer with a clip, share link and news item are 404 / absent for a stranger, a person who blocked the writer and a person the writer blocked while not yet open, and readable by all three the instant it opens (answer, list, search, replies, clip play); the writer's named post follows blocks open or not.
  2. the crawl: 40 GET routes x 6 viewers (writer, blocker, stranger, blocked, replier, guest) x 6 block states in both directions + cleared, once with the question not yet open (nothing of the post appears anywhere, nothing moves) and once open (nothing moves; own-page routes never carry the nameless post).
  3. notice for a reply by a blocked person: dropped (list and unread) while not open in both block directions; served as "Someone replied to your voice" once open; a reply after the block sends none; a notice written straight to the writer is held back until open.
  4. idempotent replay on a question that has since closed (409 `QUESTION_CLOSED`) and moved back before its start (404): record expired, no second answer, no second charge, no reversal, balance unchanged.
  5. a refused early write: 30 refused tries then a post is accepted; the key refused early works once open; no charge.
  6. the sweeper: charge with a stored post left alone (also after a pass); charge whose same-key retry was refused as not open is reversed once: free post back, wallet back with one REVERSAL, a voice post paid by an extra token (token not used; released by the stale hold job); a second pass changes nothing.
- Bites: with `answerReadableWhere` removed from `answerWhere` tests 1 and 2 fail; with `answerNotBlocked` replaced by the old plain `notIn` they fail too (both mutations tried, source restored).
- Existing assertions: none edited. No two assertions contradict.
- Clip routes: the clip's owner always reads their own clip (pre-launch ruling); the spec excludes that one case.

### Red spec, not caused by the merge
`test/talk/hotfix1-block-oracle.spec.ts` "replying to the nameless answer works and notifies its writer..." fails with 402 `FREE_POSTS_EXHAUSTED` at line 230 (a new person's 3rd reply). Cause: origin/main lowered the default `allowance.free_posts` from 10 to 2 (`units/units.defaults.ts`, V-VERIFY, 71d627d); hotfix was built on 755aa15 where it was 10. It fails the same way when run alone on a fresh database. A copy of the spec with `v = makePerson(h, { freePosts: 10 })` (nothing else changed) passes 4 of 4; the copy was deleted. I did not edit the file (rule: specs unchanged); the one-line fixture change is the lead's call.

## D. Migrations
(Corrected in round 3: this paragraph is about the first merge; hotfix-1 round 4 later added the migration `20261114220000_hotfix_1`, see Round 3.) The merge brings **no migration folder** (`git diff origin/main HEAD -- api/prisma` is empty; the pre-launch branch has none, hotfix has none). Newest stamp `20261114170000_subscription_terms`; stamps unique, none older than `20261114100000`. `prisma migrate deploy` on a fresh Postgres 16: all applied; a row inserted into `User`; `migrate deploy` again: "No pending migrations"; `migrate status`: up to date. No rollback file to run.

## E. Contract
`python3 docs/contract/src/build.py docs/contract/openapi.yaml` wrote no change (git clean); built to a temp file: `cmp` identical. 313 `$ref`s, none dangling. `QUESTION_NOT_OPEN` and `IDEMPOTENCY_KEY_REUSED` are in `ErrorCode`.

## G. Runs (own Postgres 16 on 5499, Redis on 6399, both stopped at the end)
- `npx tsc --noEmit`: clean (exit 0, no output).
- `eslint "{src,test}/**/*.ts"`: 0 errors, 47 warnings (unused disable directives and similar, none in files this merge touched beyond what the branches brought).
- `test/shared test/talk test/feed test/me test/reach test/news src/feed/prelaunch.spec.ts` (fresh DB, in band): 48 suites, 47 passed, 1 failed (the oracle spec above); 565 tests, 563 passed, 1 skipped, 1 failed. `test/shared/shared1a.spec.ts` passes unchanged; `prelaunch.spec.ts` passes; every hotfix1 spec passes except the one test above; `c2-joined` 6 of 6.
- Whole API suite on a fresh database: `jest --runInBand`: 112 suites, 111 passed, 1 failed; 1263 tests, 1261 passed, 1 skipped, 1 failed. The one failure is the oracle test above (free-post default), nothing else. `test:audio`: 13 of 13.

## Choices
- Strictest rule where the two sides differ: the readable rule replaces hotfix's plain status line; the window check comes before the block exemption everywhere (a nameless post is exempt from blocks, never from the window).
- A blocked replier on a nameless answer is "Someone" in the notice (hotfix's choice, kept).
- The joined spec compares only rows that refer to its own ids, because the shared test database holds other specs' posts and a global list refills its page when a named post leaves it.

## Not done
- `hotfix1-block-oracle.spec.ts` red on main's free-post default (above): needs the lead's one-line fixture decision.
- `.github/`, live providers: not touched.

## H. Final fetch
Fetched again before the push: `origin/v/hotfix-1` is 67ea461 and `origin/v/prelaunch` is bdf0aab, both already in this branch, so no second merge and no re-run was needed.

# Round 3 and C2.1 (lead record, 14 Nov 2026)

Written by the lead: the round 3 builder pushed its code without this section.

## Round 3 on the join (commits e793525, 3849a88)
- The charge sweeper's start time is taken by the new code at its first boot, never by the migration. Until it exists the sweeper does nothing; later boots never move it. Reason: the first release check's HIGH 1 (a start time stamped by the migration is minutes before the old server stops, so posts the old code takes in between would be refunded while they stand).
- An idempotent replay returns a stored post only if the post is readable now by the rule in `api/src/feed/question-window.ts` (the first check's LOW 3).
- Fixtures only, by lead ruling: `test/talk/c2-joined.spec.ts` test 6 (31 minutes, start time set) and `test/talk/hotfix1-block-oracle.spec.ts` (the replying person gets 10 free posts, because main lowered the default from 10 to 2).
- One migration in this batch: `20261114220000_hotfix_1` (sweeper state row with no start time, two partial indexes), with its rollback file.

## C2.1, joined by the lead onto 3849a88
- `v/c21-share` (2b078d5), clean merge: a share card drawn while its question was coming up is redrawn at the first request after the question opens; the picture's cache time before the opening is capped; the post-try give-back only for a not-open refusal; the share page's status is the computed one. Report: `docs/lead/reports/C21-share.md`.
- `v/c21-cost` (41fc147), one conflict (the same fixture line on both sides; one kept): `/me`, people pages, people search and the notifications routes read through a list of unreadable questions that hold posts, kept in memory for at most 15 seconds and dropped on every admin write to a question. Production runs one API process. Report: `docs/lead/reports/C21-cost.md`.
- Head f25e44f: contract identical to its build; `tsc --noEmit` clean.

## Checks
- First release check, on a7af84c: `verify/batch-c2`, `docs/lead/reports/verify-BATCH-C2-api.md`.
- Second release check, on f25e44f, with one verdict for C2 (3849a88) and one for C2.1: `verify/batch-c21`, `docs/lead/reports/verify-BATCH-C21-api.md`.
