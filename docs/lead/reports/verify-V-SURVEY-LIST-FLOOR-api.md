VERDICT: FIX
INTERIM

# Check of the survey list floor (interim, branch v/survey-list-floor at d12a763)

Plain summary: the rule itself holds. One gap is left: staff can still read the leftover answers of a list that was hidden at release. The fix is small.

## Findings (most severe first)

### 1. HIGH: leftover items of a list hidden AT RELEASE are still readable in the staff review list after release
Steps (my own spec, real HTTP, floor 5): 8 people, 3 wrote ("lonely 0..2") and 3 spoke. Finish, read the review list, release.
- `GET /admin/surveys/:id/report` (ADMIN): the written question has `answered` null and `texts` []. Hidden, correct.
- `GET /admin/surveys/:id/free-answers` (ADMIN or AD_MANAGER) after release: still returns "lonely 0", "lonely 1", "lonely 2" and the three voice transcripts.
Why: `hiddenListQuestions` (`api/src/surveys/survey-report.ts:~421`) only cuts a question whose `answered` is above 0. A list hidden at release has `answered` null, so it is not cut, and `surveys-results.service.ts:~377` serves the live answers.
This is the same on main (not new), and staff only. But the owner order says that after a list is hidden none of the leftover items may appear anywhere. Same hole after a purge is closed only for lists released with `answered` above 0.
Fix: after release, cut every TEXT or VOICE question whose served list is empty (any `answered`), not only `answered` above 0. Keep before-release unchanged. Add a spec for it.

## What held (interim)
- Rule at floor 5, 7 written and 6 voice, purging all 13 people one by one through the real purge: written list 7, 6, 5, then empty from 4 down; voice 6, 5, then empty from 4. `answered` stayed 7 and 6, the whole report except the lists was identical to release at every step, the choice question was unchanged, detail and totals identical, no `textIds` or `voiceIds` in any response, guest got 401, a plain signed-in person got 403 or worse. Stored report is emptied (texts and ids) once under the floor.
- Person with no item: nothing changed (5 stay at 5). Two people with the same text: purging one of them left 4 items, emptied, numbers unchanged. A staff-hidden answer was not in the released list and did not disturb the count.
- Floor 20 (22 listed): 22, 21, 20 shown, then empty at 19 after the next purge; the stored report keeps its own floor of 20 when the setting later goes back to 5 (served by the report's own floor).
- Gate: `npm ci`, `prisma generate`, `tsc --noEmit` clean. eslint (no fix) on the 7 touched files: 0 errors, 3 warnings (unused disable directives, one unsafe argument in round 6). No change under `api/prisma` or `docs/contract`.
- Race, purge vs release with a reader, rounds 0 to 20 of 30 done: all 200, no list of 1 to 4 served, final lists empty, no deadlock line in the Postgres log. Rounds 21 to 29 and the two-purges race re-run are in progress.

## Other checks
- **Changed assertions:** `git diff origin/main...HEAD -- test/admin/surveys-round6.spec.ts test/admin/surveys-round7.spec.ts` is 21 changed lines. Round 6 "exactly N released, then one purge": only the length now `n === 5 ? 0 : n - 1`. Round 7 "14 released, 10 purges": lists 0 (was 4), `answered` still 14, regex widened to `[0-9]+` and also run on the stored report, sorted-list assertion removed. Nothing else weakened.
- **Lost protection (MEDIUM, LOW effort):** removing the sorted-list assertion means no spec now checks "the purged people's items are gone and nobody else's item went" at a size where the list still shows. The new spec's 7-written case checks sizes (6, 5) but not which items. Add: 8 listed, purge 2 (6 left), assert exactly the 6 other texts remain.
- **Every reader of `releasedReport`/`releasedTotals`/`texts`/`voices` in `api/src`:** report route (`servedReport`), review list (`:376`), release write (`:527-541`), results mail (`:575`, counts and top choice only), admin list/detail (`surveys-admin.service.ts:288`, totals only), purge (`survey-erase.ts`). Confirmed: no brand sign-in route and no CSV or JSON export on the server. `me/export.service.ts` exports a person's own answers only.
- **What can be worked out (solver, floors 2 to 6, lists floor to floor+4, 1 to 5 purges, 3,025 cases):** after the change a reader never knows more than on main; in 1,584 cases it knows less. With an earlier copy: shown lists give the same as before; once hidden the reader learns only that more than N minus floor people left, not who. Without an earlier copy: sees `answered` N and an empty list, learns only that fewer than the floor remain, never the leftover items or a group under the floor. "Hidden at release" (`answered` null) versus "hidden later" (`answered` a number) reveals only that N was at least the floor at release and more than N minus floor then deleted. Nothing new beyond what main already showed. No new leak (finding 1 is a staff route, not new).
- **Races:** purge plus release plus a reader, 30 of 30 rounds clean (the first run stopped at round 21 on a clash in my own test phone numbers; rerun clean). No 5xx, no short list served, no deadlock text in the Postgres log. I did not re-run the two-purges-at-once case beyond the builder's 20 rounds (the 30-round run had three purges at once). Lock order: the diff does not touch locking (`lockRow` and `withTxRetry` lines unchanged).
- **Nothing else moved:** `dropFree` only changes output through `hideShortLists` on touched questions; an unreleased survey takes the old rebuild branch unchanged. `buildReport`, the fold and `floorTotals` are not in the diff. I did not run an inference sweep over every served report; the unit and HTTP runs showed no list of 1 to floor-1.
- **Release order:** by file size the new HTTP spec is rank 76 of 176 and runs before `hotfix1-block-oracle` (102). Its truncates are the same tables the round 7 spec truncates. It creates no posts, questions or moderation rows.

## Could not prove
- **Whole `npm test` in band:** I started it on a fresh database with Redis on port 14002, but it had not finished when I had to write this. I have no totals. The builder's run, 2887 passed, 1 skipped and 2 failed, is not confirmed by me. Redis was not running on 14002 in my first start, so the vote spec failure there is a missing Redis, not a clock.
- I did not run `test/vote/vote.spec.ts`, `test/mail/topic-mail-round5.spec.ts` or the skipped test against a clean `origin/main`, so I cannot say whether they fail there too.
- The pure unit specs for `buildReport`, the fold and `floorTotals` were not re-run separately.

## Re-check of rounds 2 and 3 (interim, on 3f1febf; round 3 not on the branch yet)
1. **Diff d12a763..3f1febf under `api`:** 3 files, +56 -4. `survey-report.ts`: in `hiddenListQuestions` the line `(q.answered ?? 0) > 0 &&` is removed, plus a new comment. `surveys-results.service.ts`: comment only. `surveys-list-floor.spec.ts`: one new test added. No existing assertion touched, no other file.
2. **Finding 1: CLOSED.** The builder's new test follows my steps (8 people, 3 written and 3 voice at floor 5): before release the review list shows all 6 for ADMIN and AD_MANAGER; after release none of them; a 7-written survey still lists its 7. My own spec (13 purges, 7 written and 6 voice) also checks the review list and every other route at each step: once a list is empty by purges (released with 7, now 4 and below), no leftover text appears in any response. Before release nothing is cut (the review list is read in full before release in every spec). On 3f1febf: my spec plus the builder's list-floor spec, rounds 6 and 7 and all `src/surveys` specs, 8 suites, 88 passed, 0 failed (34 skipped only because I filtered by test name). The 30-round purge and release race is in that run and passed.
3. **MEDIUM (which items remain):** waiting for round 3 on the branch.
4. **Whole `npm test`:** running now in band on a fresh database with Redis on 14002, on 3f1febf (main has not moved: 2f1d9d9). Totals to follow.
5. **Skipped test:** to follow.
