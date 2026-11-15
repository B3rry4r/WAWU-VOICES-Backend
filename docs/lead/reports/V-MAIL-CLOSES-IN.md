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

## The launchLeft clock

Cause: `runLaunchOpen` is given its own `now`, but `launchLeft` asked the audience question with `new Date()`, the real clock. `topic-mail-round5.spec.ts` runs on the fixed day 15 Nov 2026 with a skip that ended 07:10Z. Once the real clock passed that, the skipped person counted as due again, so `launchDone` stayed false. In production the run's `now` and the real clock are the same moment, so nothing a person sees changes.

Lines changed, all in `api/src/mail/topic-mail.service.ts`:
- `runLaunchOpen`: `began` and `clock()` added after `eventKey` (about line 1131), like `sendAllInner`.
- Both `launchLeft` calls (about 1155 and 1174) now pass `clock()`.
- `launchLeft` (about 1181) takes `now` and passes it to `due` instead of `new Date()`.
The spec is unchanged.

Before the fix, round5 failed alone on the real clock: `topic-mail-round5.spec.ts:523`, `expect(launchDone).toBe(true)`, received false (1 of 62 failed). After: 62 of 62 pass.

Other clock reads (`topic-mail.service.ts`, `mail.service.ts`): none is the same fault.
- topic-mail 321 and 329 (`usedBy`, `usedToday`): fine, they count MailLog rows made in real time against the real UTC day, the relay's own budget day.
- topic-mail 800 and 883 (`looked`, `scanned`): fine, compared with real update times of addresses.
- topic-mail 825 (`lastRun.at`): fine, a display stamp.
- topic-mail 866 (`began`, `clock`): the correct pattern.
- mail.service 148 (`classify429` default), 479 and 515 (`brandCapUntil`): fine, real relay time.
- mail.service 611, 619 and 637 (budget and window counts): fine, against MailLog rows created in real time.
- mail-events 155, 285, 925: fine, a date printed in the mail.

Totals, every `test/mail/*.spec.ts`, `--runInBand`, fresh Postgres 16 and Redis:
| Clock | Files | Tests |
|---|---|---|
| Real, 15 Nov 2026 | 15 of 15 pass | 274 of 274 pass |
| Shifted to 2026-11-16 08:00 UTC | 15 of 15 | 274 of 274 |
| Shifted to 2026-11-17 09:00 UTC | 15 of 15 | 274 of 274 |
| Shifted to 2026-12-01 12:00 UTC | 15 of 15 | 274 of 274 |

Also: `tsc --noEmit` clean, eslint (no fix) clean, `closes-in.spec.ts` 14 of 14.

How the clock was shifted: `faketime` was not installed, so I used a small preload file (`node --require`, kept out of the repo) that moves JS `Date` forward. The database clock was NOT shifted, so `now()` in Postgres stayed real. The specs pass their own times for the checks that matter, and all dates passed, but a later date is not proven against a database that agrees.

Could not prove: runs with the database clock moved too; any date outside the three tried. An earlier overlap of two runs on one database was stopped and the affected dates re-run alone.
