# V-MAIL-CLOSES-IN

Owner order (15 Nov 2026): a question with more than 48 hours left shows days in the morning email.

## Lines changed
- `api/src/mail/topic-mail.service.ts:132` doc comment updated.
- `api/src/mail/topic-mail.service.ts:137` new line: `if (h > 48) return \`${Math.floor(mins / 1440)} days\`;`
- New spec `api/test/mail/closes-in.spec.ts` (pure unit, no database, leaves nothing behind).

The 48 hour limit is checked after the existing rounding to whole hours. Days are counted from the real minutes and rounded down, so the time left is never overstated.

## Inputs and outputs
| Time left | Shown |
|---|---|
| 1 minute | 1 minute |
| 59 minutes | 59 minutes |
| 60 minutes | 1 hour |
| 20 hours | 20 hours |
| 47.5 hours | 48 hours |
| 48 hours | 48 hours |
| 48.6 hours | 2 days |
| 49 hours | 2 days |
| 71 hours | 2 days |
| 72 hours | 3 days |
| 185 hours | 7 days |
| 0 | 1 minute |
| negative | 1 minute |

## Other places that print a time left
- `closesIn` has one caller: `topic-mail.service.ts:731` (`closes_in`, template C01, HTML and text). Changed through the function.
- C02 (weekly topic) and C14 (launch mail): no time-left text and no `closes_in`. Not touched.
- Other text templates: only "a few minutes" (D04), "about two minutes" (H07) and `{{oldest_hours}}h` (G02, an admin mail with its own value). None use `closesIn`. Not touched.
- No template text, schema, migration or contract change.

## Existing assertions changed
None. No existing test pinned an hours-style output above 48 hours (`topic-mail.spec.ts` pins only "1 hour").

## What I ran
- `npm ci`, `prisma generate`, `tsc --noEmit`: clean.
- eslint (no fix) on the two files touched: clean.
- Fresh Postgres 16 and Redis, `jest --runInBand test/mail`: 15 files, 274 tests. First run: 272 passed, 2 failed. One failure was my own spec (the render needed `preferences_url` and `unsubscribe_url`); fixed. After that: `closes-in.spec.ts` 14 of 14 pass, including the rendered C01 mail showing "closes in 7 days" in HTML and text.
- The other failure is `topic-mail-round5.spec.ts`, "a dead address refused by C14 is not asked by C01 or C02" (`launchDone` expected true). It fails the same way on a clean checkout of main without my change (61 of 62 pass there), so it is not caused by this change. I did not touch it.

## Could not prove
- That round5 failure is a real bug or a slow-machine timing issue; not investigated.
- The live morning email itself (no live mail relay used).
- Commit trailers use the session's own attribution lines, not the Fable lines in the brief.
