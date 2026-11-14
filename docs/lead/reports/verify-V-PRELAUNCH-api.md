VERDICT: FIX

# Verify V-PRELAUNCH, API

Code under test: `v/prelaunch` d45f0d5 (on f336fc6), checked on a local merge with origin/main 755aa15 (never pushed).
Merge: clean, no conflicts. No path is in both diffs (f336fc6..origin/main and f336fc6..d45f0d5), so nothing needed resolving. I did not change the builder's code. My attack specs and scripts stay uncommitted.
Evidence is marked **run** (I ran it and saw the result) or **read** (code only). Fake clocks move `Date` only, on the real app, real Postgres 16 and real Redis, with the repo's fakes for storage and the transcriber. No live provider was called. Production was read only as a guest (`GET`).

The rule itself holds: on every route I swept, the moved question's answers, replies and their text, audio address and authors do not come back, except the paths below. What stops the merge: a red CI, one read path the builder never listed, no way to share the launch question today, and a lock-out that the refusal creates.

## BLOCKER

**B1. The full API suite is red on the merged tree: `test/shared/shared1a.spec.ts`, 13 tests fail. (run)**
- The V-27 "before the window" tests still expect 404; the branch now answers 409 `QUESTION_NOT_OPEN`. Failing: item 10 (`accepts an answer inside the window, refuses before (404) and after (409)`), and the per-action tests answer, reply, like, reaction, helpful, report, save the question, proposal, challenge, improve, support, explain my vote.
- `origin/main` alone passes the same file, 37 of 37 (run). So the branch causes it. The builder's report did not run `test/shared`.
- Why it blocks: `.github/workflows/deploy.yml` job `test-api` runs the whole suite; a red job means no deploy. Nothing goes live tonight until this is green.
- Should: change the 13 expectations to the new ruling (409, code `QUESTION_NOT_OPEN`), in the same commit.

## HIGH

**H1. A hidden voice answer's transcript and audio address are still served by clip id. (run)** `api/src/media/media.controller.ts:102` `GET /api/v1/voice-clips/{clipId}` and `:124` `GET /api/v1/voice-clips/{clipId}/play`. Clock 14 Nov 05:00 UTC, after the real shift (`applyShift`), answer on the 17 Nov question: a guest, another member, the author and a follower all get 200. Body: `status`, `durationMs`, `transcript.text` ("Zebra transcript words"), and from `/play` the signed audio URL. Neither route is in the builder's list. The clip id is not secret: `GET /feed/trending` on production right now (guest GET, read only) returns a voice answer with its clip object and id, so anyone or any cache that saw it before the deploy can still fetch its audio and text after it. Should: 404 for everyone except the clip's owner and moderators while the answer or reply it belongs to sits under a question that has not opened (same `isQuestionReadable` rule through `Answer.clip` / `Reply.clip`).

**H2. No share link to the launch question can be made before 23:00 UTC. (run)** `POST /api/v1/share/links {"objectType":"QUESTION","objectId":<launch>}` as a signed-in member at 14 Nov 05:00 UTC answers 404 `NOT_FOUND` "We could not find that." Cause: `api/src/reach/share-subject.ts:424` `if (!q || !isQuestionReadable(q, now)) return null;`. So the share button is hidden (builder's caveat) and no link exists for the question people will share today; after 23:00 it works. Should: allow the link and the share page (text, opening date, no counts, no answers) for a SCHEDULED question that has a start date, the same "coming up" view Home gives. A bank question dated 16 Nov or later must stay 404 (it does). The builder offered this relaxation; the owner needs to say yes tonight.

## MEDIUM

**M1. The unread badge counts notifications that the list hides. (run)** `api/src/reach/reach.service.ts:94` `NAMED_TYPES = ["REPLY","REACTIONS"]` and `:457` `unread()`: only those two types go through the filter for the count; every other type that links to a hidden answer is counted. 14 Nov 05:00, notifications stored as the real code stores them:
- anonymous author, `VIDEO_READY` + `REPLY` on their answer: list `[]`, unread **1**, nothing to open. This is the defect you named.
- another member, `DAILY_QUESTION` (question-linked), `MODERATION_NOTICE`, `RESULT_CHECKED`, `TAG_FOLLOW`: list 1 item, unread **4**.
- follower, `CATEGORY_ALERT`, `REPLY`, `TAG_CHANGED`: list 1 item, unread **2**.
- author, two `REACTIONS` + `REPLY`: list `[]`, unread 0 (correct).
After 17 Nov 00:00 UTC the lists show everything and the counts match (run). Should: count only what the list would show.
Also `reach.service.ts:376` gates `targetType` "answer" and "reply" only. A question-linked notification (`DAILY_QUESTION`, `CATEGORY_ALERT`) is listed with its stored text and a tap (`GET /questions/{id}`) returns 404 (run). Nothing in the code creates those two types today (read: grep finds only the settings fields), so this is latent. A tap on an answer notification: 404 (run; the list hides those anyway).

**M2. Public profile counters include hidden answers and replies. (run)** `api/src/me/views.ts:189-193` serves the stored `voiceCount`, `replyCount`, `reactionsReceived` unfiltered (the builder named `voiceCount`). `GET /api/v1/people/{userId}` and `/people/by-handle/{handle}` as a guest at 14 Nov 05:00: `reactionsReceived: 1` for the author of the hidden answer, `replyCount: 1` for the person who replied to it. `voiceCount` is the same kind of stored counter (incremented at `talk/posts.service.ts:262`; not run directly, see Not proved). Shown to: everyone on the profile, and to the owner on `/me`. `voicesCount` (computed) is right: 0. Should: compute the three the way `voicesCount` is computed, or recompute the stored counters in the shift.

**M3. A refused post counts against the post limit and can lock a person out at opening. (run)** `@RateLimit("post")` (`talk/talk.controller.ts:169`, bucket `ratelimit.post_per_10min` = 20, `talk/shared/rate-limit.ts:24`) runs in a guard before the 409. One member sent refused posts to the launch question: the 21st got 429. A member who sent 30 refused tries at 22:58 got, at 23:00:05, 429 `RATE_LIMITED` "retry after 475 s", with a new Idempotency-Key too. The web hides the button, so it takes 20 taps in ten minutes (a script, or a client that retries). The money side is clean (item 6). Should: skip the counter for a refusal, or check "open" before the guard.

## LOW

- **L1. `GET /answers/{id}/where-you-sit` answers 200 to the author of an answer under a question that has not opened (run).** `mood/mood.controller.ts:56`. Body: `answerId`, `questionId`, own mood. `GET /answers/{id}/videos` is 200 for the author too (status only). "Author included" is not met on these two. Should be 404.
- **L2. A SCHEDULED week shows `questionCount: 10` and a `weeklyPollId` on Home, `/topics/current`, `/topics/{id}`.** No answer counts (`voiceCount 0`, `voicesCount 0`).
- **L3. `/me/saved` category chip `questionCount` changed on an open world (run).** The one difference to origin/main in 926 route-by-viewer responses (item 10): 71 on main (counts questions not started), 2 on the branch (`me/views.ts:369-397`). Intended; the number is now correct.
- **L4. The contract does not mention `QUESTION_NOT_OPEN` (0 matches) or that Home `trending` now means today's question's top voices.** It is byte-identical to its generator, so nothing is broken.
- **L5. Published weekly reports are not gated (builder's note).** Production `GET /weekly-reports` returns `{"latest":null,"items":[]}` now (run, read only): nothing to hide tonight. Draft numbers are gated (`reach/weekly-draft.ts:171`, read).
- **L6. Card pictures.** The share card is cached in the browser for one hour (`reach/share.controller.ts:141`) and a stored card PNG is `public, max-age=31536000, immutable` in Spaces (`reach/card-store.ts:48`, read): a card made before a question was moved stays reachable by its direct address for whoever has it.
- **L7. Data export.** `GET /me/export` returns the person's own answers whatever the window (read). Own data; noted because of "author included".
- **L8. Editing and deleting one's own post under a moved question (run).** Edit: 409 `EDIT_WINDOW_PASSED` (the 5 minutes are long gone). Delete: 204, status `DELETED_BY_AUTHOR`, the question `answerCount` drops by one; deleting one's reply: 204. Sane.

## Task by task

### 1. Leak sweep (run)
Seeded through the real API at 13 Nov 10:00 UTC on the bank question the shift moves to 17 Nov: a named text answer, an anonymous one, a voice answer (clip and transcript), a gossip-tagged answer, VERIFIED_NEWS on one, 2 replies, reaction, like, saves (answer and question), helpful, 2 reports, a listen, a mood word on each, share links (answer, question), tag and category follows, 9 notifications to other people. Control: before the move the same sweep finds the seeded content on 48 distinct routes, so the sweep can see it. Then `applyShift` (the code `calendar:launch-shift --apply` runs) and `seedLaunchQuestion`, as in production. Clock 14 Nov 05:00 UTC. Viewers: guest, another member, author, anonymous author, follower, moderator, admin: 961 route-by-viewer requests over all 97 GET routes in the contract with variants (feed sort TOP/NEW/DEBATED, tag, mood; search every type; categories tab open/closed/polls; news tags; people replies; saved by type; notifications; share page, card, story, square; clip routes; admin reads), plus the GETs the contract misses (`/_probe/*`, `/api/health`, `/internal/mail/audience`, `/mail/unsubscribe`: none read answers; read).
Result: clean except H1, M1 (stored notification text), L1, and the admin moderation lists (expected, item 3). No other future bank question appears in 23 listing routes for guest and member (722 future questions checked): only the launch question, as "coming up".
My own limits: `/me/handle-check` and `/admin/users` (no filter) answered 422 on my parameters; `/search` without `q` is 422 (covered with `q`); `/polls/{id}/results/stream` (SSE) skipped; admin `/search` hit the throttle (429), same code path as the others.

Routes swept (statuses across the seven viewers; "content-bearing when open" = the control sweep found seeded content there; "leak at 05:00" = viewers who got seeded content or the question id back):
```
/me | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/me/handle-check | statuses 401x1/422x6 | content-bearing when open: no | leak at 05:00: -
/me/allowance | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/me/settings | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/me/invite | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/me/friends | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/invites/{code} | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/me/categories | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/me/answers | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: -
/me/saved | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: -
/me/blocks | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/people/{userId}/replies | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/people/by-handle/{handle} | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/people/{userId} | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/me/export | statuses 401x1/404x6 | content-bearing when open: no | leak at 05:00: -
/topics/current | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/topics/{topicId} | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/calendar | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/config/public | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/countries | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/categories | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/categories/{slug} | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/home | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/questions/today | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/questions/{questionId} | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/questions | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/feed/trending | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/trending-questions | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/feed/new | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/questions/{questionId}/answers | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/questions/{questionId}/polls | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/voice-clips/{clipId} | statuses 200x7 | content-bearing when open: yes | leak at 05:00: admin,anonAuthor,author,follower,guest,mod,other
/voice-clips/{clipId}/play | statuses 200x7 | content-bearing when open: yes | leak at 05:00: admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/moods | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/answers/{answerId}/where-you-sit | statuses 200x1/401x1/404x5 | content-bearing when open: yes | leak at 05:00: author
/answers/{answerId} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/answers/{answerId}/videos | statuses 200x1/401x1/404x5 | content-bearing when open: no | leak at 05:00: -
/voice-videos/{videoId}/file | statuses 401x1/404x6 | content-bearing when open: no | leak at 05:00: -
/answers/{answerId}/replies | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/reactions | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/polls/current | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/polls/flash | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/polls/{pollId} | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/polls/{pollId}/results | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/questions/{questionId}/what-next | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/questions/{questionId}/proposals/similar | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/questions/{questionId}/proposals | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/result-threads | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/result-threads/{threadId} | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/result-threads/{threadId}/posts | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/news | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/news/tags | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/news/{answerId} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/weekly-reports | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/weekly-reports/latest | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/weekly-reports/{reportId} | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/search | statuses 422x7 | content-bearing when open: no | leak at 05:00: -
/notifications | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: follower,other
/notifications/unread-count | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/share/{code} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/share/{code}/card | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/share/{code}/story | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/share/{code}/square | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/units/tiers | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/subscription-plans | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/subscriptions/me | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/wallet | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/wallet/history | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/payments/{paymentId} | statuses 401x1/404x6 | content-bearing when open: no | leak at 05:00: -
/payments/{paymentId}/receipt | statuses 401x1/404x6 | content-bearing when open: no | leak at 05:00: -
/extra-voice-tokens | statuses 200x6/401x1 | content-bearing when open: no | leak at 05:00: -
/ads/placement | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/admin/roles | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/users | statuses 401x1/403x1/422x1 | content-bearing when open: no | leak at 05:00: -
/admin/today | statuses 200x2/401x1 | content-bearing when open: no | leak at 05:00: -
/admin/topics | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/topics/{topicId} | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: admin
/admin/questions | statuses 401x1/403x1/422x1 | content-bearing when open: no | leak at 05:00: -
/admin/overrides | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/moderation/items | statuses 200x2/401x1 | content-bearing when open: yes | leak at 05:00: admin,mod
/admin/moderation/items/{itemId} | statuses 401x1/404x2 | content-bearing when open: no | leak at 05:00: -
/admin/news/items | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/results/threads | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/results/posts | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/weekly-reports | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/weekly-reports/{reportId} | statuses 401x1/403x1/404x1 | content-bearing when open: no | leak at 05:00: -
/admin/weekly-reports/{reportId}/instagram | statuses 401x1/403x1/404x1 | content-bearing when open: no | leak at 05:00: -
/admin/weekly-reports/{reportId}/instagram/{file} | statuses 401x1/403x1/404x1 | content-bearing when open: no | leak at 05:00: -
/admin/ads | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/config | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/config/changes | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/wallets/{userId} | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/payments | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/audit | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/people/by-handle/H | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/feed/trending?sort=top&limit=50 | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/trending?sort=new&limit=50 | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/trending?tag=VERIFIED_NEWS | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/trending?tag=GOSSIP | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/trending?mood=PROUD | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/feed/new?limit=50 | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/feed/new?tag=GOSSIP | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/questions/U/answers?sort=TOP | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/questions/U/answers?sort=NEW | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/questions/U/answers?sort=DEBATED | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/questions/U/answers?tag=GOSSIP | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/questions/U/answers?mood=PROUD | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/search?q=zebra&type=answers | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/search?q=zebra&type=questions | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/search?q=zebra&type=people | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/search?q=zebra&type=topics | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/search?q=zebra | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/search?q=transcript&type=answers | statuses 200x6/429x1 | content-bearing when open: yes | leak at 05:00: -
/search?q=nigeria | statuses 200x6/429x1 | content-bearing when open: no | leak at 05:00: -
/search?q=author&type=people | statuses 200x6/429x1 | content-bearing when open: no | leak at 05:00: -
/answers/{a2} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/answers/{a3} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/answers/{a4} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/answers/{a2}/replies | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/answers/{a3}/replies | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/answers/{a2}/where-you-sit | statuses 200x1/401x1/404x5 | content-bearing when open: yes | leak at 05:00: anonAuthor
/answers/{a3}/videos | statuses 200x1/401x1/404x5 | content-bearing when open: no | leak at 05:00: -
/news?tag=VERIFIED_NEWS | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/news?tag=GOSSIP | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/news/{a4} | statuses 404x7 | content-bearing when open: yes | leak at 05:00: -
/me/saved?type=answers | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: -
/me/saved?type=questions | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: -
/me/answers?limit=50 | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: -
/notifications?limit=50 | statuses 200x6/401x1 | content-bearing when open: yes | leak at 05:00: follower,other
/notifications?filter=unread | statuses 401x1/422x6 | content-bearing when open: no | leak at 05:00: -
/categories/health?tab=open | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/categories/health?tab=closed | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/categories/health?tab=polls | statuses 200x7 | content-bearing when open: yes | leak at 05:00: -
/calendar?status=SCHEDULED | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/calendar?status=LIVE | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/questions?limit=100 | statuses 200x7 | content-bearing when open: no | leak at 05:00: -
/questions?status=SCHEDULED | statuses 422x7 | content-bearing when open: no | leak at 05:00: -
/questions/U/proposals/similar?text=zebra | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/share/CODE | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/share/CODE/card | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/people/U | statuses 200x21 | content-bearing when open: yes | leak at 05:00: -
/people/U/replies | statuses 200x21 | content-bearing when open: yes | leak at 05:00: -
/people/U/answers | statuses 404x14 | content-bearing when open: no | leak at 05:00: -
/people/U/posts | statuses 404x7 | content-bearing when open: no | leak at 05:00: -
/admin/questions?pool=1 | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
/admin/users?q=tmw | statuses 200x1/401x1/403x1 | content-bearing when open: no | leak at 05:00: -
```

### 2. The launch question before 23:00 UTC (run, 14 Nov 05:00)
- `GET /questions/today`, `GET /questions/{launch}` (guest and member): 200, status SCHEDULED, text, hint, moodOptions, `startsAt` 2026-11-14T23:00:00Z, `endsAt` 22 Nov 23:00Z, `recentVoices: []`, `category.voicesThisWeek 0`. No answers, no counts.
- `GET /home`: same question; `trending: []`, `newConversations: []`; topic SCHEDULED, `startsOn 2026-11-16`, `voiceCount 0`, `voicesCount 0`.
- `GET /questions/{launch}/answers`: 200 `{items: []}`; `/moods`: 404; `/polls`: 200 empty. `GET /questions`: empty. `/calendar`: weeks only.
- Production `GET /questions/today` already returns it as SCHEDULED with the same text and `startsAt` (read only).
- Share: H2. `/go`, landing and join previews are web routes; behind them the API is `/questions/today` and `/invites/{code}` (200, no leak).
- A bank question dated 16 Nov or later: `GET /questions/{id}` 404, `/answers` 404, `POST /share/links` 404.

### 3. Admin and moderation (run)
Moderator: `GET /admin/moderation/items` 200 and lists the reported hidden answers; `GET /admin/moderation/items/{id}` 200 with author, content, transcript, play URL, context, audit; `POST /admin/moderation/items/{id}/action {"action":"REMOVE","reason":...}` 200 and the answer is REMOVED. Admin: `GET /admin/topics` lists every week; `GET /admin/topics/{id}` lists all ten questions (SCHEDULED, text, day); `GET /admin/today` shows today's question (SCHEDULED) and the next. Admin counts include hidden answers: topic `voicesCount 5` where the public number is 0. That is what an admin should see; tell me if admin should match the public numbers.

### 4. The flip and the caches
Instant (run): 22:59:59.999 UTC: Home `dailyQuestion.status` SCHEDULED, `/questions/today` SCHEDULED, `/questions/{launch}` SCHEDULED, `/moods` 404, post 409 `QUESTION_NOT_OPEN`. 23:00:00.000: LIVE, LIVE, LIVE, `/moods` 200, post 201. Bank question 16 Nov 22:59:59.999: answer by id 404, question answers 404; 23:00:00.000: both 200. No gap, no overlap.
Caches in front of these reads (read: `feed/guest-cache.ts`, `feed/feed.controller.ts`, `infra/nginx/voices.conf`, `reach/share.controller.ts`, `mood/mood-stats.service.ts`):

| cache | what | time |
|---|---|---|
| API in-process `GuestReadCache` (production only; `GUEST_CACHE_TTL_MS`, default 5000) | guest `questions/today`, `questions/{id}`, `questions/{id}/answers`, `config/public` | 5 s |
| nginx `proxy_cache` | guest (no token) `questions/today`, `questions/{uuid}`, `config/public`, `share/{code}`, `share/{code}/card`, by `X-Accel-Expires`/`Cache-Control` | 5 s for the first three; share page 30 s; card 30 s |
| browser | `public, max-age=5` on those and on the answers page; share page 30 s; share card 3600 s; story/square 300 s | as stated |
| nginx stale | `proxy_cache_use_stale updating error timeout 5xx` | while a refresh runs, or the API is failing, until evicted (`inactive=2m`) |
| `/home` | no process copy, not in the nginx list, no Cache-Control | 0 s |
| members (token) | never from nginx or the process cache (`proxy_cache_bypass $http_authorization`); `private, no-cache` | 0 s |
| Redis `mood:stats:{question}` | "where you sit" and `/moods` counts; TTL 3600 s, refreshed every 15 s while read | the route is gated, so hidden counts are not served; a reopened question can show counts up to 1 h old |

Measured (run; `GUEST_CACHE_TTL_MS=5000`, clock moved): a payload filled at 22:59:59.000 answers SCHEDULED until 23:00:03.500 and LIVE at 23:00:04.000 (fill + 5 s). For a payload filled at 22:59:59.999 the longest a guest can still see "not open" is process 5 s (to 23:00:04.999) + nginx 5 s (to 23:00:09.999) + browser 5 s, about **15 s** after 23:00:00, on `/questions/today` and `/questions/{id}` (the nginx and browser parts are read, not run: no nginx here). Home: 0 s. Members: 0 s. The builder says the web opens the card from `startsAt` once it has passed (not verified by me).
Hidden after a move (run, process cache): a guest answers page filled while open still showed 3 items 2 s after the question was moved and 0 items at 5.5 s. Longest by cache: answers page 10 s (process + browser; not in the nginx list), question by id and today 15 s, share page 60 s, share card 30 s nginx plus up to 1 h in a browser (L6).

### 5. Counts (run unless said)
Question answer counts, topic `voiceCount`/`voicesCount`, category `voicesThisWeek`, profile `voicesCount`, Home stats: zero for the hidden content on every route swept. The stored profile counters `voiceCount`, `replyCount`, `reactionsReceived`: M2. Weekly report draft numbers: read, gated, not run. Admin counts: item 3.

### 6. Writes before opening (run)
Launch question and 17 Nov question, clock 22:58 UTC 14 Nov: answer (text and voice), reply, reaction, like, save answer, save question, helpful, report, listen: all 409 `QUESTION_NOT_OPEN`. Messages: "This question opens on Sunday 15 November." for the launch question (opens 23:00 UTC 14 Nov = 00:00 Lagos), "This question opens on Tuesday 17 November." for the 17 Nov question (opens 23:00 UTC 16 Nov). Unreact, unlike, unsave: 200, 200, 204. Share link for an answer: 404. Proposal: my body was invalid (422), so that refusal is read only (`vote/proposal.service.ts:114`); same for poll explanation (`vote/poll.service.ts:478`).
Money and limits: snapshot of free allowance, wallet balance, charges, ledger rows, answers, replies, reactions, likes, saves before and after the refusals: identical; `/me/allowance` identical; `freePostsRemaining` stayed 10; a READY voice clip stayed READY and unattached. The extra-voice-token path is read only (the refusal comes before the charge, `posts.service.ts:183`). The post counter is NOT spared: M3.
Same Idempotency-Key: refused 3 times at 22:59:00 (409), then at 23:00:00.000: 201, one answer, one free post; the same key again: 201 with the same answer id (replay).
Edit and delete: L8.

### 7. Notifications: M1.

### 8. Home `trending` (run)
Five bank questions open at once (16-20 Nov; windows run to Sunday 22 Nov 23:00 UTC), 20 answers with distinct rank scores, clock 20 Nov 12:00 UTC: `/home` `trending` = the 2 best answers of today's question (20 Nov) only, same for a member. `/feed/trending` still returns the cross-question list. Other readers of the old meaning: `/feed/trending` and category top voices, both unchanged. The contract still describes `trending` generically (L4).

### 9. Speed (run)
50,000 answers over 200 questions (59 not started), 2,000 users, 10,000 replies. Statements captured from the Postgres log for a warm request; the heaviest SELECTs re-run with EXPLAIN (ANALYZE, BUFFERS). Same database, origin/main then branch, twice each (second run shown). One shared CPU, no concurrency: a plan check, not a load test. SQL ms = sum of statement durations for one request.

| route | SQL ms main / branch | queries main / branch |
|---|---|---|
| home guest | 68.6 / 9.8 | 35 / 37 |
| home member | 55.0 / 9.0 | 43 / 45 |
| questions/today | 11.3 / 4.9 | 11 / 12 |
| question answers NEW | 11.0 / 5.6 | 17 / 18 |
| question answers TOP | 19.2 / 4.9 | 17 / 18 |
| feed/new | 16.9 / 3.7 | 10 / 11 |
| feed/trending | 62.5 / 44.0 | 8 / 8 |
| search answers "rice" | 33.6 / 28.6 | 23 / 25 |
| search "light" | 29.4 / 24.5 | 26 / 28 |
| people/{id} | 0.4 / 0.9 | 12 / 12 |
| people/{id}/replies | 0.2 / 0.4 | 6 / 6 |
| me/answers | 0.4 / 0.7 | 14 / 14 |
| category | 44.0 / 4.5 | 25 / 26 |

No query lost an index: Answer lookups still use `Answer_questionId_status_*` and `Answer_authorId_createdAt_idx`. The three profile queries gain a hash join to `Question` (seq scan of 200 rows, +0.2 to 0.5 ms). Home is about 7 times cheaper in SQL because its trending list is bound to one question. `feed/trending` seq-scans all 50,000 answers on both trees (39 ms main, 30 ms branch): pre-existing, and it grows with data.

### 10. Open questions untouched (run)
Same seed on origin/main and on the branch with the question open (13 Nov 10:00): 926 route-by-viewer JSON bodies compared after normalising ids, handles, share codes and real-time stamps. Identical except `/me/saved` `questionCount` 71 vs 2 (L3). The fixture diff in `test/news/news.spec.ts` (question created `status: "LIVE"` instead of the DRAFT default): read. A DRAFT question was never open, so news showing under it was the old hole; LIVE with no start date is open (`isQuestionOpen`). It hides nothing; the news hiding itself is proved by `prelaunch.spec.ts` and my sweep (`/news`, `/news/{id}`, `/news/tags`).

### 11. Contract (run)
`python3 docs/contract/src/build.py <temp>` on the merged tree reproduces `docs/contract/openapi.yaml` byte for byte (`cmp` identical).

### 12. Static checks and suites (run, merged tree, Postgres 16 and Redis on spare ports)
- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"`: exit 0, no warnings.
- `src/feed/prelaunch.spec.ts`: 8 of 8 pass.
- `src/feed/prelaunch.spec.ts` + `test/feed` + `test/talk` + `test/news` + `test/reach`: 26 suites pass; 351 tests pass, 1 skipped, 0 failed (352).
- `npm run test:audio`: 13 of 13 pass.
- Full API suite once: 101 suites, 100 pass, 1 fails; 1153 tests, 1139 pass, 13 fail, 1 skipped. All 13 failures are `test/shared/shared1a.spec.ts` (B1). origin/main alone passes that file, 37 of 37.

## Proved by runs
Everything marked run. Also production guest GETs (`/questions/today`, `/home`, `/calendar`, `/feed/trending`, `/weekly-reports`): production today serves the launch question as SCHEDULED, a voice answer with its clip in `/feed/trending`, and a topic `voicesCount` of 1 on Home, which this change removes.

## Read only
Nginx and browser cache times (no nginx here); `GuestReadCache` code; notification creation code (no `DAILY_QUESTION` creator found); proposal and poll-explanation refusals; extra-voice-token path; weekly draft gate; `/me/export`; Spaces card caching; the GET routes the contract misses.

## Not proved
- Anything on the live database or real Spaces, Flutterwave, Resend, WAWU ID, Gemini.
- Nginx end to end: the 15 s, 10 s and 60 s figures join a measured 5 s process cache to read config.
- Load: EXPLAIN runs are single requests on a shared CPU.
- The web (this repo is the API) and the builder's claim that it opens the card from `startsAt`.
- Voice answers posted by the real upload flow (mine is inserted by SQL), so the stored `voiceCount` leak is shown by its twin counters.
