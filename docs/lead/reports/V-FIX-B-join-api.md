# V-FIX-B join onto origin/main (API)

Head found: ebb7639 (as expected). Merge commit 27fe855 (--no-ff of origin/main 4fa9d50 successor). Report commit follows it.

## Conflicts (6) and how
- api/src/feed/question-window.ts: took main's whole file. Main has the same isQuestionReadable / questionReadableWhere (same names, same rule) plus answerReadableWhere, notOpenYet, the unreadable list.
- api/src/media/clips.service.ts: kept main's DM check and this piece's AD_AUDIO (approved ad) and OVERRIDE_NOTE (live or ended, not cancelled) plays, after `a || r || p || u || dm`.
- api/src/news/news.service.ts: imports of both; the news filter now uses main's answerReadableWhere (same rule through the question). List and detail already use main's answerNotBlocked.
- api/src/reach/reach.service.ts: main's list (questions, proposals, window checks) plus this piece's poll-notice question (pollQuestion).
- api/src/talk/posts.service.ts: imports of both; EditGate and UnopenedNotFound both kept; tag alert after the commit only when `!stored` (a replay of a stored post announces nothing twice).
- docs/contract/src/schemas.py: Settings and UpdateSettingsRequest carry notifyTagFollows and dmOpen, in order: ..., notifyCategoryAlerts, notifyTagFollows, dailyQuestionMinute, shareMyWord, dmOpen. openapi.yaml rebuilt, not hand-edited.
Two fixes after the merge: (1) alerts.service.ts wrote Question.categoryAlertedAt with question.updateMany, which main's spec test/feed/c21-list.spec.ts (scan of window writers) flags; it is now a plain SQL update of that marker column only (no date or status), so main's spec is unchanged and passes. (2) TAG_FOLLOW on a post made without a name no longer skips blocked people (only the poster is skipped), as main's rule says.

## Step 2 checks
1. Charges: the only two stores of a post (createAnswer, createReply) go through spendThen, which passes refType "answer"/"reply". The edit charge (EDIT_TEXT, posts.service.ts editAnswer) passes no refType and the sweeper only reads POST_TEXT/POST_VOICE with a refType, so it never touches an edit. Edit rules intact (row lock, price, charge, write; 6 slots; paidChars). Poll vote answers (vote/poll.service.ts) are main's, unchanged by this piece.
2. Reads: news list/detail/flag/request use the window rule (visible) and main's block rule (answerNotBlocked). Alerts: POLL_CLOSED passes over polls under unreadable questions, CATEGORY and TAG_FOLLOW check isQuestionReadable; tag alert skips blocked people unless the post has no name. Admin news screens are staff reads (like main's flagged tab, no window filter); the decision that makes a post Verified refuses an unreadable question (404). Ad placement with a questionId reads only that question's category and sensitive flag and returns an ad, never post content. NOT changed: admin lists do not filter by window (a post cannot exist under an unopened question).
3. Override: todayQuestionId is main's, unchanged by this piece; it picks a live override first, and the override service (this piece) only adds image/audio/link fields and keeps main's invalidateUnreadableQuestions call. The launch question (launch-mood-1) is not read or written by anything this piece runs at boot. Migration 20261114160000 only sets Question.categoryAlertedAt (a marker) for questions already started, so the launch question gets no category alert; its dates and status are untouched. Override opening at once is covered by this piece's fixb specs, which pass.
4. Migrations: scratch DB migrated with origin/main's own 23 migrations, then `prisma migrate deploy` applied 160000, 230000, 280000 cleanly (all additive: 3 nullable/defaulted columns, one new table AlertMarker); migrate status up to date (26). `migrate diff` against schema.prisma shows exactly main's own drift (searchTsv columns, User_handle_trgm_idx, one index rename), nothing more.

## Fixtures
No number in this piece's specs assumed 2 free posts (fixb-r4 uses freePosts: 0 explicitly). No spec edited.

## Commands
- contract: build.py openapi.yaml, then build.py /tmp/o.yaml; cmp: equal.
- `npx tsc --noEmit`: 0 errors. eslint on 5 touched src files: 0 errors.
- Own Postgres 16 (15470) and Redis (16470), fresh database. Whole suite once: 127 suites, 1426 tests: 1422 passed, 1 skipped, 3 failed in 2 suites, run with the code before fix (1).
  - test/feed/c21-list.spec.ts (main's): scan found alerts.service.ts. Fixed in code as above.
  - test/talk/fixb-r4-edit.spec.ts (this piece's): 2 load-timing tests (a 5xx in 80 races, bystander 516 ms against 500 ms) while my eslint ran at the same time.
  - Re-run alone after the fix: those 2 suites 26 of 26 pass; test/reach test/admin test/news test/feed: 45 suites, 419 passed, 1 skipped, 0 failed.
- NOT done: one single clean whole-suite run after fix (1). The other 125 suites passed before it, and fix (1) touches one write in alerts.service.ts.

## Unsure
- Lead to confirm: fixb-r4 timing tests are load-sensitive on a shared machine.
- Verify finding R6-1 (contract lists no 402/503 for editAnswer) and the free-post paidChars reading are still open; not changed here.
