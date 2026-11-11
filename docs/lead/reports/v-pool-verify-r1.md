# Verify report: VOICES bundle K (question pool, T1), round 1

Verifier: Sonnet agent (did not build it). Date: 11 Nov 2026.
Code under check: api `origin/v/question-pool` a419754 (wawu-voices-backend), web `origin/v/question-pool` 3d8d303 (wawu-voices-web), each against origin/main.

## Verdict: MERGE

No blocker, high or medium finding. K1 to K5 work as the brief and V-42 say, through the API and through the real pages. Seven low findings go to the sweep list (below). Nothing about a pool question is public before its day opens.

## Findings (all low, none needs a fix round)

| # | Sev | Where | Finding |
|---|-----|-------|---------|
| 1 | Low | `api/src/admin/pool.service.ts:213-243` | The "started" guard looks at the question already on the day (`started(other)`), not at the target day. If that question has no `startsAt` (status SCHEDULED, `startsAt` null), `replace: true` put a pool question on today and on yesterday (200), and the new one's `startsAt` is that day's start, so it is public at once. Reached only by an abnormal row (every calendar path sets `startsAt` with a day), found by forcing it in SQL. A one-line guard (`lagosDayStart(day) <= now` always refuses) closes it. |
| 2 | Low | `pool.service.ts` `bulk` | Duplicates are not detected: the same line twice in one paste, in different case, or already in the pool, all create new questions (3 created from 3 lines of "Same question text?"). Same as single create, so consistent; pasting a list twice doubles the pool silently. |
| 3 | Low | `api/src/admin/dto.ts:29` | The control-character rule (`\p{Cc}`) refuses NUL, newline, CR, tab, ESC, DEL, but accepts format characters: right-to-left override U+202E, zero-width space, no-break space; a lone surrogate becomes U+FFFD. Same DTO as single create. `<script>` text is stored as text (the web renders it escaped). |
| 4 | Low | `admin-content.controller.ts:114` | One bulk call is one hit on the admin write limit (same `@AdminWrite` guard as a single create) but writes up to 50 questions and 50 audit rows. Literally "the same rate limit"; effective ceiling is about 6000 questions a minute per editor. |
| 5 | Low | `web src/features/admin/PoolPage.tsx:59,79-90` | Any change reloads the list from the first 50 (`load()` replaces `items`), so after "Show more" and an edit the list collapses back; `more()` has no error handling. Pool of 50 or fewer is unaffected. |
| 6 | Low | `web CalendarPage.tsx:346` (K5) | The spare added by "Add a question" shows only as the count "1 more question held for follow-ups and flash polls". Its text cannot be seen, edited or removed on any page (the pool excludes spares). The brief asks only for "one more spare", which it does. |
| 7 | Low | `web PoolPage.tsx:299` | The saved line reads "Question put on Wed 18." (weekday and day, no month). A date picker choice of a day in another month is ambiguous. |
| Info | | existing `PATCH /admin/questions/:id` | An editor can give a pool question status LIVE plus a past `startsAt` and it goes public (page 200, search, home). Not new (any question can be changed this way) and needs a deliberate API call; the pool page cannot do it. Without dates, status SCHEDULED or LIVE stays hidden (404). |

Dashboard left bar: it is `sticky top-0 h-screen` (`AdminFrame.tsx:139`). `AdminFrame.tsx` is not in the diff, so this is already on main and not new. In a real scrolled browser it spans the viewport (measured at 1440x700 scrolled to the bottom of a 1045 px page: aside top 0, bottom 700). It looks as if it stops short of the page bottom only in full-page captures (all of the builder's and mine), because the capture is taller than the viewport.

## What was checked, and the result

K1 `GET /admin/questions?pool=1`: exactly the pool (no week, no day, not closed; Daily and Flash; spares, closed, follow-ups, a flash with a started poll, and a question with a day but no week are out). Newest first; walked 113 rows with limit 7: 113 unique, none missing, equals `total`. Bad limit (0, abc, 500) 400, bad cursor 400, no `pool` 422. Editor and admin 200; moderator, ad manager and a plain signed-in user 403; guest 401. Web: a viewer opening `/admin/pool` gets "We could not find that" and no nav link; editor and admin see the page and the link.

K2 `POST /admin/questions/bulk`: 50 lines 200 (50 created); 51 refused 422; 50 plus 10 blank lines accepted (blank lines skipped but numbered); 201 array 422; bad line named by number ("Line 5: Too short. Use at least 3 characters.") and the good ones kept; 400 characters ok, 401 refused ("Too long"); emoji line at 400 UTF-16 units ok; NUL, newline in a line, CR, tab, ESC, DEL each refused per line; non-strings, non-array, lowercase kind, FOLLOW_UP kind 422; extra `topicId`, `status`, `startsAt` in the body 422 (nothing slips in); moderator, ad manager, plain 403, guest 401. Each line goes through `createQuestion` (same calendar lock, one `question.create` audit row per line: 113 rows for 113 questions). Findings 2, 3, 4.

K3 `POST /admin/questions/:id/schedule`: free day takes it at once (status SCHEDULED, `startsAt` the Lagos day start, `questionCount` correct); taken day 409 `DAY_TAKEN` with the other question in `details.question`; `replace: false` still 409; `replace: true` swaps, the old one goes back to the pool as DRAFT with no dates, audit `question.swap` plus `question.unschedule`. No week on the day: 422 "There is no week on that day. Add the week in the calendar first." Started day (a LIVE question there) 409 "That day's question has started, so it cannot move."; free past day 409 "That day has already started."; Flash 422 in plain words; closed, already-on-a-day, spare, unknown id (404), bad uuid, bad date, missing day, `replace: "yes"` all refused. Week edges: last day of a week is slot 7, the day after is slot 1 of the next week. Two editors (editor and admin) on one free day without `replace`: [200, 409, 409, 409], exactly one question on the day; with `replace` still exactly one; the same question sent to two days at once: [200, 422], one row. Topic `questionCount` equals the real count after every case. Finding 1.

Public (V-27, V-29), guest and signed in: with a pool question present (Daily, Flash, and one the editor set to SCHEDULED by PATCH) `/questions/today`, `/home`, `/questions`, `/search?q=`, `/feed/trending-questions`, `/feed/new`, `/calendar`, `/topics/current`, `/topics/:id` never contain its text, and `/questions/:id` plus `/answers`, `/polls`, `/moods`, `/what-next`, `/proposals` are 404. Same after it is put on a future day and after a swap sends one back. (A flash question whose poll has been started shows in `/home` through the existing flash poll, as designed; its question page stays 404.)

K4 in the real pages (own local api, built web, local stand-ins for WAWU ID: a local key and JWKS on 15041; no external request was made, and the built bundle has no `wawuafrica.com` or `usevoices.com` host): pasted 10 lines plus one 2-character line and a blank: counter "11 questions ready", 10 added, the bad line stays in the box with "Line 5: Too short. Use at least 3 characters."; fixed it and added (11 in the pool, newest first). Put 1 on a free day: "Question put on Wed 18."; put 1 on a taken day: the confirm names the other question and "Putting this question there sends that one back to the pool."; Swap: calendar shows both, the old one is back in the pool. No-week day shows the plain refusal. Edited one (text and Daily to Flash), started it now (leaves the pool), a second Start now shows "A flash poll is already open.", removed one (gone, count falls to 8). K5: "Add a question" in a week adds a spare ("Question added to the week as a spare.", spare row appears; the week had none before). Finding 6.

Contract: 3 routes (`GET /admin/questions`, `POST /admin/questions/bulk`, `POST /admin/questions/{questionId}/schedule`) and 5 schemas, 223 added lines and 0 removed in `openapi.yaml`; regenerating from `docs/contract/src` with `build.py` is byte-identical to the committed file; the web copy `contract/openapi.yaml` is identical; no schema, migration, `app.module`, guard or design-system file changed; no existing test, gate or baseline edited.

## Commands and exit codes

Api worktree /home/user/wt/vkv-api (node_modules symlinked from the main clone, lockfiles identical; `npx prisma generate` run once in the worktree because `src/generated` is not committed; database vkv_test, Redis db 12):
- `npx eslint "{src,test}/**/*.ts"` EXIT 0 (0 errors, 38 warnings, unused-disable notices as before)
- `npx tsc --noEmit` EXIT 0
- `npm test` (jest --runInBand then test:audio) EXIT 0: 88 suites passed, 973 passed, 1 skipped. No load test timed out this run (the builder's `test/load/shared-address.spec.ts` timeout under load did not recur, so no rerun was needed).
- `npm run build` EXIT 0
- Contract regenerate and compare: EXIT 0, identical.
Web worktree /home/user/wt/vkv-web (node_modules symlinked, lockfiles identical):
- `npm run lint` EXIT 0; `npm run typecheck` EXIT 0; `npm test` (vitest) EXIT 0: 74 files, 740 tests
- `npm run build` EXIT 0 (every NEXT_PUBLIC base at 127.0.0.1)
- `VOICES_BACKEND_DIR=/home/user/wt/vkv-api npm run sync:shared -- --check` EXIT 0 ("all copies up to date")
My own attack specs (throwaway, kept outside the repo in /home/user/wt/vkv-scratch/specs, run on database vkv_attack): 4 suites, all executed; their raw output is in /home/user/wt/vkv-scratch/attack-out*.json.

## Pictures

Mine, 1440 light and dark, plus 390: `/home/user/wt/vkv-scratch/pics` (flow steps `01` to `14` in light, `pool-1440-*`, `pool-day-1440-*`, `week-add-open-1440-*` light and dark, `pool-390-*`, `role-*`, `scrolled-bottom-1440x700-light.png`, step logs `log-*.txt`). At 390 the admin shows "Open the admin on a computer." for every admin page, by design (AdminFrame), so the two 390 pictures show that line. I looked at the builder's pictures in /home/user/wt/vk-shots (pool, pool-day, week-add, week-add-open, 390 light and dark): same look as the dashboard, light and dark tokens correct, nothing drawn that is not built. There is no launch board for the dashboard, so "beside its board" is not applicable; compared with the existing calendar page instead.

## NOT RUN

- `scripts/lead/fullcheck.sh` (hard-codes Redis db 14, a database `voices_test_lead_<tag>` and `wt/lead-*` worktrees, outside this task's resources); its steps were run by hand as listed above.
- Real-phone checks (the dashboard is computer-only by design).
- Two separate browsers at once on one day: covered at the API (editor and admin in parallel) instead.

## Cleanup

Stopped the api, web and JWKS stand-in I started (ports 15040, 15041, 15042 free), dropped vkv_test, vkv_attack, vkv_live, removed both worktrees. Redis db 12 was not flushed (rule), the keys it holds are cache and throttle entries from my runs.
