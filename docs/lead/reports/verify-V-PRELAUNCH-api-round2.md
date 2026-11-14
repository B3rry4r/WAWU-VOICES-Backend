VERDICT: MERGE

# Verify V-PRELAUNCH, API, second check (round 2)

Code under test: `v/prelaunch` bdf0aab (API) on a local merge with origin/main 4fa9d50 (never pushed). Every claim is marked **run** (I ran it and saw the result) or **read** (code only). No live provider was called; production was read as a guest only (`GET /calendar`). I did not change the builder's code. My specs and scripts stay uncommitted; this report and its route table are the only files I commit.

**Merge with origin/main (local copy, not pushed):** two conflicts, both mine to resolve, both mechanical.
1. `api/src/me/views.ts` (profile counters): origin/main added `verified: isVerifiedNow(u)` next to `replyCount` / `reactionsReceived`; the branch changed the same lines to `hiddenCounters`. Kept the branch's three counters and added `verified: isVerifiedNow(u)` after them.
2. `docs/contract/src/schemas.py` (`ErrorCode`): main added `subscription_required verification_required`, the branch added `QUESTION_NOT_OPEN`. Kept both.
`docs/contract/openapi.yaml` merged without a conflict. Result: tsc 0, contract byte-identical (item 11).

## Verdict reasoning
Every finding of the first check is closed by a run. I found no BLOCKER and no HIGH. The owner's rule holds on every route I swept at all four moments. What I found are two MEDIUM items and some LOW ones (below); none needs a fix before 23:00 to keep the rule. The one I would fix first if there is time is M-A (a card shared before 23:00 keeps saying "Opens Sunday 15 November").

## The first check's findings

| id | finding | status | run |
|---|---|---|---|
| B1 | `test/shared/shared1a.spec.ts` red on the merged tree | **closed** | File is unchanged against origin/main (`git diff origin/main -- api/test/shared` is empty). `test/shared` passes in the 40-suite batch (item 12). Full suite on the merged tree: 104 suites, 0 failed. |
| H1 | clip id served the transcript and the audio address of a hidden answer | **closed** | Item 5. Clip of a hidden answer, reply and proposal: 404 on `/voice-clips/{id}` and `/play` for guest, other member, follower, anonymous author, moderator, admin; 200 only for the clip's owner. Sweep: clip routes at 05:00, 22:59:59.999, 23:00:00.000: content only for the owner. At 17 Nov 00:00 everything is back (61 content-bearing routes, same as the open control). |
| H2 | no share link for the launch question | **closed** | Item 3. Guest and member `POST /share/links` for the launch question: 201 at 14 Nov 05:00. |
| M1 | unread badge counted notices the list hides | **closed** (one edge, L-3) | Item 6. 7 viewers x 3 moments x every notification type: list unread = `/notifications/unread-count` = `/me.unreadNotifications` = `list.unread` in all 21 cases. |
| M2 | public profile counters included hidden posts | **closed** | Item 7. At 05:00 and 23:00 the three counters are 0 for people whose posts are all under unopened questions; at 17 Nov 00:00 they equal the stored values. |
| M3 | refused post counted against the 20 per 10 minutes and locked a person out | **closed** (see L-2) | Item 4. 30 refused tries at 22:58, then a post at 23:00:05: 201. |
| L1 | `where-you-sit` and author video list 200 for the author | **closed** | Sweep: `/answers/{a}/where-you-sit` and `/videos` are 404 for the author at 05:00, 22:59:59.999, 23:00:00.000 (200 on main). |
| L2 | SCHEDULED week showed `questionCount` 10 and a `weeklyPollId` | **closed** | Item 8. |
| L4 | contract did not mention `QUESTION_NOT_OPEN` / Home `trending` | **closed** | `ErrorCode` lists `QUESTION_NOT_OPEN`; the 409 description names it; the Home description says "trending is the top voices of today's question only". Contract equals its generator (item 11). |

## New findings

### BLOCKER
None.

### HIGH
None.

### MEDIUM

**M-A. A "coming up" card stays "coming up" after the question opens, for every link whose sharer does not tap Share again. (run)** `api/src/reach/share.service.ts:363` `image()` serves the stored PNG without comparing it with the question as it is now; the card is only redrawn inside `createLink()` (`:520-560`, when the spec hash changes). Run: member makes a link to the launch question at 14 Nov 05:00 (card READY, `leanLine` "Opens Sunday 15 November"). The card bytes (sha1 41d87c6350f2) are identical at 22:59:59.999, 23:00:00.000, +1 hour, +1 day and +3 days, with `Cache-Control: public, max-age=3600` (nginx `X-Accel-Expires: 30`). The share **page** is live the moment it opens (`summaryLabel` "Based on the voices so far", `og.description` "Add your voice"), so only the picture is stale. After the same member calls `POST /share/links` again at 23:05 the bytes change (card redrawn, no "Opens" line). So: a person who shared the launch question before 23:00 and never taps Share again has a link preview (WhatsApp and similar keep previews for days) that says "Opens Sunday 15 November" for as long as they like. Guests share one link per question (one code for all guests, `sharerId` null), so the web calling `POST /share/links` after 23:00 for any guest fixes all guest links at once. Should: when the question has opened, `image()` (or the page) redraws a card whose stored words are the coming-up ones; or the web calls `POST /share/links` for the launch question just after 23:00.

**M-B. Profile, `/me`, people search and the notification bell cost 2 to 5 times more SQL than on origin/main. (run)** Item 10 (table below). `hiddenCounters` and the readable filter add a hash join to `Question` (a seq scan of the question table, about 1,200 rows here) per query and about 48 extra statements per profile request: `people/{id}` 4.4 -> 22.4 ms SQL, 36 -> 84 statements; `me` 11.6 -> 41.5 ms, 57 -> 87; `me/answers` 4.4 -> 12.5; `search people` 11.6 -> 22.0; `notifications/unread-count` 5.4 -> 12.2; `notifications list` 7.7 -> 11.2. No index was lost: the Answer, Reply and Notification lookups use the same indexes on both trees. `/me` and `unread-count` are the hot authenticated routes (every app open, every bell poll), but the absolute cost is tens of milliseconds on one shared CPU, so I rate it MEDIUM, not blocking. Home, `feed/trending` and category got cheaper (Home 84 -> 22 ms SQL).

### LOW

- **L-1. With a gap in the calendar, the question shown as coming up is the next dated one, however far.** (run) `todayQuestionId` takes the next daily question with a later date. I set the 8 daily questions dated 21-28 Nov to DRAFT: at 21 Nov 12:00, 24 Nov 12:00 and 28 Nov 12:00 `isShownComingUp` is true for exactly one question, the 29 Nov one (8 days away); Home, `/questions/today`, `GET /questions/{id}`, the 409 and share links all follow it. Still exactly one question, and never two. Production's calendar has no gap (`GET /calendar`: weeks 1, 2, 3 ... contiguous), so tonight this does not happen. If the lead reads "one step" as "the next day only", `todayQuestionId` needs `scheduledFor <= today + 1`.
- **L-2. The give-back is by status, not by reason.** (run, `talk/talk.controller.ts:147-163`) Any 404 or `QUESTION_NOT_OPEN` from a post or reply gives the try back. On an open question: 25 posts that fail with 422 (no mood word) -> 20 x 422 then 5 x 429 (counted, correct). 40 posts to an unknown question id, and 40 replies to an unknown answer: 40 x 404 each, no 429 ever (given back). Also true for a reply that is 404 because the answer's author blocked the replier. It gives no free post (a 404 posts nothing) and the daily limit is separate; 30 pairs of (404, valid post) fired at once from one member gave 20 x 201 and 10 x 429, so I could not make the pop-newest race let extra posts through (not proved impossible: `give()` pops the newest entry, which under concurrency may belong to another request of the same person). Should: give back only for `QUESTION_NOT_OPEN` and for the V-27 404 of an unopened question.
- **L-3. Unread badge past 500.** (run, builder said so) A person with 600 unread REPLY notices on open answers: list shows 600 unread, badge 500. With 50 more plain notices: list 650, badge 550. Edge: 100 visible notices older than 500 hidden ones: list shows 100 unread, **badge 0**. Up to 500 the badge equals the list (item 6).
- **L-4. Home `trending` is not what origin/main answers, in an open world.** (run, item 9) By design (builder, "Point 2"): today's question's top 2 voices instead of the best across questions. Listed so the lead can say it is accepted; it is the only content change to an open-world route besides L-5.
- **L-5. `/me/saved` and the admin moderation item's category `questionCount`** is 2 or 3 where origin/main says 71 (main counted questions not started). Intended, same as the first check's L3.
- **L-6. The share page's `question.status` is "SCHEDULED" at 23:00:00.000** while `/questions/today` says LIVE (run). The page text changes correctly; the stored status is shown. Not compared with origin/main (not run).
- **L-7. Square card of the launch question is 404 before opening** (run: `/share/{code}/square` 404, `squareImageUrl` null; card and story are drawn). Fine if the web does not ask for it.
- **L-8. eslint:** 0 errors; 43 warnings against 41 on origin/main (two unused `eslint-disable` lines in the new `src/feed/prelaunch.spec.ts`).

## Task by task

### 1. Sweep (run)
World built the way production is: `seed:questions` (importQuestions), `seed:launch`, content posted through the real API at 13 Nov 10:00 on the question the shift moves to 17 Nov, and on the one it moves to 16 Nov, then `applyShift` (the code `calendar:launch-shift --apply` runs). Content: text answers (named, anonymous, gossip, verified news), voice answers and replies with clips and transcripts, replies, reactions, likes, helpful, saves of answers and questions, two reports, a listen, share links, mood words, tag and category follows, a proposal with a clip, a video row, 12 notifications per person of every type to four people. Seven viewers (guest, other member, author, anonymous author, follower, moderator, admin). **102 GET templates from the contract** (103 in the merged contract; I skipped only the SSE stream `/polls/{id}/results/stream`, which never ends) expanded with ids and variants to **265 URLs x 7 viewers = 1,855 requests per moment**, run on the merged tree and on origin/main at: 14 Nov 05:00:00, 14 Nov 22:59:59.999, 14 Nov 23:00:00.000, 17 Nov 00:00:00, plus a control before the shift (13 Nov 10:30, everything open) to learn which routes carry the seeded content.

| tree | moment | 200 | 404 | 401/403/422 | routes with the seeded content |
|---|---|---|---|---|---|
| origin/main | 05:00 / 22:59:59.999 / 23:00:00.000 | 998 / 998 / 1026 | 582 / 582 / 547 | 275 | 42 / 42 / 42 |
| merged head | 05:00 / 22:59:59.999 / 23:00:00.000 | 770 / 770 / 798 | 810 / 810 / 775 | 275 | **5 / 5 / 5** (all expected, below) |
| merged head | 17 Nov 00:00 | 1194 | 365 | 296 | 61 (control: 61) |

The 5 routes that still carry content before 17 Nov 23:00: `/voice-clips/{id}` and `/play` (only for the clip's own owner: author, follower, other, each their own clip), `/admin/moderation/items`, `/admin/moderation/items/{id}` (moderator and admin), `/admin/topics/{id}` (admin). Nobody else gets anything. At 23:00:00.000 the launch question opens and nothing else changes (the 16 and 17 Nov questions stay hidden); at 17 Nov 00:00 everything is back on the same 61 routes as the control. Full route list with the result per moment: `docs/lead/reports/verify-V-PRELAUNCH-api-round2-routes.md`. My limits: the throttle answered 429 on `/search` for some viewers in my first runs (fake clock against a real-time window); I gave each viewer and moment its own address and the final runs have none.

### 2. `isShownComingUp` (run, every question in the database tested at each moment (about 1,030 of them unopened), spares and drafts included)
| moment | true for | Home / `/questions/today` | any other unopened question readable by id |
|---|---|---|---|
| 14 Nov 05:00 | the launch question (dated 15 Nov, opens 23:00) | same, SCHEDULED | none (1,031 -> 404) |
| 14 Nov 22:59:59 and .999 | the launch question | same, SCHEDULED | none |
| 14 Nov 23:00:00 | the launch question (now open: nothing is "coming up") | LIVE | none |
| 15 Nov 22:59 and .999 | the launch question (open since Sat 23:00; today in Lagos is still 15 Nov) | LIVE | none: the 16 Nov bank question is NOT shown as coming up while the launch question is open; GET by id 404 for guest and member |
| 15 Nov 23:00 | the 16 Nov question (it has just opened) | LIVE | none |
| 16 Nov 12:00 and 22:59:59.999 | the 16 Nov question | LIVE | none: the 17 Nov question stays 404 until 23:00 |
| 16 Nov 23:00, 17 Nov 12:00 | the 17 Nov question (open) | LIVE | none |
| override live (18 Nov 12:00, emergency) | the override's question (open) | LIVE | none |
| override ended 18 Nov 20:30 (the override moved the 18 Nov question to 19 Nov) | the 19 Nov question | SCHEDULED | exactly that one |
| planned override, not yet started (19 Nov 10:00) | the 20 Nov question (the override had already moved the day's question) | SCHEDULED | exactly that one |
| planned override live (19 Nov 13:00) | the override | LIVE | none |
| nothing for a week (21, 24, 28 Nov) | the 29 Nov question, 8 days ahead (L-1) | SCHEDULED | exactly that one |
At no moment was it true for two questions (it compares one id). A question "more than one step ahead" is only possible when the days between are empty (L-1). Answer to your question: while the launch question is open, the 16 Nov bank question is not shown as coming up, and that is right under the ruling (one question: today's). `GET /questions/{id}` for every other unopened question: 404 for guest and member at every moment.

### 3. Sharing before opening (run, 14 Nov 05:00 unless said)
- `POST /share/links` QUESTION launch: guest 201, member 201; every other kind of viewer 201. 120 guest posts in a loop: 120 x 201, one code, one guest row in `ShortLink` (members get one link each: 2 rows after the loop plus 1 member row per viewer). The 300 per minute per address throttle was not reached (varied addresses; the limit itself is read).
- Share page: `topicLine` the question text, `summaryLabel` and `og.description` "Opens Sunday 15 November", `basedOnVoices` 0, no arguments, poll, featured voice, transcript, news; none of the seeded answer texts or ids appears in the body. Card: `ShareCard` row `topicLine` = question text, `leanLine` "Opens Sunday 15 November", no chips, no count. Card routes: `/card`, `/card?size=story|square|wide` (size is ignored, one 1200-wide PNG, 52,853 bytes), `/story` (200, 96,500 bytes): 200 `image/png`. `/square` 404 (L-7). The card text itself is the stored words above (I did not read the PNG pixels).
- Refused (404 for guest and member): an answer on the unopened question, an answer on the 16 Nov question, a **made-up answer id**, the 16 Nov, 17 Nov and a later bank question, a made-up question id, a poll result of the unopened week.
- After opening: 22:59:59.999 page unchanged; 23:00:00.000 the same link shows the live question (above). The picture: M-A.
- Caches: page `public, max-age=30`; card `public, max-age=3600` (+ nginx 30 s, read from `share.controller.ts`); stored PNG `immutable` in Spaces (read). The "coming up" PNG never changes by itself.

### 4. The 409 and the give-back (run)
- 30 refused tries at 22:58 by one member (text, mood word included): 30 x 409 `QUESTION_NOT_OPEN` "This question opens on Sunday 15 November."; `RateLimit-Remaining` 19 each time (each try is counted, then given back). Also refused 409: a voice try with a READY clip; a reply to a hidden answer: 404.
- Snapshot before/after (free allowance, wallet, charges, ledger transactions and entries, usage counters, extra-voice tokens, clips, answers, replies, subscription credits, idempotency rows): **identical**. The daily counter did not move.
- 23:00:05: post 201 (one free post used). Same Idempotency-Key as three 409s at 22:59: 201 at 23:00:00, one answer; the same key again: 201, same answer id (replay).
- After the refusals the member could make 20 posts in 10 minutes (20 x 201, then 429): the refusals did not count. 24 posts attempted: 17 x 201 + 7 x 429 after 3 counted ones earlier (2 posts and one replay).
- Not proved: the extra-voice-token path (my seed has no payment row, so no token); read only: the refusal comes before `content()`/`spendThen` (`posts.service.ts:183`). Other reasons and the race: L-2.

### 5. Clip routes (run)
Clip of an answer (owner author), of a reply (owner follower), of a proposal (owner other), at 05:00, 23:00:00.000 and 17 Nov: before 17 Nov 00:00 `/voice-clips/{id}` and `/play` are 404/404 for guest, another member, the follower, the anonymous author, the third member, moderator and admin, and 200/200 (transcript and signed address) for the owner only; at 17 Nov 00:00 open (control). Moderation: `GET /admin/moderation/items` 200 (2 reported items), `GET /admin/moderation/items/{id}` 200 with `transcript` "Quokka voice reply transcript" and `playUrl` field (the moderator can still act). Transcript search `?q=quokka`: 200 with no hit for every viewer at 05:00, the owner included. Clip of an open question (voice answer on the launch question at 23:00:05): 200/200 for guest, another member and follower.

### 6. Unread badge (run)
For every viewer (author, anonymous author, other, follower, third, moderator, admin) at 05:00, 23:00:00.000 and 17 Nov: the unread notices in the paged list = `/notifications/unread-count` = `/me.unreadNotifications` = the `unread` field of the list, with all 12 types seeded (stored unread 12 to 18 per person; shown 2 before opening, all 12 to 18 at 17 Nov). A person with 600: L-3.

### 7. Profile counters (run)
Author (1 hidden voice answer and 1 open one), other (3 replies), follower, third (posts only under open questions). 05:00: `voiceCount` `replyCount` `reactionsReceived` 0 on `/people/{id}`, `/people/by-handle`, `/me`, and the people search, while the stored values are 2/0/3, 0/3/0, 0/1/0. At 17 Nov 00:00 they are 2/0/3, 0/3/0, 0/1/0, equal to stored. A person with posts only on open questions: the JSON of `/people/{id}`, `by-handle`, `/me`, `/search?type=people` is identical to origin/main at 17 Nov 00:00 and in the control (item 9, no difference reported).

### 8. A week that has not started (run)
Home `topicOfWeek`, `/topics/current`, `/topics/{id}` at 14 Nov 05:00, 23:00:00.000 and 15 Nov 22:59:59.999: status SCHEDULED, `startsOn` 2026-11-16, `questionCount` 0, `weeklyPollId` null, `reportId` null (a PUBLISHED report existed for the week), `voiceCount` 0, `voicesCount` 0. At 15 Nov 23:00:00.000 (Monday in Lagos): LIVE, 10, poll set, report set, counts as stored. The running week is unchanged against origin/main (no difference on `/topics/{week 1}` at 17 Nov 00:00); week 2 at that moment shows 0 and null (not started).

### 9. Open world against origin/main (run)
Same seed on both trees, 1,855 route-by-viewer responses at the control moment and again at 17 Nov 00:00, ids and share codes mapped to names, other uuids and real-clock stamps masked. Different responses: **48** (control) and **49** (17 Nov). Every one:
- `/topics/{week 2}`, 7 viewers: `questionCount` 10 -> 0, `weeklyPollId` -> null (week 2 not started; item 8).
- `/home`, 7 viewers: `trending` (L-4).
- `/me/saved`, `?type=answers`, `?type=questions` (2 viewers each), `/admin/moderation/items/{id}` (2): category `questionCount` 71 -> 2 or 3 (L-5).
- Noise, not behaviour: `/calendar` and `/calendar?status=SCHEDULED` (7 each): `nextCursor` carries a random id; `/me` `referralCode` (6) and `/me/invite` `code`, `url` (6): random; `/polls/{id}/results` `asOf` at 17 Nov (1): the cached result carried the 23:00 stamp in one tree and not the other (same body otherwise).
Nothing else differs.

### 10. Speed (run)
Both trees on the same machine, Postgres 16, same database content: 200 questions (141 started, 59 not), 50,000 answers, 2,000 users, 10,000 replies and 5,000 notifications for one person (3,000 unread), clock 17 Nov 12:00. SQL ms = sum of statement durations for one warm request, from the Postgres log; plans from `auto_explain` with ANALYZE and BUFFERS (I read them for each request; the heaviest are cited). One shared CPU, no concurrency: a plan check, not a load test.

| route | wall ms main / head | SQL ms main / head | log statements main / head |
|---|---|---|---|
| home guest | 83.2 / 50.7 | 83.7 / 22.0 | 123 / 129 |
| home member | 80.3 / 57.3 | 75.6 / 28.7 | 147 / 144 |
| questions/today | 16.4 / 24.8 | 6.7 / 8.9 | 33 / 39 |
| question answers NEW | 18.0 / 23.8 | 6.4 / 10.7 | 51 / 54 |
| question answers TOP | 18.4 / 29.3 | 8.1 / 8.0 | 51 / 54 |
| question answers DEBATED | 21.8 / 23.7 | 7.4 / 9.8 | 51 / 54 |
| feed/new | 17.9 / 19.9 | 7.7 / 12.3 | 66 / 69 |
| feed/trending | 39.9 / 18.3 | 29.6 / 8.2 | 24 / 24 |
| feed/trending-questions | 15.4 / 17.4 | 9.3 / 12.4 | 66 / 69 |
| search answers rice | 51.9 / 81.4 | 38.2 / 58.7 | 69 / 75 |
| search rice (all) | 79.8 / 103.8 | 58.5 / 81.6 | 198 / 204 |
| search people | 22.2 / 41.8 | 11.6 / 22.0 | 66 / 93 |
| notifications list | 28.2 / 35.6 | 7.7 / 11.2 | 36 / 48 |
| notifications unread-count | 21.0 / 28.1 | 5.4 / 12.2 | 21 / 27 |
| people/{id} | 16.8 / 42.0 | 4.4 / 22.4 | 36 / 84 |
| people/{id} member | 19.7 / 37.0 | 5.9 / 19.9 | 51 / 99 |
| me | 31.2 / 52.3 | 11.6 / 41.5 | 57 / 87 |
| me/answers | 16.7 / 30.9 | 4.4 / 12.5 | 42 / 66 |
| me/saved | 12.5 / 11.7 | 2.8 / 5.5 | 36 / 36 |
| category | 65.8 / 32.0 | 56.4 / 24.8 | 81 / 84 |
| news | 9.5 / 10.8 | 1.3 / 1.9 | 24 / 24 |

Plans: no query lost an index (Answer by `questionId, status, rankScore/createdAt`, Reply by `answerId`, Notification by `userId` use the same indexes on both). New in the head: a seq scan of `Question` (about 1,200 rows, 1.4 to 2.7 ms each) as the join for the readable filter in every counter query (`Answer ... LEFT JOIN Question`, M-B); the unread count's plain-count statement is 6.7 ms against 1.9 ms because of the new `OR` on the target (both seq-scan the 5,000-row table, which is every row of this one person). Faster on the head: Home (83.7 -> 22.0 ms: the old trending seq-scanned all 50,000 answers, 51.6 ms; the head's trending is bound to one question), `feed/trending` (29.6 -> 8.2), category (56.4 -> 24.8). Slower: M-B, and `search` by 40 to 50 percent (38.2 -> 58.7, 58.5 -> 81.6 ms) because the hits are filtered through the readable rule.

### 11. Contract (run)
`python3 docs/contract/src/build.py <temp>` on the merged tree: `cmp` against `docs/contract/openapi.yaml`: byte-identical.

### 12. Static checks and suites (run, merged tree, Postgres 16 and Redis on spare ports)
- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"`: 0 errors, 43 warnings (origin/main: 41; L-8).
- `src/feed/prelaunch.spec.ts` + `test/shared` + `test/feed` + `test/talk` + `test/reach` + `test/me` + `test/news`, one batch: **40 suites passed of 40; 526 tests passed, 1 skipped, 0 failed (527)**. This includes `test/shared/shared1a.spec.ts` unchanged against origin/main.
- Full API suite once on the merged tree (`npm test`): **104 suites passed of 104; 1,224 tests passed, 1 skipped, 0 failed (1,225)**; `test:audio` 13 of 13. No failure, so no comparison with origin/main alone was needed.

## Proved by runs
Everything marked run above: the merge and its two conflicts; the 1,855-request sweeps on both trees at four moments with a control; `isShownComingUp` at twelve moments plus override and gap worlds; sharing, the card staying stale, the 409 and the give-back, clip routes, unread badge, counters, the not-started week, 21 routes on 50,000 answers; contract, tsc, eslint and the suites.

## Read only
Nginx and browser cache lifetimes (no nginx here); the 300 per minute share-link throttle; the extra-voice-token refusal ordering; the PNG pixels (I read the stored card words, not the picture); the production calendar (guest GET, contiguous weeks).

## Not proved
- Anything on the live database, Spaces, Flutterwave, Resend, WAWU ID or Gemini.
- The web (this repo is the API): whether it calls `POST /share/links` again after 23:00, and whether it hides Share on a question that cannot be shared.
- Load: single-request plans on one shared CPU; the give-back race under real concurrency; the token path of the 409.
- The `/polls/{id}/results/stream` (SSE) route was not swept.
