# V-DAILY-WORDS: the same four words on every daily question (rule W)

Branch `v/daily-words`. Prepared only. Nothing is released.

## Round 4 (owner's order)
Owner's order, 16 Nov 2026 ("Same 4 words daily"): rule W is the rule. `origin/main` had not moved (5a00d54, already in the branch), so no new merge.
- `api/test/vote/explain-launch.spec.ts`, the test at line 164 ("without a questionId the reason goes to the topic's open question in slot order..."): the request now also sends `mood: "HOPEFUL"`, it still expects 201 and slot 1's question, and one new assertion checks the stored answer carries `HOPEFUL`. The one-line comment from the order sits above it. No other existing test changed.
- New test next to it: the same request with no word is refused with 422, field `mood`, "Pick one word before you post.", no answer is stored and the vote stays recorded.
- I also made my own migration spec robust: one test now steps aside, inside its rolled-back transaction, a launch question that another spec may have left in the database (it failed once for that reason when run after explain-launch on the same database). Only my own new spec changed.
- Runs: explain-launch 3 times in a row on one database, 5 of 5 each time. Both daily-words specs 3 times, 15 of 15 each time. Every spec under `api/test/vote` and `api/test/mood`: 6 suites, 68 of 68. Typecheck clean. Eslint (no `--fix`) on the touched files: no errors.
- Whole `npm test`, one part, on its own: jest 179 suites, 2923 tests, 2922 passed, 1 skipped (skipped on main too), 0 failed. `test:audio`: 13 of 13.
- Honest note on earlier whole runs the same day: two other whole runs on this branch had failures that were not from this change. One had `test/reach/fixb-alerts.spec.ts` (3 tests, passes alone on the first run on a fresh database, then fails on a repeat run on the same database, on origin/main as well) and one had `test/talk/hotfix1-block-oracle.spec.ts` (passes alone). The second of those two runs ran at the same time as a run on origin/main against the same local Redis, and the origin/main run then showed 22 failures in `test/mail/topic-mail-round4.spec.ts`. So runs side by side on one machine are not reliable; the clean single run above is the one that counts. `fixb-alerts` keeps a one-notice-per-hour marker in the database, so it can fail when another run or spec in the same hour has claimed it. I did not see the `fixb-r4-edit` timing test fail.

## Round 3: the branch now contains main
My first two rounds ran on an old tree (merge base 755aa15, 102 suites). The branch now has a merge commit of origin/main (`5a00d54`, which contains b727150 and is 103 commits later than 755aa15). The conflicts were only import lines in `api/src/admin/topics.service.ts` and `api/src/feed/seed.ts`; I kept both sides and kept my rule W lines. I read what main changed in those files: no new place creates a DAILY question (main still creates questions only in seed, admin topics, admin overrides and the launch seed), and the seed rows still set `kind: "DAILY"` the same way. So rule W is in the same two places as before; overrides stay OVERRIDE and get no words.
- Migrations: main's last is `20261114370000_released_totals`; mine `20261115100000_daily_words` runs after it. All migrations applied on a fresh database. On a database built from main's migrations only, with 8 dailies (some answered, some past, a CLOSED, a DRAFT with a start in the future), a flash question and the launch question, my migration changed only the answerless DAILY draft that has not opened; a second run changed nothing more.
- Lint: 0 errors (56 warnings, as before). Typecheck: clean. My two specs: 15 of 15, three runs in a row on the same database.
- Whole suite (`npx jest --runInBand`, then `npm run test:audio`): 179 suites, 2922 tests: 2920 passed, 1 skipped, 1 failed. Audio: 13 of 13.
- The one failure is the same one as before: `api/test/vote/explain-launch.spec.ts`, "without a questionId the reason goes to the topic's open question in slot order, as it always did for slot 1" (422, no word). It passes on origin/main (4 of 4). It is the only existing test that fails only because a daily question now needs a word; no others turned up on the newer tree.


## What changed
- `api/src/feed/seed.ts` (the seed row, `moodOptions: [...MOODS]`): the calendar seed gives every DAILY question the four words.
- `api/src/admin/topics.service.ts` (createQuestion, `...(dto.kind === "DAILY" ? { moodOptions: [...MOODS] } : {})`): an admin adding a DAILY question to a topic gives it the four words. FLASH and FOLLOW_UP get none.
- `api/src/admin/overrides.service.ts` is NOT changed. Its question is kind OVERRIDE, not DAILY, so rule W says leave it alone. Tell me if you want words on it too.
- No route lets the caller send `moodOptions`, so nothing there to honour.
- Launch question seed: untouched.

## Migration and way back
`api/prisma/migrations/20261115100000_daily_words/`
- `migration.sql` (round 2, edited in place): data only. A DAILY question gets ANGRY, TIRED, PROUD, HOPEFUL only when its list is empty, it has no answer row at all, it is not CLOSED, and it has not opened yet: `startsAt` is null or later than now, and it is not a LIVE question with no start (`isQuestionOpen` treats that one as open). Open, over and closed questions are never touched, so no one recording sees the form change. Safe to run twice (second run changes 0 rows). Spare questions (no start) do get words.
- `rollback.down.sql`: refuses (raises, changes nothing) if any DAILY question other than the launch question has words and an answer that carries a word. Otherwise sets the list back to empty on those questions. The launch question keeps its words.

## Runs
- `npx tsc --noEmit`: clean. Lint: 0 errors (warnings were already there).
- New specs (`api/test/mood/daily-words-migration.spec.ts`, `daily-words-routes.spec.ts`), 3 runs in a row, same database: 15 of 15 passed each time (round 2; migration spec now covers: DRAFT or SCHEDULED not yet open get words; open LIVE, LIVE with no start, SCHEDULED whose start has passed, SCHEDULED past its end, CLOSED are unchanged; answered, removed-only, held-only, launch, other kinds unchanged; twice changes nothing; the way back).
  - Migration spec runs in a transaction that is rolled back, so it leaves nothing. It covers DRAFT, SCHEDULED, LIVE and CLOSED dailies with no answer (get words); a daily with one answer, with only a removed answer, with only a held answer (unchanged); the launch question, a question with two words, FLASH, FOLLOW_UP, OVERRIDE (unchanged); twice (0 rows the second time); the way back clearing and refusing.
  - Routes spec: admin route and calendar seed give the words (FLASH none); text and voice posts need a word and store it; explain my vote; word counts route; share card word and share page; the question, `/questions/today` and Home carry `moodOptions`. Its questions end as DRAFT and its answers REMOVED.
- Migration on a fresh database: applied, all migrations succeed. On a database with 8 dailies (2 with answers), a flash question and the launch question: 6 answerless dailies got words, the 2 answered ones and the flash question stayed empty, the launch question unchanged; the way back then left only the launch question with words.
- Whole suite (round 2, `npm test`, own local database): jest 1160 tests in 102 suites, 1158 passed, 1 skipped (already skipped on main), 1 failed. `npm run test:audio` run separately (npm test stops before it when jest fails): 13 of 13 passed.

## CI command and what my run covered
`.github/workflows/ci.yml` (and the test job in `deploy.yml`) run, in `api/`: `npm ci`, `npx prisma generate`, `npm run lint`, `npm run typecheck`, `npm test`. `npm test` is `jest --runInBand --forceExit && npm run test:audio`. My whole-suite run is exactly that command (round 2 verbatim; round 1 was the jest part only). Lint here is eslint without `--fix` (0 errors) so it would not rewrite files.
The brief said earlier runs had about 2,900 tests in 158 suites. This branch has only 102 spec files (`find src test -name "*.spec.ts"`), and jest ran all 102; there are no `*.e2e-spec.ts` files, so `test:e2e` has nothing to run. So the difference is not a filter in my run. This checkout, at origin/main plus my commits, simply has 102 suites and 1160 tests, so the 2,900 / 158 figures must come from a different tree (another branch or a combined merge). I cannot run what does not exist here.

## Existing tests that fail (none were edited)
One, and it fails only because a daily question now needs a word:
- `api/test/vote/explain-launch.spec.ts:164`, "without a questionId the reason goes to the topic's open question in slot order, as it always did for slot 1". Error: expected 201, got 422. It seeds the calendar, so slot 1 is a DAILY question that now has words, and the test posts a reason with no word. It passes on origin/main (4 of 4).
Count failing only because a daily question now needs a word: 1 of 1.
Why so few: most existing specs build their questions straight in the database, with no words, so rule W does not reach them. Only the seed and the admin route add words.

## What an older client gets
An answer, or an explain-my-vote reason, with no word on a daily question: status 422, code VALIDATION_FAILED, field `mood`, message "Pick one word before you post." A word that is not one of the four: 422 "Pick one of the words shown." Existing unanswered questions get words from the migration, so this reaches live questions too.

## Not proved
- Not run against any live data; only my local databases.
- A question that already has an answer keeps its empty list, so on the live site old daily questions with answers keep no word step. Days without any answer by deploy time get words.
- A question that gets its first answer before the migration runs keeps its empty list; the migration is a one-time snapshot.
- Whether apps and the website show the word step on every daily question was not checked (backend only).
