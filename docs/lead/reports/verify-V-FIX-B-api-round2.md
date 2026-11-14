VERDICT: FIX

# Verify V-FIX-B round 2, API side

Code under test: `v/fix-b` at 4e5340e (it holds origin/main 4fa9d50; `git merge-base --is-ancestor origin/main 4e5340e` is true, so nothing newer is missing and there was nothing to merge or conflict). Checked on my own Postgres 16 (port 15432) and two Redis (16379, 16380). All stopped now. No live provider was called: the repo's fakes only; I never opened an `.env` or key file. My attack specs are not committed (copies in the scratchpad `specs/`). Only this report is committed.

Why FIX and not MERGE: no BLOCKER and no HIGH. Everything the lead ruled holds on every sequential path I could build. Two MEDIUM problems remain, both small to fix: a check-then-write race in the new edit lock (the editor's approval can land between an edit's check and its write; the Verified post then carries text the editor never saw), and a lock that never lifts when an editor answers a request in any way other than approve or decline (the poster is locked and cannot ask again). Details below with runs.

Lead rulings respected: `isNews: false` and a post with no news fields are accepted and not reported.

## First check, finding by finding

| First-check finding | Now | Run |
|---|---|---|
| HIGH-1 poster rewrites a post after an editor Verified it | **Closed on every sequential path. A race remains: N-1 (MEDIUM)** | Open request at posting: edit 409 `VERIFIED_REQUEST_OPEN`. Approve, then edit: 409, body unchanged. After decline: edit 200 (allowed again, as ruled). Asked again after that edit: 201, then edit 409. Request made after an edit: 201, the editor's queue shows the edited text, edit after the request 409. Editor `CHANGE_TAG` to Verified with no request, then poster edit: 409; editor moves it back to Gossip, poster edit 200. Editor and admin editing someone else's post: 403 (author only; they cannot). Editor editing their own Verified post: 200. Delete a Verified post (204), then post again with `VERIFIED_NEWS`: 403; with a request: 201, new post, unverified, review `VERIFIED_REQUESTED`. Voice post: edit 422 "Only text answers"; deleting its clip 409 "on a post"; `POST /text/fix` takes only text (no post id), so it cannot touch a post. Two requests at once: 201, 409, 409, one OPEN row. Approval racing an edit: see N-1. |
| MEDIUM-1 TAG_FOLLOW from a question that has not opened, and `CHANGE_TAG` re-announcing | **Closed** | Table in "Readable questions" below: future, draft, dated draft: nothing listed, announced, requested, flagged or approved. `CHANGE_TAG` to Verified on those: 404. Re-tagging an old post (not first approval) announces nothing: proved. Poll side: `pollClosed` on those: 0 and not marked. |
| MEDIUM-2 nobody can switch tag notices off | **Closed** | `notifyTagFollows` off: no notice, follows kept (3 rows), other settings unchanged, still gets POLL_CLOSED; switched back on: gets the next. Cap edges proved (0, 1, 6, 24, default, Lagos midnight). |
| MEDIUM-3 every tagged post scans all followers | **Closed** | Ten posts at once: 3 follower reads (3 pages of 500 for 1,300 followers), 3 inserts, 1,300 notices, nine others read nothing. Ten separate service instances (ten processes): same. A later post in the same hour: 0 reads, 1 to 6 ms. 50,000 followers: ten more posts at once with the hour claimed: 0 reads, 5 ms. |
| MEDIUM-4 migration backfill and the launch calendar shift (read only, conditional) | **Unchanged, still conditional** | This delta did not touch the first migration. I cannot see the droplet's `.calendar-launch-shift-done` marker. Not re-proved. |
| LOW-1 LISTEN counted for an advert outside its dates | Open, unchanged (delta did not touch `record`) | Not re-run. |
| LOW-2 guest listens with fresh keys | Open, unchanged | Not re-run. |
| LOW-3 advert accepts a removed clip | Open, unchanged | Not re-run. |
| LOW-4 owner of the clip not checked | Open, unchanged | Not re-run. |
| LOW-5 clip public after the advert ends | Open, unchanged | Not re-run. |
| LOW-6 link stored as sent | **Adverts: stricter, still stored raw (see L-4). Override link: untouched, open** | Run in "Advert links". |
| LOW-7 declined request asked again at once | Open, unchanged (201) | Seen again in the lock run (decline, edit, ask again: 201). |
| LOW-8 contract text / rollback comment | Open, unchanged | `schemas.py` CreateAnswer sentence and `rollback.down.sql:3` (`category:<id>`) not in the delta. |
| LOW-9 / LOW-10 | Unchanged, not re-run | |

## New findings

### MEDIUM

**N-1. The edit lock checks first and writes later, so an approval can land in between; the approved text is then not the text the editor saw** (proved by a run with the gap held open).
- `api/src/talk/posts.service.ts:390-413` (check) versus `:431-435` (the write). The check reads the answer without a lock; between it and the write there are two `config.num` reads and, for an edit that makes the text longer, `units.charge`. The write is `answer.update({ where: { id } })` with no condition. `AdminNewsService.decide` locks the answer row (`lockRow`) but the edit never takes that lock.
- What I did: post as Unverified with no request (so edits are allowed); start a longer edit and stop it inside `units.charge` after its check passed (I replaced `charge` with a gate; without the gate the window is a few milliseconds); then the poster asks for Verified (201) and the editor approves (200); I read the body (`original claim about fuel`); I let the edit go on. Result: edit 200, row `newsTag = VERIFIED_NEWS`, `body` = the new longer text, `editedAt` set. The editor approved one text; the Verified post carries another.
- How far it reaches: through the normal door it is a very narrow window. A poster who asks for Verified at posting is locked from the first moment, so no edit is ever in flight. The window needs an edit that passed its check just before the request or before an editor's direct `CHANGE_TAG`, and an approval inside the few milliseconds after it. A poster firing many parallel edits near an editor's `CHANGE_TAG` raises the odds, and a slow database (the 50,000 fan-out below stretches request time 3 to 5 times) widens it. I could not make it happen without holding the gap open, and I say so.
- Should happen: the write carries the condition: `updateMany({ where: { id, newsTag: { not: "VERIFIED_NEWS" }, newsReviewStatus: { not: "VERIFIED_REQUESTED" } } })` and 409 on `count 0`, or take the same `lockRow` as `decide` inside one transaction with the check.

**N-2. When an editor answers a Verified request in any way except approve or decline, the request row stays OPEN: the poster is locked from editing and can never ask again** (proved).
- `api/src/admin/trust/news.service.ts` `decide`: only `APPROVE_VERIFIED` and `DECLINE_VERIFIED` update the `NewsVerificationRequest` row. `CHANGE_TAG` (to Gossip), `KEEP` and `SEND_TO_MODERATION` set `newsReviewStatus` to RESOLVED and leave the row OPEN. The new lock (`posts.service.ts:403-412`) and `requestVerified` both read the open row.
- What I did: four posts, each posted with a Verified request; one editor decision each. Results: `CHANGE_TAG` to GOSSIP: decision 200, review RESOLVED, open rows 1, poster edit 409 "An editor is checking this post. It cannot be edited until they decide.", asking again 409 `ALREADY_REQUESTED`, post not in the editors' "asking" tab (so nobody is checking it). `KEEP`: identical. `SEND_TO_MODERATION`: identical. `DECLINE_VERIFIED`: open rows 0, edit 200, ask again 201.
- Effect: the message says an editor is checking, and none is. The edit window is 5 minutes, so the lock costs little; the dead request costs more (the person can never ask again for that post). The "ask again" half existed in round 1; the lock makes it visible.
- Should happen: those three decisions close the open request (as declined, or a new status), or both the lock and `requestVerified` look at `newsReviewStatus` as well as the row.

### LOW

**L-1. The poll sweep starves behind polls whose question is not readable** (proved). `alerts.service.ts` `sweep` takes the first 50 polls with `endsAt` in the last 2 days, oldest first, `closeAlertedAt` null; `pollClosed` now returns 0 for an unreadable question and never marks the poll. 52 such polls plus one real ended poll with one voter: `sweep()` returned `{polls: 0}`, the real poll stayed unmarked, the voter got 0 notices. Needs 50 or more ended polls under unopened or draft questions, so contrived (a calendar moved after the polls were made). Should: mark them (or skip them in the query with the readable filter).

**L-2. A post an editor published as Verified is announced a second time if it goes Verified, Gossip, Verified** (proved). The "first approval" test counts `TagChange` rows to Verified (`news.service.ts` `first`); a post published Verified has none, so the move back counts as the first. Run: editor posts Verified (follower gets 1); to Gossip (0); back to Verified (1 again). A post a member asked for and an editor approved is announced once (Verified, Gossip, Verified: 0). Should: record the publish as a first Verified, or test "was ever Verified".

**L-3. A post under a question that is over and is first approved as Verified is announced, with the old question's text** (proved; this is what you asked me to say). Closed question, and one past its window: it stays in `/news`, `/news/tags`, can be requested, flagged and approved (all 200 or 201). Approval sends TAG_FOLLOW to the tag's followers, body = that question's text ("Q-overClosed"). That follows the ruling to the letter (readable = open or over); there is no age limit, so an approval of a three-week-old post tells every follower "New under Verified News". If that is not wanted, add an age or "still open" rule. Owner call; I did not mark it a bug.

**L-4. Advert links: a few shapes pass that are not a working link or not clean** (proved, same on all four kinds, create and update).
- `https:good.example` and `https:/good.example` pass (`new URL` repairs them), stored as typed. FEED_CARD, BANNER and AUDIO_SLOT cannot be approved (422, the checklist wants `https://`); WALLET_OFFER is approved, and the placement hands the page `linkUrl: null`.
- `https://./x` passes (the host "." contains a dot) and is handed to the page. `https://192.168.0.1/admin` passes.
- The stored and handed string is the typed one: `HTTPS://GOOD.EXAMPLE/Path`, `HtTpS://good.example`, `https://good.example/a b`, a tab or newline inside (`https://good.\texample`, `.../a\nb`), a quote (`https://good.example/"onmouseover="alert(1)`), a backslash (`https://good.example\@evil.example`), a raw IDN (`https://bücher.example/straße`, `https://💩.example`) all reach the page unchanged. Edge spaces are trimmed (`Transform(trim)`). Nothing runs script (all https; the page must escape); browsers read the tab, newline and backslash as the host the page shows. Should: store `new URL(x).href`, refuse a host that is not a real name.
- Right: `http:`, `javascript:`, `data:`, `https://localhost/x`, `https://intranet`, `https://user:pass@host`, `https://user@host`, `https:x`, `https://[::1]/`, an address over 500 characters (422), `https://good.example\njavascript:alert(1)` (422), and an empty string (stored empty, handed as null). Same answer from all four kinds once the admin throttle (120 a minute) is not hit (my first pass hit 429 on the fourth kind and I redid it paced).

**L-5. A TAG_FOLLOW fan-out that is skipped because another is running in this process takes no marker** (read, plus the ten-at-once run). A post that arrives while a fan-out for the same tag is still running (13 s at 45,000 followers) returns 0 and is not announced; a later post in that hour announces itself instead. A process that dies mid fan-out never reaches its `finally`, so the marker stays and the rest of that hour's followers are never told (not run; reasoned from the code). Both are bounded to one hour of one tag.

**L-6. A poll notice for a topic poll carries the id of the topic's first non-spare question whatever its status** (read, `reach.service.ts`). For a question poll the shape is proved (below). A draft first question would give an id that 404s.

**L-7. Three new eslint warnings, all in the builder's `test/admin/fixb-r2.spec.ts` (lines 85, 93, 100, no-unsafe-argument).** 0 errors.

**L-8. Markers are cleaned only by `sweep`** (proved: old rows removed, recent kept). The sweep timer is off when `REACH_JOBS=off`. The table grows at most 24 rows a day per tag (72), so nothing to fear either way.

## Readable questions (item 2), proved by run

Posts under six kinds of question, one follower per tag, one poll with a voter each:

| Question | /news list, tag list | GET /news/{id} | request | flag | approve | CHANGE_TAG to Verified | CHANGE_TAG to Gossip | tagPost | pollClosed |
|---|---|---|---|---|---|---|---|---|---|
| open (LIVE) | listed | 200 | 201 | 201 | 200 | n/a | 200 | announced | 1, marked |
| future (SCHEDULED, starts in 5 h) | no | 404 | 404 | 404 | 404 | 404 | 200 | 0 | 0, not marked |
| draft | no | 404 | 404 | 404 | 404 | 404 | 200 | 0 | 0, not marked |
| draft with dates | no | 404 | 404 | 404 | 404 | 404 | 200 | 0 | 0, not marked |
| over (CLOSED) | listed | 200 | 201 | 201 | 200 | n/a | 200 | announced (L-3) | 1, marked |
| over (window ended) | listed | 200 | 201 | 201 | 200 | n/a | 200 | announced (L-3) | 1, marked |

- `/news/tags` count after all of that: Verified 3 (open, closed, window-ended), the other two 0 (their posts were re-tagged); none from the unreadable ones.
- For the unreadable rows I made the open request by hand (the route refuses). Approve 404; `DECLINE_VERIFIED` 200 (an editor can clear it). `CHANGE_TAG` to Gossip works (200) and announces nothing; this is not a leak, say if you want it refused too.
- Not proved: whether the editors' own queue (`/admin/news/items`) still lists a request on a post whose question went back to unreadable. My query of it did not return items; I did not chase it.
- **Helpers against `origin/v/prelaunch`** (`git show origin/v/prelaunch:api/src/feed/question-window.ts`): `isQuestionReadable` is the same body (`isQuestionOpen || isQuestionOver`); the file's other helpers match. `questionReadableWhere`: fix-b writes `OR [open, {status: CLOSED}, {status in SCHEDULED/LIVE, endsAt <= now}]`; prelaunch writes `OR [open, questionOverWhere]` with `questionOverWhere` being those same two lines. Run: 100 questions (4 statuses x 5 start values x 5 end values, including `startsAt = now`, `endsAt = now`, one millisecond either side): 0 differences between the two functions, 0 between the two Prisma filters (66 readable, same ids), 0 between each filter and its own function. Same rule in effect. **Differences that will bite the merge**: prelaunch adds `questionOverWhere`, `answerReadableWhere`, `replyReadableWhere`, `lagosDateWords`, `isShownComingUp`, `notOpenYet` that fix-b lacks; both add the two same-named helpers at the same place. A trial merge of `origin/v/prelaunch` into 4e5340e (throwaway copy, aborted, nothing pushed) gave 5 conflicts: `api/src/feed/question-window.ts`, `api/src/me/views.ts`, `api/src/news/news.service.ts` (imports, and `visible`: prelaunch `...answerReadableWhere(now)` against fix-b `question: questionReadableWhere(now)`, which are the same filter), `api/src/reach/reach.service.ts` (the notification mapping: fix-b's POLL_CLOSED `questionId` block against prelaunch's), `docs/contract/src/schemas.py`. Resolution: keep prelaunch's `question-window.ts` whole (it exports everything fix-b imports: `isQuestionReadable`, `questionReadableWhere`), keep both sides' notification mapping, regenerate the contract.

## TAG_FOLLOW (item 3), proved by run

- Sources: a member's post published under a tag: follower 1, switched-off person 0. "Not news" and no-tag posts: 0. Editor `CHANGE_TAG` Gossip to Unverified, `KEEP`, `SEND_TO_MODERATION`: 0. First approval as Verified: 1. Verified to Gossip to Verified: 0. Editor posts Verified: 1 (L-2 for the move back).
- Switch off: no notice; `newsTagFollow` rows still 3; settings response differs only in `notifyTagFollows`; POLL_CLOSED still arrives; on again, the next post is delivered.
- Cap (`alerts.tag_follow_per_day`), one person following Gossip, one candidate post each hour of a Lagos day (clock passed as `now`, notices dated to match): cap 0: none. Cap 1: hour 0 only. Cap 6: hours 0 to 5. Cap 24: all 24; across 30 hours: 30 (24 on day D, 6 on D+1). No row (default): 6, same as cap 6. Lagos day edge, cap 1: a post at Lagos 22:05 and one at Lagos 00:05 next day: both delivered; two posts the same day (Lagos 21:05 and 22:05): second dropped; posts at 22:59:59.999Z and 23:00:00.000Z: both delivered (new Lagos day at 23:00Z); posts at 21:59:59.999Z and 22:59:59.999Z (same Lagos day, different clock hours): second dropped.
- 30 Verified posts in one Lagos day, one person following Verified, default cap 6, one notice per clock hour at most, each notice points at the first post of its hour:
  - one post every 48 minutes: **6 notices**, pointing at posts 0, 2, 3, 4, 5, 7 (counting from 0), at minutes 0, 96, 144, 192, 240, 336. The other 24 posts are never announced to that person that day.
  - all 30 in one hour: 1 notice (post 0).
  - 30 posts every 16 minutes: 6 notices, posts 0, 4, 8, 12, 15, 19.
  - evening burst (one every 12 minutes from 18:00): 6 notices, posts 0, 5, 10, 15, 20, 25.
  - cap 24, one every 48 minutes: 24 notices, posts 0, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29.
  - So with the default 6, a person gets the day's first six busy hours, and Verified news in the evening of a busy day does not alert them. That is the ruling working as written; the default (6) is an owner number.

## Marker row (item 4)

- Ten posts at once (1,300 followers): one instance: returns `[1300, 0 x9]`, 3 `newsTagFollow.findMany`, 3 `createMany`, 1,300 notices, 1 marker. Ten separate `AlertsService` instances (ten processes): same, so the marker row, not the in-process flag, carries it. A later post in the hour: 0 reads, 6 ms.
- Failure half way (second `createMany` throws): 500 written, marker 0 (given back). The next post in the hour: wrote 800, total 1,300, marker 1. Nobody got two (most notices on one person: 1). The first 500 hold the first post's notice, the other 800 the second's; nobody got both because the unique key is (person, hour key). Nobody twice, but the first 500 never hear of the second post.
- Growth and cleaning: at most one row per tag per hour (72 a day). `sweep()` deleted rows older than 3 days (4 days and 3 days 1 hour went; 2 days and 0 stayed). L-8.
- 50,000 followers (45,000 active, 5,000 suspended), my machine, nothing else running: 45,000 notices in 13.1 s; 100 inserts (slowest 155 ms measured around the call; 10.5 s of the 13.1 s is inserting); follower reads at most 20 ms, eligibility reads at most 23 ms, the cap's grouped read 18 ms at most. Process memory (jest harness included): RSS 361 to 697 MB, heap 139 to 470 MB. Worst event-loop stall 142 ms. Longest statement seen from another connection (sampled every 20 ms): about 359 ms; longest transaction the same (each insert page is its own transaction; no long transaction). **A person posting at that moment (plain post, no tag):** 43 to 104 ms with nothing running, 143 to 265 ms while the fan-out ran (all 201 or the free-allowance 402), 14 to 23 ms right after. The post's own response never waits for the fan-out (fire and forget). An earlier run of the same test while the full suite ran on the machine gave the same shape (13.1 s, 138 to 307 ms).
- Second post in the same hour with 50,000 followers: 0 reads, 2 ms; ten more at once: 0 reads, 5 ms (the first checker saw 9 s and 78 s).

## Advert links (item 5)

Run for FEED_CARD, BANNER, AUDIO_SLOT, WALLET_OFFER, on create and on update, then the ad set to approved by hand (and by the real approval route for FEED_CARD and WALLET_OFFER) and the public placement read. Summary in L-4. In one line each: `https://good.example`, with path and query: 201/200, handed as typed. `http://`, `javascript:`, `data:`, no-dot host, sign-in part, `https:x`: 422. Mixed-case scheme: accepted, handed as typed (still a working link). `https:good.example`: accepted, handed as null.

## Existing assertions the builder changed (item 8)

- `api/test/me/me.spec.ts` settings `toEqual` gains `notifyTagFollows: true`: follows the new setting; nothing else touched. Right.
- `api/test/news/news.spec.ts`: the question gains `status: "LIVE"` (it was a draft by default). Run: the old file on this tree fails 10 tests, every one a news post under a draft question that the lists and the page no longer show or find (guest list, tag filter, post page, flag, blocks and anonymous tests): exactly the readable-question rule, nothing else. With the one-line change all 12 pass. Hides nothing else: the other assertions in the file are unchanged.
- Also changed by the builder, not on your list: `api/test/admin/fixb-news.spec.ts` (people used for three posts changed from `poster` to `other` / a new `poster2`; one `TRUNCATE "AlertMarker"`) and `api/test/reach/fixb-alerts.spec.ts` (adds the `questionId` assertion). The old fixb-news spec fails here with 402 on its third post by one person: that is the free-allowance rule that came with main (my own posts by one person hit it too). Assertions are the same; only who posts changed. Nothing weakened.

## POLL_CLOSED questionId (item 7)

A notice list built from one row of every notification type (types read from the database enum) on origin/main and on this tree, ids and times masked: the JSON is identical except `POLL_CLOSED.questionId` (null on main, the question's id here). Additive; nothing else about the notice changed. Topic polls: L-6.

## One-tap posting (item 9)

On origin/main and on this tree, same script, ids and times masked: a plain text post (`{kind, body}`), `{isNews: false}`, a voice post with no news fields, `GET /answers/{id}`, a plain edit, the question's answer list, `/news`, `/news/tags`, a Gossip post. Responses (status and body) identical. The only difference in the whole file is the POLL_CLOSED `questionId` above. `/me/settings` differs by the new `notifyTagFollows` (not part of this compare; shown in the switch run).

## Migrations (item 6), proved by run

A database built from origin/main's 18 migrations (so `20261114170000_subscription_terms` is already in), with 2 UserSettings, 2 Polls (one ended, one future), 3 Questions (past, future, draft):
- `prisma migrate deploy` applied both new ones after it, out of name order (160000 after 170000): worked. `notifyTagFollows` = true on both existing rows (defaults), `AlertMarker` created empty, ended poll and started question marked, future ones null. Counts unchanged (2, 2, 3).
- Rollback in order (230000 then 160000), rows present: both ran, columns and table gone, counts 2, 2, 3. Migration rows deleted, `migrate deploy` re-applied both (second time round), rows intact, defaults true. Down both again: clean.
- Rollback of 230000 with a person who switched the alerts off: `ERROR: rollback refused: people have switched news tag alerts off`, nothing changed. Cleared, then down worked.
- Down 230000 run twice: the second fails cleanly (column missing), nothing else changes. Wrong order (160000 first, then 230000): both worked; they do not depend on each other.
- Empty database: up, down both, up, down both: clean.
- Additive: one defaulted NOT NULL column (instant in Postgres 16) and one new table; the rollback file says to delete the `_prisma_migrations` row, as before.

## Checks (item 11), exact counts

- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"` (no `--fix`): 0 errors, 44 warnings. origin/main alone: 0 errors, 41 warnings. The three extra are L-7.
- Builder's four specs plus `test/app.contract.spec.ts`: 5 suites, 40 passed.
- By folder (each alone): `test/talk` 10 suites, 211 passed; `test/feed` 2 suites, 15; `test/admin` 27 suites, 264; `test/reach` 13 suites, 114 passed, 1 skipped; `test/news` 1 suite, 12; `test/me` 12 suites, 108. All six together plus the builder's specs: 65 suites, 724 passed, 1 skipped, 0 failed.
- Full API suite once (`jest --runInBand`): 107 suites, 1,243 passed, 1 skipped, 0 failed. `test/audio.test.ts`: 13 of 13. No failure, so nothing to compare with origin/main.
- Contract: `python3 docs/contract/src/build.py <temp>` exit 0; `cmp` against `docs/contract/openapi.yaml`: byte for byte identical.

## Proved by runs

Everything above marked "proved", on 4e5340e with the fakes: the lock on every sequential path, the race with the gap held open, the stuck request, the readable-question table, the helper grid, the sources, switch, cap edges, 30-post days, marker (one and ten instances, failure half way, cleanup, 50,000), advert links on four kinds, migration up, down, twice, with and without rows, old and new JSON compare, tsc, lint, specs, full suite, contract build.

## Read only

- The `first` test in `decide`, the busy-flag skip and a dead process leaving a marker (L-5), the topic-poll question pick (L-6), `ads.ts` placement filter, the lock's placement in `editAnswer`.
- A held post that is later released is never announced (`tagPost` runs only at creation): read, not run.
- The earlier LOWs 1 to 5 and 10: not in the delta; not re-run.

## Not proved

- The droplet's `.calendar-launch-shift-done` marker (MEDIUM-4 of the first check).
- Two real API processes at once (I simulated them with ten `AlertsService` instances against one database; the marker held).
- The race N-1 without the held gap (I could not hit it by timing alone).
- Whether the editors' queue lists a request on a post whose question has gone back to unreadable.
- Real storage, signed link lifetime, the web side: out of scope.
- The 50,000 figures are on my machine and pool (20 connections); the production machine and database size will differ.
