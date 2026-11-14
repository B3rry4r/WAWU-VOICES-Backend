# V-SURVEYS round 6 (API)

Branch `v/surveys`. Fixes the items of the round 5 check, and M2 after the owner's answer ("Numbers stay: 45 and 6", relayed by the lead at 19:06 UTC).

## Join
`origin/main` (6eccda4) merged with a normal merge commit, no conflicts. One new migration, `20261114370000_released_totals` (additive, with `rollback.down.sql`); stamps 190000, 240000, 260000 unchanged. No route shape changed; the contract build gives no diff.

## H1: the count of answers is never readable under the floor
- `survey-rules.ts` `effectiveTarget(target, floor)` = max(target, floor).
- `isLive` (`surveys-admin.service.ts`) and `isOver` (`surveys-results.service.ts`) now take the floor and use it. So the brand page, the feed slot, the open and answer checks, the staff stage (REVIEW) and the snapshot at the last answer (`surveys-public.service.ts`) all wait for max(target, floor) answers.
- Create, edit (when a target is sent) and approve refuse a target under the floor with 422: "The target must be at least N answers." (`check`, `assertChecks`).
- Tests (`test/admin/surveys-round6.spec.ts`): floor 20, target 3 refused on create, edit, approve; an old row with target 3 listed at 3, 4, 10, 19 answers and gone at 20; floor raised after approval (5 to 10) likewise.
- Tests I rewrote because they pinned the old behaviour: `test/admin/surveys.spec.ts` "never shows a draft ... over-target survey" (floor set to 1 for the target-1 part) and `test/admin/surveys-round3.spec.ts` "answers that arrive after the target is reached get 409 'closed' (four at once, target 2)" (floor set to 2 for that test). Assertions are unchanged.

## M1: totals fall together after a purge
- `survey-erase.ts`: in the same transaction the person's VIEW, START and SKIP rows of each survey they answered are deleted (rows removed, not nulled). `deletion.service.ts` now runs the erase BEFORE the step that clears user ids on events (it had to move, or the rows could not be found).
- `completes` is served from the response count (`surveys-admin.service.ts`). Chosen over deleting one COMPLETE row because it cannot drift. The COMPLETE rows stay in the table but nothing reads them.
- `floorTotals` (`survey-report.ts`): `starts` is hidden whenever `responses` is hidden.
- Proof: 6 with 1 purge: 5,5,5; 7 with 3: 4,4,4; 51 with 1: 50,50,50 (staff detail and list `[responses, starts, completes]`); from exactly 5 after a purge the stored report has responses and starts both null.

## M2: a released report keeps its numbers
- `survey-erase.ts`: for a RELEASED survey the purge no longer rebuilds `releasedReport` or `reportSnapshot`. It still deletes every row of the person (response and answers by cascade, clips, VIEW/START/SKIP events). Before deleting, it reads the person's shown written and voice answers (scrubbed the same way the report scrubs them) and `dropFree` takes one equal item out of that question's list in the stored report, and lowers that question's `answered` by one (it counts the items in the list). Nothing else in the report moves. No answer id is stored: matching by the scrubbed text is exact enough, since two equal items read the same. This also works for reports released before this change.
- A survey in review (fixed, not released) is still rebuilt, as in M1.
- Staff totals for a released survey (`surveys-admin.service.ts`, detail and list) come from a new column `releasedTotals` (views, starts, skips, responses, completes), written at release and backfilled by the migration for surveys already released (their numbers as they stand today). So `completes - responses` cannot single out a purge.
- The review list loses the person's answers, as the rows are deleted (the kept sorted list rebuilds when the answer count changes).
- Other paths that could rebuild a released report: none. A second release answers 409 ("already released"); there is no recount route; a changed floor does not touch a stored report. A second release therefore shows nothing (tested: 409 and the report unchanged).
- Tests (`test/admin/surveys-round6.spec.ts`, "M2"): 51 released (Rice 45, Other 6, Oyo 25, Lagos 26, 51 texts), one purge: every number byte for byte the same except the text list (50) and its `answered` (50), staff totals unchanged at 51,51,51; nothing of the person in any table or stored report; second release 409. 24 answers (12 Lagos, 12 Oyo), three purges in a row: 12 and 12, numbers identical. Exactly 5 and exactly 6 released, one purge: numbers stay, text gone. Before release: totals fall together (6,6,6 style). Purge and release at the same moment, 3 rounds: the person's text is always gone, totals 7 or 8 with 7 texts, no half state (both take the survey row lock).
- Test I rewrote because it pinned the old rebuild: `test/admin/surveys-round5.spec.ts` "a report already RELEASED keeps every number after a purge" (was "is rebuilt without the person"): `totals.responses` is now 12, not 11; the text and voice lists still lose the person (11 each).
- Point for the lead: after a purge from a released group of exactly 5 the text list has 4 items, under the floor. The ruling (item 4) says the remaining answers stay shown, so I did not hide them.

## L1: scrub (`api/src/reach/scrub.ts`; one shared file, used by posts and surveys alike)
- A no-space full stop then a capitalised ordinary-word ending (me, us, to, net, top, live, page, online, pro, link, co, app, site, shop, store, blog, club, click, cloud, tech, dev, studio, info, africa) is a sentence end. The 21 sentences stay. Real addresses (`mybrand.me`, `mybrand.co/shop`, `www.x.live`, `http://a.to/b`, `MYBRAND.ME`) still go. "dot com" untouched (the 2 sentences give today's output).
- Plain unbroken numbers: 10 digits starting 7, 8, 9 are a phone; 11 digits `0[789][01]...`; `+` forms and 12 to 15 digits as before. `1000000000` and `0123456789` stay.
- **Conflict for the lead:** the existing spec `scrub-round5.spec.ts` removes `1234567890` (starts with 1), which the "starts with 7, 8 or 9" rule would keep. I did not change that spec. A 10-digit run starting 1 to 6 is therefore still a phone, except when it starts with 0 or ends in five or more zeros (round amounts). If you want the strict 7/8/9 rule, that spec must change.
- Tests: `test/reach/scrub-surveys-round6.spec.ts`. All existing scrub specs pass (885 before, 911 now with the new ones).

## L3
`ads.service.ts` formatted. eslint without `--fix`: 0 errors, 52 warnings.

## L4: review list
`surveys-results.service.ts`: `freeAnswers` no longer rebuilds everything per page. It reads only the free answers (not the choices), scrubs and sorts them once per survey, keeps the sorted list in memory (4 surveys at most), and checks a cheap database fingerprint (answer count, ready transcript count and length) on every page, so a purge or a new transcript rebuilds it. Hidden flags are read fresh for every page. Same items, order and hiding rules.
- Honest note: the order is by scrubbed text with `localeCompare`, which the database cannot reproduce, so the list is paged from memory, not by SQL.
- Measured (local Postgres, 50,000 text answers): first page 1.6 s (cold, scrub of 50,000 texts dominates); every following page 70 ms. At 5,000: first 0.24 s, next 58 ms. The first page is NOT under a second at 50,000.

## What I could not prove
- The first page at 50,000 is slower than "well under a second".
- Memory list is per process; with several processes each builds its own (always correct, since the fingerprint is read from the database).
- There is no `test/surveys` folder; survey specs are `test/admin/surveys*.spec.ts` and `src/surveys/*.spec.ts`.

## Suites
See the line added at the end of this file after the final run.
