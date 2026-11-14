# V-SURVEYS round 4 (API)

Heads: code head before this round 16b3036, branch head found 8e4e705. Round 4 commits: d0db076 (findings 1, 2, 4), 35c8e3e (merge origin/main 95fe0a0), 0ac79a0 (merge origin/v/fix-c), bbf5a24 (shared scrub), then the users-search fix and this report (see `git log -1`).

## Findings
1. L-A, one helper: `suppressSmall` in `api/src/surveys/survey-report.ts` (about line 70 to 100). Every group under twice the floor is folded into Other by its count alone (no order, ties fold together). The fold is shown only when each folded group's range (high = min(h, 2f-1), low = max(0, h-(k-1)(2f-1))) is at least f wide, or its low end is already f; if not, `ok` is false and the question has no breakdown (all hidden, `answered` null, no Other). Other is always given when anything is hidden, so no subtraction from `answered` is possible. Zero-count groups are shown as 0 when nothing else is folded (nobody is in them). States and age bands use the same helper (ok false: no rows, no Other). Tests: `src/surveys/survey-round4.spec.ts` has the report's cases (20/19/19/19, 21/21/19, 18/22/22, 15/19/19/19, 19x4), all under the floor, one under, ties, two exactly at the floor, subtraction, and an exhaustive range check (floor 5: 2 to 5 options; floor 20: 2 to 4 options up to 85 answers): no hidden group has a range narrower than the floor. Cost: poll results under about 2x the floor mostly show one Other line, and one small option beside big ones gives no breakdown (e.g. 200/5).
2. N-2: `floorTotals` in the same file. views, starts, skips are null under the floor; starts (and completionRate) are also null when starts and responses differ by 1 to f-1. Contract: SurveyReportTotals fields nullable. Brand mail F04 already said "Fewer than N". No export or CSV route exists in this piece. Tests: round4 spec (3 tests).
3. Scrub: `scrubText`, `stripPhones` and the constants are deleted from `survey-rules.ts`. `survey-report.ts` and `surveys-results.service.ts` call `scrub(text, MAX_SCRUB_CHARS, REMOVED_MARK)` from `api/src/reach/scrub.ts` (merged from origin/v/fix-c). The nine sentences are a test in `survey-report.spec.ts` and come out unchanged.
4. SKIP: `surveys-public.service.ts` `event` (one row per person per survey per Lagos day, advisory lock so parallel requests store one); `openable` no longer checks skips (never locks out); placement hides a survey for the rest of the day after a skip. `surveys.max_skips` is left in the catalogue, text says unused. Tests: `test/admin/surveys.spec.ts` (4 skips send 1 row; open and answer 201 after; 6 parallel send 1; another day counts again).
5. Closed list (M-A to M-F, L-B, L-C, L-E to L-L): their specs (`survey-round3.spec.ts`, `test/admin/surveys-round3.spec.ts`, round 2) all pass, see numbers below. The third check's own attack runs were not repeated.

## Join
- main: conflicts in schema.prisma (comment, enum SURVEY_ANSWER + DM, settings useMyStateForSurveys + dmOpen), me/dto, export.service (survey and DM queries both kept), me.service, media.controller, me.spec, CONVENTIONS.md, schemas.py: both sides kept. openapi.yaml rebuilt, never hand-edited: 193 paths after both merges; a second build is `cmp`-identical.
- v/fix-c (it did not contain main): package.json setupFiles both kept; build.py required-query rule combined; users.service: kept main's `searchWhere`, and added fix-c's wildcard escape and empty "@" search to it (fixc.spec failed otherwise).
- Sweeper: survey answers charge nothing (no spendThen, no ledger, no wallet in `api/src/surveys`; the answer route touches only survey rows). The sweeper reads only marked POST_TEXT / POST_VOICE charges, so it cannot reach them.
- Migrations: db migrated with origin/main's own migrations, then `prisma migrate deploy` here applied 190000, 240000, 260000 cleanly, a second deploy: no pending. `migrate diff` against the schema is byte-identical (md5) to main's own diff (main's raw-SQL index drift only). No new migration added (340000 unused).

## Numbers
tsc --noEmit: clean. eslint on touched files: 0 errors. Survey specs plus scrub specs in band: 11 suites, 991 tests passed. Full jest in band on a fresh database (own PostgreSQL 16 port 18432, Redis 18379): 135 suites, 2397 passed, 1 skipped, 1 failed (fixc users search, fixed above; fixc and users specs then 35 of 35 on a fresh database). test:audio 13 of 13. Spec free-post number: no survey spec assumed 2.

## Assertions changed (old -> new)
- surveys.spec "two-skip limit": two skips hide it for good -> skips once a day, never locks out (ruling 4).
- survey-report.spec: poll 20/0 shown 20 -> Other 20; 40/30/5/4 all hidden, Other 79 -> 40 shown, Other 39; 50/12/10 all hidden, Other 72 -> 50 shown, Other 22; 40 Lagos + 1 Kano: Other 41 -> no breakdown (L-A).
- surveys-round2.spec: 20 same answers shown -> Other 20 (L-A); "zero eight" no longer asserted gone (ruling 3).
- survey-round3.spec: exhaustive suppressSmall check and 50/20/1 case rewritten to the new rule; six scrub cases dropped (ruling 3).

## Not done or unsure
- The shared scrub does not remove numbers spelt in words ("zero eight zero three ..."), "08O3I234567", ".studio" names, "snap me at name". Phones spelt in words now reach staff's read and the brand. Needs a lead ruling (extend the shared file).
- N-4 to N-6 of the third check not touched. N-5 web rule (send SKIP only on a real dismissal) is for the web.
- The range check is by enumeration up to the sizes above, not a proof for 5 or 6 options at floor 20.
