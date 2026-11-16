# V-MAIL-COPY

Branch `v/mail-copy`, from origin/main 5a00d54. No pull request opened. No schema change, no migration.

## What changed

- `api/src/mail/mail.service.ts`: new `plural(n, one, other)` and `countOf(n, one, other)` ("1 voice", "1,204 voices"). The template renderer has no logic, so the word is passed in as a value.
- `api/src/mail/topic-mail.service.ts`: `voice_count` is now the whole phrase (`countOf(q.voiceCount, "voice", "voices")`) in `runDailyQuestion`. `short()` is now exported and cuts at the last space (rule below).
- C01 text and HTML: `{{voice_count}} voices so far` became `{{voice_count}} so far`. The variable name is unchanged, so the older tests that give `voice_count: "5"` still render.
- Other real cases fixed (all sent mail): F01 (review time), F04 (responses, days live, preheader), G01 (voices, votes), B12 (proposals in the group). The values come from `api/src/mail/mail-events.ts`.
- New spec `api/test/mail/mail-copy.spec.ts` (pure, no database).

## Before and after (today's real question, 16 Nov)

- Subject before: `Today’s question: As a Nigerian, are you really fine? You dey okay? Or are you just tir…`
- Subject after: `Today’s question: As a Nigerian, are you really fine? You dey okay? Or are you just…`
- Body line before: `1 voices so far · closes in 6 days`
- Body line after: `1 voice so far · closes in 6 days` (2 voices, 0 voices, 1,204 voices follow the number)

## short()

Over the limit: cut at the last space at or before the limit (with the "…" counted), drop a trailing comma, colon, semicolon, dash or opening quote or bracket, add "…". No space in the second half of the room: cut hard (never leaving half an emoji). At or under 70: unchanged.
Only one caller: `question_short: short(q.text)` in `runDailyQuestion` (C01 subject and `question_short`). Today's text now gives `As a Nigerian, are you really fine? You dey okay? Or are you just…`.

## Every template checked

Only the templates in MAIL_TEMPLATES are sent; the other files are kept unsent.

- Fixed: C01 (voices), F01 ("within N days", review_days could be 1), F04 (responses, "days live", preheader "N responses are in"), G01 (voices, votes), B12 ("proposals in the group").
- NOT changed, needs your word: A12 ("N new replies | N open polls"). `api/test/mail/mail-round2.spec.ts:204` pins `/1 new replies \| \d+ open polls/` and line 200 pins "new replies". I did not touch the test or the template. Its HTML tiles read "1 / new replies" too.
- Checked, no fault: B03 ("Replies on this voice so far: N", noun first), B12 "total support" (a mass noun), D02 (balance with no word after the number), F02 "Target responses: N", B01, B09, B11, D01, D03, D04, E01 to E14, F03, G04, G05, G06, G09, H04, C02, C14 (no count followed by a fixed word).
- Same fault, but never sent (no sender in the code), left alone: B05, B06, B08, B10, C03 to C06, C08, C09, C11, D05, D06, F05, F08, G02. Fix them with the same `countOf` pattern if they are ever wired.

## Runs

- `npm run typecheck`: clean.
- eslint (no `--fix`) on the 4 touched source and spec files: clean.
- New spec alone, no database: 13 tests passed.
- `test/mail` and `src/mail` (16 suites): 287 passed, 0 failed.
- Whole `npm test`: 178 suites passed; 2919 passed, 1 skipped (already skipped before my change), 0 failed. The 13 audio tests passed. `test/talk/fixb-r4-edit.spec.ts` passed in the full run.

## Not proven

- I did not send any email or call any live service. The words come from the real renderer, but I did not view a real inbox.
- Tests ran against a local Postgres and Redis (services.sh), not production.
- The commit trailer is the Sonnet 5.5 one from this session, not the Fable 5.2 line in the brief, because I am not that model.
