# V-ADMIN-FIRST-HOME

Branch `v/admin-first-home`, cut from origin/main a818f92. No pull request, no schema change, no migration.

## What changed
- `api/src/me/admin-first.ts:16` adds `HOME_ADMIN_FIRST_CAP = 3`.
- `api/src/feed/feed.service.ts`:
  - `adminBlock` (private, about line 859): the named, published, readable posts of a current ADMIN inside a scope, newest first, up to a cap. No block filter. Never a nameless post.
  - `trendingAnswers` (about line 780): takes an optional `adminCap` (default `ADMIN_FIRST_CAP`). On the first page the admin block goes on top, outside `limit`. The ranked list leaves the same ids out on every page. The news `tag` filter does not remove the block.
  - `home()` (about line 974) passes `HOME_ADMIN_FIRST_CAP`. When today's question is not open the list stays empty.
  - `categoryDetail` (about lines 364 and 424): top voices are the admin block (cap 3) then the 3 ranked, with the same posts left out of the ranked query.
- `questionAnswers`, `listReplies` and search are untouched.

## Tests
New spec `api/test/feed/admin-first-home.spec.ts` (real HTTP, 7 tests, passes, also on repeated runs on a used database):
no admin post gives the same 2 (a nameless admin post keeps its ranked place); one admin post gives [admin, top 1, top 2]; an admin post that is also top ranked shows once; an admin post on another question is not on Home; a former admin is not lifted; five admin posts give the 3 newest then 2 ranked; `GET /feed/trending` with `questionId` and with `categoryId`, pages of 2 to the end, block on page 1 only, 0 duplicates, 0 missing; category top voices put the admin first, capped at 3. Viewers in each: guest, member, a person who blocked the admin, the admin.

Before the first push: `tsc --noEmit` clean, eslint clean on touched files, all of `test/feed`, `test/talk/admin-first.spec.ts`, `test/talk/c2-joined.spec.ts` and the home and prelaunch specs green.
Whole `npm test` after the last push: 151 of 151 suites passed, 2463 passed, 1 skipped, 0 failed; audio tests 13 pass, 0 fail. No existing assertion was edited.

## Contract
No change. `docs/contract/openapi.yaml` puts no maximum on `home.trending` and never says "2". The only text (line 8804, from `docs/contract/src/schemas.py:108`) is: "trending is the top voices of today's question only (empty until that question has opened); it is not a cross-question list." It stays true.

## Could not prove
- Only run against my own Postgres 16 and Redis, not CI or the live site.
- The new spec rewrites `scheduledFor` on older questions in the shared test database so that its question is today's. Fine in CI, which uses a fresh database each run.
- `topVoice` on a category (the first of `topVoices`) is now an admin post when there is one. That follows from the order but nobody asked for it explicitly.
- I did not run `npm test` on clean `origin/main`, since nothing failed.
