# V-SURVEY-LIST-FLOOR (api)

Owner order, 15 Nov 2026: "Hide a list under 5". A released written or voice list with fewer items than the report's own `minGroupSize` is hidden. The count (`answered`) and every other number stay as released. No schema, contract or field change.

## Lines changed
- `api/src/surveys/survey-report.ts:390` `hideShortLists(report, only?)`: empties `texts`/`textIds` (TEXT) or `voices`/`voiceIds` (VOICE) when under the report's own floor. Choice questions and all numbers are untouched. `:416` `servedReport` = `withoutAnswerIds(hideShortLists(r))`. `:421` `hiddenListQuestions` (used by the review list, below).
- `api/src/surveys/survey-erase.ts:146` (`dropFree`): notes which questions lost an item, then runs `hideShortLists` on those only. A person with no item in a list changes nothing, even if that list is already short.
- `api/src/surveys/surveys-results.service.ts:188` the report is served through `servedReport`. `:377` the review list (see paths).

## Every serving path, and where the rule sits
Searched for every reader of `releasedReport`:
1. `GET /admin/surveys/:id/report` (ADMIN, AD_MANAGER), `SurveysResultsService.report`: `servedReport` (short lists hidden, then ids removed). This is the only place the released report is served. It also covers reports stored before this change.
2. `GET /admin/surveys/:id/free-answers` (staff review list). After release it still read the live remaining answers. For a released survey it now drops the items of every written or voice question whose served list is empty, whatever its `answered` (see Round 2). Before release it is unchanged.
3. Not a path for lists: survey detail and list (`/admin/surveys`, `/admin/surveys/:id`) carry the stored totals only; the F04 results mail carries counts and the top choice only; `brands/:slug` and `surveys/:id` are public/respondent routes with no report.
I found no brand sign-in route and no CSV or JSON export in this repo. If the website or another service reads `releasedReport` from the database directly, it is not covered.

## Existing assertions changed (owner order)
`test/admin/surveys-round7.spec.ts`, "14 released, 10 purges":
- before: `expect(after.questions[1].texts).toHaveLength(4);` `expect(after.questions[2].voices).toHaveLength(4);` `not.toMatch(/text [0-9]"|voice [0-9]"/)` and `texts.sort()` equal `["text 10".."text 13"]`
- after: both lists `toHaveLength(0)`; `answered` still 14; the regex now `/text [0-9]+"|voice [0-9]+"/` on the served and the stored report; the sorted-list assertion is removed.
`test/admin/surveys-round6.spec.ts`, "exactly %i released, then one purge" (5 and 6):
- before: `toHaveLength(before.questions[1].texts.length - 1)`
- after: `toHaveLength(n === 5 ? 0 : n - 1)` (5 released then 4 left: hidden; 6 then 5: stays).
No other assertion changed. Prettier also reflowed one line in each file.

## What a brand can learn, before and after
Setup: 45 answers released, `answered` 45, list of 45.
- Before: a later copy shows the list shrinking. Comparing two copies shows exactly which items went, so a brand can tell which of its listed answers belonged to people who deleted their account (a deleted person's item, or a few of them, is pinned). With the list down to 3, it also holds the 3 left on their own, and the earlier copy tells it which 42 left.
- After: a copy taken once the list is under 5 shows `answered` 45 and an empty list. It learns only that fewer than 5 are left (more than 40 were deleted). It cannot see the leftover items, so the people still in are not picked out. Against an earlier full copy it cannot tell which items are left. A group smaller than the floor is never shown.
- Not changed: a brand that kept an earlier copy keeps whatever that copy showed (nothing can be recalled). While a list stays at 5 or more, two copies still show which single item went when one person deletes (the deleted person is pinned, not the ones left). The floor protects people who stay, as ordered. A list released with `answered` 45 and then served empty is readable as "hidden for too few", which the order says the website will say. A list hidden at release has `answered` null, so the two cases are told apart, which reveals nothing beyond the count rule.
- Not built: no new field, no warning, no change to frozen numbers.

## What I ran (fresh Postgres 16 and Redis, started here)
- `npm ci`, `prisma generate`, `tsc --noEmit`: clean.
- eslint (no `--fix`) on touched files: no errors after prettier; 3 pre-existing style warnings (unused disable directives, one unsafe-argument in round 6).
- Unit: new `src/surveys/survey-list-floor.spec.ts` (cases: 7 listed at floor 5 down to 4, voice list, two lists, floors 2 to 6, text and voice item, no item, exactly at floor, two lists, old stored report served empty).
- HTTP: new `test/admin/surveys-list-floor.spec.ts` (13 people, 7 written + 6 voice at floor 5, purges one by one through `DeletionService`, ADMIN and AD_MANAGER on report, review list, detail and list; old stored report with 3 items; 20 rounds of two purges at once, no 5xx). Cleanup: truncates its survey tables and floor setting in `afterAll`, creates no daily questions, posts or moderation rows.
- All surveys specs (unit and `test/admin/surveys*`), `wf2-deletion`, `mail-trouble-purge`: 13 suites, 185 tests, all pass.
- Whole `npm test`: 176 suites, 2887 passed, 1 skipped, 2 failed (2890 tests). The 2 failures are `test/vote/vote.spec.ts` (A4 VOTE, guest live counts cached in Redis) and `test/mail/topic-mail-round5.spec.ts` (dead address refused by C14). Both fail the same way on a clean `origin/main` (2f1d9d9), also run alone, so they are not from this change (likely this sandbox's Redis or clock). I did not touch them.

## Could not prove
- The "brand" and "CSV or JSON export" routes named in the order do not exist in this repo; only staff reads are covered.
- The release-order run (largest spec first on one shared database) was not repeated end to end.

## Round 2 (the check's finding 1)
Finding: after release, `free-answers` still returned the 3 written answers and 3 transcripts of a list that was hidden AT RELEASE (`answered` null), because round 1 cut only questions with `answered` above 0.

Lines changed:
- `api/src/surveys/survey-report.ts:424` `hiddenListQuestions`: the `answered > 0` condition is gone. Every TEXT or VOICE question whose served list is empty is cut, whatever `answered` is (null, 0 or a number). A question whose served list has items is unchanged.
- `api/src/surveys/surveys-results.service.ts:~371` comment only (the call at `:377` is the same). Nothing else changed: report, numbers, `dropFree`, `servedReport`. Before release the review list is unchanged.
- `api/test/admin/surveys-list-floor.spec.ts:331` new test: 8 people, 3 written and 3 voice at floor 5; before release the review list shows all 6 for ADMIN and AD_MANAGER; after release the report has `answered` null and empty lists, and the review list returns none of the 6 (empty items); a second survey with 7 written answers (13 people) still lists its 7 after release. It leaves nothing behind (same truncate in `afterAll`).

Failure on d12a763 (before the fix), the new test:
`expect(received).not.toContain(expected)` / `Expected substring: not "lonely"` / received `{"released":true,"items":[{... "kind":"TEXT","text":"lonely 0" ...},{"text":"lonely 1"},{"text":"lonely 2"},{"kind":"VOICE","text":"lonely voice 0"} ...],"total":6,...}` (spec line 373). It passes with the fix.

Totals after the fix: `tsc --noEmit` clean; eslint (no `--fix`) on the touched files: 0 errors, 3 old warnings. Every surveys spec (unit and `test/admin/surveys*`) with `wf2-deletion` and `mail-trouble-purge`: 13 suites, 186 tests, all pass. I did not rerun the whole `npm test` and did not merge `origin/main`.
