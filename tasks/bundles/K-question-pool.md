# Bundle K (a question pool in the dashboard). Tier T1. Lead brief, 11 Nov 2026

Builder: one Sonnet agent. Branch `v/question-pool` in wawu-voices-backend (api) and in wawu-voices-web, each from its
origin/main. Read `docs/agents/RULES.md`, DECISIONS.md V-14, V-27, V-29 and V-42 (this repo), the admin API
(`api/src/admin/admin-content.controller.ts`, `topics.service.ts`, `dto.ts`: `POST /admin/questions` already creates a
question with no topic and no day), and the web dashboard (`src/features/admin/CalendarPage.tsx`, `AdminFrame.tsx`,
`src/lib/api/admin.ts`, `ui.tsx`). Resources: ports 15020-15039, Redis db 11, Postgres databases `vk_*`.

| # | What | Done when |
|---|---|---|
| K1 | API: `GET /admin/questions?pool=1` lists pool questions (no topic, no day, not closed), newest first, cursor pages; additive, editor and admin only, in the contract | an editor sees exactly the pool, a viewer is refused |
| K2 | API: adding many at once. Either `POST /admin/questions/bulk` (up to 50, each the same rules as one) or the web calls the existing route per line; the builder picks and records why. A bad line is reported by its line number and the good ones are kept | 30 pasted lines become 30 pool questions; a 2-character line is named and refused |
| K3 | API: put a pool question on a day: it joins the week whose dates hold that day (no week there: refused in plain words), a free day at once, a taken day only after the editor confirms, and then the two swap as `move` does. One lock, as the calendar uses | the calendar shows it on that day; the old question goes to the pool |
| K4 | Web: a "Question pool" page in the dashboard nav: a box for many questions (one per line), Daily or Flash, category; the list with edit, remove, "Put on a day" (date picker, the taken-day confirm), and "Start now" for a Flash one (the existing flash poll call) | an editor adds 10 questions and schedules 2, all through the page |
| K5 | Web: "Add a question" inside a week of the calendar (the missing button): adds a spare to that week | the week shows one more spare |

## Checks
Every existing check EXIT 0 on both branches (api lint, typecheck, tests; web lint, typecheck, vitest, build,
`sync:shared --check`) and the lead's `scripts/lead/fullcheck.sh`. Pictures of the pool page and the week's new button,
1440 and 390, light and dark, beside the dashboard's look. Hand back in 6 lines with both heads and the pictures folder.

## State
Built 11 Nov 2026 by one Sonnet builder (V-42). Branches `v/question-pool`: api (this repo) code head 67ded07 plus the commit that holds this State and a lint-header fix in the new spec; web code head 3d8d303 (nothing after it). Both pushed. Not yet verified.

Done: K1 to K5.
- K1 `GET /admin/questions?pool=1` (editor, admin): `{items, nextCursor, total}`, newest first, 24-hour cursor as the other lists. Without `pool=1` it is 422.
- K2 `POST /admin/questions/bulk` `{kind: DAILY|FLASH, categoryId?, lines[]}`: up to 50 non-blank lines (array up to 200); answers 200 `{created, refused, items[{line, text, question|null, error|null}]}`.
- K3 `POST /admin/questions/:id/schedule` `{day, replace?}`: answers like move (`{question, swappedWith}`).
- K4 web page `/admin/pool` ("Question pool" in the nav, editor and admin), K5 "Add a question" in a week of the calendar.
- Files: api `src/admin/pool.service.ts` (new), controller, dto, admin.module (providers), `test/admin/pool.spec.ts`, contract source (`docs/contract/src/routes.py`, `schemas.py`) and regenerated `openapi.yaml`. Web `PoolPage.tsx`, `flash.ts`, `CalendarPage.tsx`, `roles.ts`, `lib/api/admin.ts`, regenerated `types.ts`, synced `contract/openapi.yaml`, `tests/k-pool.test.tsx`, `app/admin/pool/page.tsx`.
- Fenced: only the contract changed (additive: 3 routes, 5 schemas, as the brief asks). No schema, migration, app.module, guard or design-system change. No existing test, gate or baseline edited.

Decisions (lead may override):
- K2 chose the bulk endpoint, not one call per line. Why: the line numbers and the "good ones are kept" rule live in one place and are tested at the API; a paste of 50 is one request, not 50 (the admin write limit is 120 a minute, and a dropped connection half way would leave the editor guessing which lines landed); each line still goes through the same `createQuestion` service call, so the same checks, calendar lock and audit row as one POST.
- What the pool is: no week, no day, not closed, kind DAILY or FLASH, not a spare, and no flash poll started from it (a started flash question is in use, so it leaves the pool and "Start now" cannot be tapped twice). Bulk questions are DRAFT with no start time, so nothing is public (V-27, V-29).
- K3: only a DAILY question goes on a day (a flash question has no slot: it is refused in plain words, and the pool shows "Start now" for it; Edit can change Flash to Daily). The week is the one whose dates hold the day; none is 422 "There is no week on that day. Add the week in the calendar first.". A taken day is 409 code `DAY_TAKEN` with the question there in `details.question` until the request sends `replace: true`; then the two swap and the old question goes back to the pool as DRAFT (unpinned, no dates). Same started rules as move (a started question or day is 409). One calendar lock, one transaction, one `question.schedule` or `question.swap` audit row plus `question.unschedule` for the one sent back.
- Remove (K4) is the existing `PATCH /admin/questions/:id` with status CLOSED (no new delete route). A closed pool question stays hidden publicly (no start time).
- Start now (K4) is the existing flash poll call with no week (`startFlashNow` in `flash.ts`, shared with the calendar row, same 24 hours and Yes/No options).
- K5 adds a DAILY spare (draft, no day) with the existing `POST /admin/questions` (isSpare true).
- Copy has no em-dashes and straight quotes.

Checks (all run with my own resources: Postgres vk_api_test and vk_shots on 14001, Redis db 11, ports 15021, 15022, 15031):
- api: `npx eslint "{src,test}/**/*.ts"` EXIT 0 (0 errors; warnings were there before); `npx tsc --noEmit` EXIT 0; `npm test` EXIT 1 on the first run: 972 passed, 1 skipped, 1 failed: `test/load/shared-address.spec.ts` timed out at 30 s while the machine was at load average 13; the same file alone, rerun, EXIT 0 (4 of 4). `npm run build` EXIT 0. New spec `test/admin/pool.spec.ts` 10 of 10.
- web: `npm run lint` EXIT 0, `npm run typecheck` EXIT 0, `npm test` EXIT 0 (74 files, 740 tests, 7 new), `npm run build` EXIT 0 (built with every NEXT_PUBLIC base pointed at 127.0.0.1; the bundle has no API call to wawuafrica.com or usevoices.com, only the share card's printed "usevoices.com" label), `sync:shared --check` with VOICES_BACKEND_DIR at the api worktree EXIT 0.
- NOT RUN: `scripts/lead/fullcheck.sh`. It hard-codes Redis db 14, a database named `voices_test_lead_<tag>` and worktrees under `wt/lead-*`, which are outside the resources this brief gives; I ran the same steps by hand instead (above).

Pictures: `/home/user/wt/vk-shots` (kept). Pool page and the week with its new button at 1440 and 390, light and dark (`pool-*`, `week-add-*`, plus `pool-day-1440-*` with the date picker open and `week-add-open-1440-*` with the form open). They come from the real api and the built web on my own ports, with a stand-in for WAWU ID (a local key and JWKS) and seeded rows. At 390 the admin shows "Open the admin on a computer." by design (AdminFrame), so the two 390 pictures show that line for every admin page.

Known limits: a QUESTION poll attached to a question that is sent back to the pool keeps its week; the pool page loads 50 at a time with "Show more questions"; the date picker is the browser's own date input.
