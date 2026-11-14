VERDICT: FIX

# Check of V-SURVEYS round 4 (API)

Checked: `origin/v/surveys` at f7377d3, on branch `verify/surveys-4`. I changed no product code and no test. My attack specs and solvers are not committed. Own PostgreSQL 16 (port 18432) and Redis, fresh databases.

## Findings, most severe first

### HIGH

**H1. Staff routes give the exact number of people who answered, at any group size.**
- Routes: `GET /admin/surveys`, `GET /admin/surveys/{id}` (`responses`, `completes`, `starts`, `skips`, `views`), `GET /admin/surveys/{id}/report` (`answeredSoFar`, at every stage, before release too). Roles AD_MANAGER and ADMIN.
- Code: `api/src/surveys/surveys-admin.service.ts:186-243`, `api/src/surveys/surveys-results.service.ts:255-280`.
- Steps and numbers (floor 5): surveys with 1, 2 and 4 answers gave `responses` 1, 2, 4 on the detail route, while the released brand report for the same surveys said `belowMinimum: true` and nothing more. A survey with groups 50/6/5/4/2/1 gave `responses: 68` while running. Reading the route before and after one person answers gives a difference of exactly one. `starts` minus `completes` gives the people who began and did not finish, with no floor.
- The third check called this L-K and it was left. Under this brief it is a break. If the lead rules that staff may see operational counts, this becomes LOW; otherwise put the same floor (null under it) on every count on those three routes.

### MEDIUM

**M1. Deleting an account does not remove their answers from results, and the voice part shows as a difference of one.**
- Steps: 12 people answer a choice, a text and a voice question; staff read the review list (`total` 24, 12 voice). One person's account is purged (`DeletionService.purge`, status DELETED). Review list again: `total` 23, voice 11, but still 12 text answers, including that person's own text ("text of d3"). After release: 12 responses, the choice count still 12, the deleted person's text still in the brand's list. Only the voice answer goes (clip removed, transcript blanked).
- Two faults: (a) choice and text answers stay in the stored snapshot and in `releasedReport` for good (`deletion.service.ts` touches only `SurveyEvent`); the key is an HMAC of (survey, person), so the server could find and delete them and does not. The export note says they "cannot be listed", which is also not true of deleting. (b) The voice part is removed, so the review `total` drops by exactly one, and the whole voice question then vanishes from the brand report (`answered` null, 0 voices) because the gap became 1.
- Fix: on purge, delete the person's `SurveyResponse` rows (recompute the key for each survey with events or all live surveys), and handle a released report as the lead decides.

**M2. The shared scrub lets some contact details through to staff and the brand** (`api/src/reach/scrub.ts`, called from `survey-report.ts` and `surveys-results.service.ts`).
Run on the scrub directly (input => output):
- `08O3I234567` => `0803I234567` (the number is still there)
- `eight zero three, one two three, four five six seven` => unchanged
- `snap me at chidi` / `snap me at chidi_o` => unchanged
- `visit mybrand.studio` and `mybrand dot studio` => unchanged
- `t . me / chidi` => `t. me / chidi`
- `c h i d i @ g m a i l . c o m` => unchanged except one dot
- `chidi dot okafor at gmail dot com` => `chidi dot [removed]`
Held: digits in any form including full-width, `+234`, 08xx with dots or dashes, continuous number words, emails in symbol and bracket forms, `wa.me`, `t.me/x`, `ig: name`, `@name`, links with scheme or `www`. The builder's report said number words reach the brand; in my run continuous number words were removed, but comma-grouped ones were not. Staff read the free answers before release, so this is a rule broken with effort, not an open door.

### LOW

- L1. Zero versus nonzero tell. `suppressSmall` shows a group of 0 as `0` when nothing else is folded, and hides a group of 1 to 19 in the same place. So "nobody chose this" is distinguishable from "a few did" (my solver: 1,468 of 128,524 vectors at floor 5 show a shown 0 beside a hidden small group in other cases). No size is given.
- L2. The daily view cap is not exact under parallel requests: 8 parallel VIEW events from one person stored 2 rows with cap 1 (`surveys-public.service.ts`, VIEW branch has no lock). Counts only. START and SKIP held (1 row).
- L3. No brand sign-in or brand role exists, so "a brand user sees only their own brand" cannot be tested: every AD_MANAGER or ADMIN sees every brand's survey and report. Not a defect of this piece, but the brief's clause has nothing to hold.
- L4. Answers staff hide, or that the scrub empties, leave the brand's list with no mark (a mark would give a count). By design; noted because the brief says nothing cut silently.
- L5. Migration `_2` runs `UPDATE "SurveyEvent" SET "userId" = NULL WHERE kind = 'COMPLETE'`; its rollback cannot put those back. Harmless (it removes a link), but the rollback does not say so.
- L6. Branch is two commits behind `origin/main` (#23, #27). A trial merge (`git merge-tree`) conflicts only in `api/.env.example`.
- L7. `npm run lint` has `--fix`; I ran eslint without it to avoid rewriting files.

## What held (with the attacks I ran)

1. **Small group never computable.** Solver over `buildReport` (every count vector, group sizes up to 2x floor, with and without unanswered people): floors 2, 3, 4, 5, 6, 8; 2 to 5 options; about 1.1 million vectors in total. Recovered exact size of a hidden group: 0. Narrowed a hidden group to a range narrower than the floor: 0 (one early F=8 hit was my own enumeration cap, gone when the cap was lifted). States and age bands with consent overlap (3 states x 3 age bands, floor 3: 940,992 datasets; floor 5: 4,249,078): 0 recoveries of any small group, of the unshared remainder, or of the shared totals. On the API: groups 50/6/5/4/2/1 gave A=50 and Other=18 (a hidden total above the floor), nothing else. There is no filter on the report, so "two filters differing by one group" does not exist; cross-question differences are signed, not groups (not proven for every combination, see below).
2. **Counts under the floor.** Brand report: views, starts, skips null under the floor; responses null below it; options in the order written, not by size; no export or CSV route exists (`grep csv` empty). Percentages only for shown groups.
3. **One answer per person.** 6 parallel answers by one person: 1 x 201, 5 x 409; a later answer 409; viewing after answering shows no questions; COMPLETE events carry no user id (0 of 7); other people's clips refused (existing spec).
4. **SKIP.** 5 skips: 1 row. Parallel 6 skips right at 22:59:59.999Z: 1 row. Skips at 22:59:58 and 22:59:59.9Z: one day (Nov 14); 23:00:00Z and again: a second row (Nov 15), not three. Placement hides the survey the rest of the Lagos day and returns it the next. A skip after answering adds no row. (Date faked only; tokens made at the faked time.)
5. **Roles.** 13 admin routes x guest, signed-in person, moderator, editor = 52 calls: all 401 or 403, zero wrong. A draft survey: `GET` 404, events 404, absent from placement; brand page lists only approved, in-date surveys.
6. **Scrub.** Emails, phones, links, handles in free text came out `[removed]` in both the staff list and the brand report (see M2 for the misses).
7. **Migrations.** Stamps: this branch adds 20261114190000, 20261114240000, 20261114260000. `origin/main` has 20261114200000 (fix_d), 220000, 290000, 300000, 310000 and others; no stamp is shared. Applied origin/main's 24 migrations by hand to a database holding 50 users, 50 voice clips, 5 adverts, 50 settings rows; then the three survey migrations ran clean; counts unchanged. Rollbacks: `_3` refused with `reviewedAt` set and with only `reviewedById` set; `_2` refused for snapshot, released report, hidden answer, advert tied to a brand, consent switched on; `_1` refused with a survey, with only a brand, with only a survey voice clip; with everything cleared all three ran and the 50/50/5/50 rows stayed.
8. **Suite.** `npx prisma generate`: ok. `npx tsc --noEmit`: clean. eslint without `--fix`: 0 errors, 47 warnings. `npm test` (jest, in band, fresh database): 135 suites, 134 passed, 1 failed; 2,397 tests passed, 1 skipped, 1 failed. The failure was `test/reach/scrub-round4.spec.ts` "200,000 characters of 1-: under 50 ms", a timing test, run while my solvers shared the CPU; alone it passed (473 of 473). `npm run test:audio` then run on its own (the chain stops after a jest failure): 13 of 13.

## What I could not prove

- Timing: report reads are a stored snapshot, so reasoned constant by group size; I did not measure it.
- Differences between questions and between surveys (a brand running two surveys that differ by one target state) were not solved; I found no exact case but did not enumerate it.
- A brand adding its own sock-puppet answers to push a hidden group across a fold: only one frozen report exists per survey, so no before and after; not tested across surveys.
- Brand-user separation (no brand role exists), mail F04 in a real client, the web.
