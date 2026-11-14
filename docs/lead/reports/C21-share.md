# C2.1-SHARE report

Branch `v/c21-share` from a7af84c. No contract change (`build.py` output byte-identical to `docs/contract/openapi.yaml`). No migration.

## Items

**1. M-A, the stale picture**
- `api/src/reach/share.service.ts` `ShareCardService.image()`: for a QUESTION link whose stored words are the coming-up ones (`leanLine` starts "Opens "), it computes the spec hash of the words the question would draw now (same `cardSpecFor`/`specHash` as `createLink()`), and if the stored file key does not carry it calls `refreshComingUp()` -> `redrawStored()`. One draw per card: an in-process map per code; the first request draws and answers with the new picture, the others get the old one meanwhile; a request that read the row just before another redraw finished re-checks the card and does not draw again. The swap runs under `FOR UPDATE` on the card row, marks the old file for purge, and skips if the card was reset to PENDING meanwhile. A failed draw is logged, the old picture is served, cache 30 s.
- A card for an open question never carries "Opens", so it is never redrawn and keeps `max-age=3600`, `X-Accel-Expires: 30`.
- Cache: `openCap()` / `openCapByCode()` (same file) = min(300, whole seconds until `startsAt`) while the question has not opened. `share.controller.ts` card: `Cache-Control: public, max-age=<cap>` and `X-Accel-Expires: min(30,cap)`; story and square: `max-age=<cap>` and `X-Accel-Expires: <cap>`. After opening, today's values (card 3600/30, story and square 300).
- Story and square are already drawn from the current words on every request (key = spec), so they change at 23:00 without code; only their cache time needed the cap.

**2. L-2** `api/src/talk/posts.service.ts` new `UnopenedNotFound` (a 404 with the same body), thrown at the two places where a question that exists and has not opened is refused (`createAnswer`, `createReply`). `api/src/talk/talk.controller.ts` `notCountedWhenNotOpen` gives back only for `UnopenedNotFound` and `QUESTION_NOT_OPEN`.

**3. L-6** `api/src/reach/share-subject.ts` `questionView()`: `status` = `effectiveStatus(...)` (same function `/questions/today` uses).

## Specs added
- `api/test/reach/c21-share.spec.ts` (5): link at 14 Nov 05:00 (cache 300/30); 22:59:59 same bytes, `max-age=1`; 23:00:01 bytes change, `leanLine` null, one more draw, cache 3600; story `max-age=1` then 300; 100 at once at 23:00:01 = 1 draw, 100x 200, each old or new; open-question card never redrawn, 3600/30; failed redraw serves old with 30 s; page `question.status` SCHEDULED at 22:59:59.9 and LIVE at 23:00:00.0, equal to `/questions/today`.
- `api/test/talk/c21-giveback.spec.ts` (3): 40 posts to unknown question = 20x404 then 429; 40 replies to unknown answer = same; 30 early tries on an unopened question then a post at the opening = 201.

## Specs changed: none.

## Runs (own PostgreSQL 16 on 55432, Redis on 56379, both stopped; fresh database for the full run)
- `tsc --noEmit`: clean. eslint on every touched file: clean.
- `test/reach test/talk test/shared src/feed/prelaunch.spec.ts`: 37 suites, 452 tests: 447 passed, 1 skipped, 4 failed. The 4 are the same on the base a7af84c (run in a worktree): hotfix1-block-oracle (known), c2-joined "sweeper ... reversed" (COMMITTED not REVERSED), hotfix1-crawl x2 (seen in one run of two, so flaky/order dependent). Not caused by this change.
- Whole API suite, fresh database, in band: 116 suites, 1285 tests: 1282 passed, 1 skipped, 2 failed (hotfix1-block-oracle: 402 instead of 201, the known one; c2-joined sweeper, red on base too). 114 suites passed, 2 failed.

## Choices
- Redraw is limited to QUESTION links still carrying the coming-up words, so no other card kind changes behaviour and an open question is never redrawn.
- Single-process dedupe plus a locked, re-checked swap; two app instances could each draw once (same key, same bytes, harmless).
- Cap uses whole seconds rounded down (0 s in the last second).
- A 404 for a draft or hidden-bank question that exists also gives the try back (it is "exists and has not opened").

## Not done
- The c2-joined sweeper failure and the hotfix1 crawl/oracle failures are left as they are (other branches own them). Not checked: behaviour behind a real nginx.
