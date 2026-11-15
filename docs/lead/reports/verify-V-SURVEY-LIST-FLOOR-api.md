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

## Still running (full report to follow)
Whole `npm test` in band on a fresh database with my own Redis on the port the specs use (14002); the old assertions diff review; the "what can be worked out" cases; every reader of `releasedReport`; release order.
