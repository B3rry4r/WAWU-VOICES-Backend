# V-DAILY-WORDS: the same four words on every daily question (rule W)

Branch `v/daily-words`, from origin/main. Prepared only. Nothing is released.

## What changed
- `api/src/feed/seed.ts` (the seed row, `moodOptions: [...MOODS]`): the calendar seed gives every DAILY question the four words.
- `api/src/admin/topics.service.ts` (createQuestion, `...(dto.kind === "DAILY" ? { moodOptions: [...MOODS] } : {})`): an admin adding a DAILY question to a topic gives it the four words. FLASH and FOLLOW_UP get none.
- `api/src/admin/overrides.service.ts` is NOT changed. Its question is kind OVERRIDE, not DAILY, so rule W says leave it alone. Tell me if you want words on it too.
- No route lets the caller send `moodOptions`, so nothing there to honour.
- Launch question seed: untouched.

## Migration and way back
`api/prisma/migrations/20261115100000_daily_words/`
- `migration.sql`: data only. Every DAILY question with an empty list and no answer row at all (any status of answer) gets ANGRY, TIRED, PROUD, HOPEFUL. Safe to run twice (second run changes 0 rows).
- `rollback.down.sql`: refuses (raises, changes nothing) if any DAILY question other than the launch question has words and an answer that carries a word. Otherwise sets the list back to empty on those questions. The launch question keeps its words.

## Runs
- `npx tsc --noEmit`: clean. Lint: 0 errors (warnings were already there).
- New specs (`api/test/mood/daily-words-migration.spec.ts`, `daily-words-routes.spec.ts`), 3 runs in a row, same database: 14 of 14 passed each time.
  - Migration spec runs in a transaction that is rolled back, so it leaves nothing. It covers DRAFT, SCHEDULED, LIVE and CLOSED dailies with no answer (get words); a daily with one answer, with only a removed answer, with only a held answer (unchanged); the launch question, a question with two words, FLASH, FOLLOW_UP, OVERRIDE (unchanged); twice (0 rows the second time); the way back clearing and refusing.
  - Routes spec: admin route and calendar seed give the words (FLASH none); text and voice posts need a word and store it; explain my vote; word counts route; share card word and share page; the question, `/questions/today` and Home carry `moodOptions`. Its questions end as DRAFT and its answers REMOVED.
- Migration on a fresh database: applied, all migrations succeed. On a database with 8 dailies (2 with answers), a flash question and the launch question: 6 answerless dailies got words, the 2 answered ones and the flash question stayed empty, the launch question unchanged; the way back then left only the launch question with words.
- Whole suite (`npx jest --runInBand`, own local database): 1159 tests, 1157 passed, 1 failed, 102 suites (1 failed). I did not run `npm run test:audio`.

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
- `npm run test:audio` not run.
- Whether apps and the website show the word step on every daily question was not checked (backend only).
