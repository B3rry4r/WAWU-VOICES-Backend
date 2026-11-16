VERDICT: MERGE

# Check of V-DAILY-WORDS (final)

Tree: origin/v/daily-words at aabe676. The only commit since my interim (519f3e2) is aabe676, which changes only the builder's report (`docs/lead/reports/V-DAILY-WORDS.md`). No product code or test arrived. `git merge-base origin/main origin/v/daily-words` = 5a00d54 (today's main).

I changed no product code and no existing test. My own attack tests were not committed.

## The one thing to know before release
This is not a fault in the code; it is what the owner's choice does. After release, every daily question that has not opened yet carries four words. Anyone posting there without a word gets 422 "Pick one word before you post." and nothing is stored. So the website and apps must show the word step on EVERY daily question before the next one opens (the next one opens soon: the seeded days start at 23:00 UTC the evening before). I only checked the API. I did not check the website or the apps. If a client does not show the word step, nobody can post on those days. Today's question (open, 0 answers) is left without words by the migration, so it is not affected.

## Findings (most severe first)
No HIGH. No MEDIUM.

LOW 1. The way back also empties a word list that was there before the migration. `rollback.down.sql:16-21` clears every DAILY question with words and no word-bearing answer, except the launch question. I gave a future DAILY question a two-word list ("ANGRY, TIRED") before the migration; after the way back its list was empty (it was not changed by the migration; the way back wiped it). On the live site only the launch question had words, so I expect no real effect. It also clears words from daily questions made after release (that is the point of the way back).

LOW 2. The word counts route counts only answers that carry a word. With 3 answers on a question that has words (1 with a word, 2 without), `GET /questions/{id}/moods` says `total: 1`, while the question's answer count is 3. Answers with no word only exist for a question whose list was filled after answers were posted, which the migration never does. Not a fault; noted so nobody is surprised.

LOW 3. The builder's report says its tree had 102 suites; this tree has 179. Its own totals are therefore not the CI totals. Mine are below.

## What held
1. Diff against origin/main: only `seed.ts` (+3), `topics.service.ts` (+3), the migration folder (2 files), two new specs, the builder's report. Both source files differ from main only by the added lines (nothing of main lost). No existing test edited.
2. Migration on a database built at origin/main (all migrations), calendar seeded by the seed script, launch question seeded, plus my rows (19 rows checked one by one):
   - Got the four words: DAILY opening in 5 minutes; DAILY DRAFT with no start; spare DAILY with no start; the 1,025 future SCHEDULED calendar days.
   - Unchanged: launch question (12 answers with words); today's open DAILY with 0 answers; open DAILY with 3 answers; LIVE with no start; LIVE already started; SCHEDULED whose start passed; SCHEDULED past its end; CLOSED with and without answers; a future DAILY whose only answer is removed; FLASH; FOLLOW_UP; OVERRIDE; DAILY with two words.
   - Run through `prisma migrate deploy` (how deploy.sh does it, `infra/deploy/deploy.sh:228`), then run again: "No pending migrations"; running the SQL by hand again changed 0 rows.
   - Speed: 5,000 questions, 500,000 answers, 20 people posting to the open question in a loop (4,492 posts). Migration 23 to 41 ms. Slowest post during the run: 44 ms; median 3 ms. Nothing blocked.
3. Moment of release. Deploy order from `deploy.sh`: migrate runs first, then the build, then the switch and restart. So the old app serves on migrated rows for the length of the build, and the new app never starts before the migration. The two source changes (seed, admin create) only matter when a question is created, and `posts.service.ts` and `poll.service.ts` are identical on main and on the branch, so old and new app answer the same on a migrated row. Tried:
   (a) A question that opens right after the migration, a person posting with no word: 422, code VALIDATION_FAILED, field `mood`, "Pick one word before you post." No answer row is stored.
   (b) Answers with NO word on a question that has words (a text one and a voice one), all through real routes, no 500, no wrong status: question answers list, `/feed/trending`, `/feed/new`, `/feed/trending-questions`, Home (signed in and out), `/questions/{id}/moods`, `/answers/{id}`, replies list, `/me/answers`, share link, share page, story and square, question share page, `/questions/today`, `/calendar`, `/search`, admin pool, admin topics, admin summary draft (its word block counts only worded answers). The share card spec for the no-word answer builds without error. `where-you-sit` for a no-word answer is 404, as for any answer with no word. The weekly feelings job and the mail code read `mood: { not: null }` or check for null (`weekly-draft.ts:106`, `mood-stats.service.ts:86`, `mail-events.ts:551`). I did not send mail.
   (c) A person who loaded a not-yet-open question's page, then posts after it opened: before it opens the answer is 404 "We could not find that." (NOT_FOUND). After it opens, with no word: 422 as in (a), with the same body.
4. The way back: clean run (no answer carries a word) emptied 1,030 lists and left the launch question's four words untouched. With an answer that carries a word (TIRED) on a migrated question: it raised "rollback refused", changed nothing (1,031 questions with words before and after), with plain `psql -f` and with ON_ERROR_STOP. Answers all stayed (18 rows, 12 with words). Reminder: it does not delete the `_prisma_migrations` row; the file says to do that by hand.
5. Through real routes: written and voice answer with a word 201 and stored; no word 422 (exact body above); a word outside the four 422 "mood must be one of the following values: ANGRY, TIRED, PROUD, HOPEFUL"; a question with two words and a third word 422 "Pick one of the words shown."; explain my vote with and without `questionId`, with and without a word: 422 without a word, and the VOTE stays recorded (vote count 1 after the refused reason, the vote is its own request); with a word 201 under the right question. Replies need no word (201; a reply that sends `mood` is refused as an unknown field). Editing an answer keeps its word; the edit route refuses a `mood` field, so it cannot be changed or dropped. Paid long voice post (25 s, balance 500,000): no word is 422 with no charge and the balance unchanged; with a word 201, balance 422,000. Anonymous post: 422 without a word, 201 with one (word stored). The same Idempotency-Key sent again after a 422, now with the word: 201 and it posts (the 422 is not stored under the key). `/questions/today`, Home, calendar and topic page return the question with `moodOptions`. Word counts and share page carry the word.
6. New questions: admin route makes a DAILY with the four words; FLASH and FOLLOW_UP with none; OVERRIDE is refused by this route (422, "Use Override the day...") and `overrides.service.ts` is untouched by the branch. The seed on a fresh database: 1,031 DAILY, all with the four words, nothing else created (the seed only makes DAILY). The seed run again: 0 new, row dump hash identical before and after. The seed run on a database whose rows have no words: 1,030 "already there", hash identical, existing rows not rewritten.
7. The two new specs: 3 runs in a row on one database, 15 of 15 each time. Before and after each run: 0 published answers, 0 non-draft questions, 0 non-draft topics. They leave nothing readable.
8. Gates (this tree is the 179-suite one):
   - `npm run lint` (run as `eslint` without `--fix`, so no file is rewritten): 0 errors, 56 warnings. `origin/main` gives the same 0 errors and 56 warnings.
   - `npm run typecheck`: clean.
   - `npm test` (CI's command): 179 suites, 178 passed, 1 failed. 2,922 tests, 2,920 passed, 1 skipped, 1 failed. Because jest failed, the `&&` stopped before `test:audio`; I ran `npm run test:audio` alone: 13 of 13 pass.
   - The one failure is the ruled one: `test/vote/explain-launch.spec.ts`, "explain my vote on seed:launch data (H2) › without a questionId the reason goes to the topic's open question in slot order, as it always did for slot 1" (the test starts at line 164; the failing `expect(201)` is at line 169; 422 comes back because slot 1 is now a daily question that needs a word). It passes 4 of 4 on origin/main. It is the only test that fails, so every other test passes on the joined tree. List of tests failing for another reason: none.

## What I ran
Local databases only; nothing live, no request to usevoices.com, no `.env` opened. About 12 local test databases and a local Postgres and Redis, all mine. Attack tests (5 files, not committed) covered items 3, 5 and 6 through the real app.

## What I could not prove
- Whether the website and the apps show the word step on every daily question (see the one thing above). This is the real risk to the record screen (rule 4), and it is outside this repo.
- The live data. My rows are shaped like the live ones from your list, not copied from them.
- The share card picture itself: in my test setup the card route gave 404 for worded and no-word answers alike (no stored picture), so I proved only the card spec and the share page.
- Mail: I read the code paths; I did not send or render the mail.
