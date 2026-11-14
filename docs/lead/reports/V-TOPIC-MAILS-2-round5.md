# V-TOPIC-MAILS-2 round 5 (H1, M4), joined onto main

Code head `6f11c46` on `v/topic-mails-2` (merge of origin/main into e81847d, plus the round 5 change). Local branch started behind (a6b4966); I fast-forwarded it to origin's e81847d first. Own PostgreSQL 16 (55610) and Redis (56610), relay always a local stand-in, no .env or key file opened.

## What counts as a refused address, and where I learned it
This repo records NO sample of a refused-address answer: nothing in `docs/`, no fake in `api/test/mail` (they answer `{error:"no"}`), and the client only ever read the status. So the rule is built on the clearest signal the client can see, in `relayNamesAddress` (`api/src/mail/mail.service.ts:92`, lists at :60-90):
- Status 400, 404, 410 or 422 AND a JSON body (read on the body, on `error` when an object, and on each entry of `errors`) where
  - `code`, `reason`, `error` or `type` (lower-cased) is one of: invalid_recipient, invalid_address, invalid_email, invalid_to, recipient_invalid, recipient_suppressed, address_suppressed, suppressed_recipient, suppressed, recipient_bounced, address_bounced, hard_bounce, bounced, mailbox_not_found, recipient_not_found; or
  - `field`, `param`, `path` or `target` is one of: to, recipient, email, address.
- EVERYTHING else is relay trouble: any 5xx, timeout, dropped connection, 429, 401, 403, 408, and any 4xx with no body, an unreadable body or a body that names no address (a bare 404 may be a wrong route). Unsure: the real relay's words. If it says "refused" differently, those people are treated as trouble (nobody wrongly skipped, a dead address is asked every run). Add its words to the two lists.

## The code that decides
- `mail.service.ts:557-565`: a 4xx of the four statuses is `refused` only when the body names the address, else `failed`. `MailJob.tellRefused` (set for every topic mail, so C14 too) lets `send` return `refused`; other mail still gets `failed`.
- `topic-mail.service.ts:707-731`: on `refused` the person gets a 24 hour row at once (`writeSkips`, reason `refused`), no counting. Ten named refusals in a row still end the run (ruling 2 of the check holds), each already on its 24 hours.
- `topic-mail.service.ts:279-345` (`due`, `SKIP_TEMPLATES` C01, C02, C14): a skip row of any of the three blocks all three while the address is the same; a corrected address is asked at once. A sent mail deletes the person's rows (`~:745`). `earnedLong`, the 1 hour rows and the "stop" rows are gone.
- Relay trouble: the existing rules stay (429 ends the run, five failures in a row stop it, the log row is given back). New: `FAILED_RETRY_MS` (5 min, `~:761`): a run where some mail failed is not marked finished, so those people are asked again soon. Before, they were left until a restart (found while testing; it was why "in turns" mailed only half).
- C14 waits are untouched (30 min after a 429, 10 after a stop, follow-ups every 10 min, give up after 6 empty ones). A refused person is not "left" for C14, so the follow-ups end.

## Before and after (verifier's shapes, C01, tick a minute)
| | Before | After |
|---|---|---|
| in turns | 150 of 200 mailed, 50 on 24 h | 200 mailed, 0 skipped |
| nine refused, one accepted | 38 of 200, 162 on 24 h | 200 mailed, 0 skipped |
| breaks twice in a window (505, C01 and C02) | 500 of 505, 5 on 24 h | 505 mailed, 0 skipped |
| M4 dead address on C02, 3 dead, 7 days | calls a day 6,48,51,51,51,51,51 | 3,3,3,3,3,3,3 (one each a day) |
Also tested: 15 kinds of relay trouble and 429 (nobody skipped, next run mails all 20), five named-address shapes, the 24 h at the first answer (1 call), success clears, one try a day across C01, C02 and C14 (both ways), C14 trouble keeps its 10 minute wait.

## Assertions changed (old, new), all because the rule changed
- Fixtures: the stand-in answers `{code:"invalid_recipient"}` for a bad person (422, and `all` excepted); round4 names the address only on 422. So the "404/410/400 means refused" tests use 422.
- round4 S2 (404 after 100): 110 calls, ticks of 10, 79 stopped, 800 calls, `again` 0, fixed in 42 min, 1315 calls TO 105, 5, 119, 595, no skip rows at all, mailed at the first tick after the fix (0 min), 405 calls.
- round4 S3: mailed 150/38/200 and again 50/162/0 TO mailed 200, again 0, skip rows 0 (all three).
- round4: reason `first` TO `refused` (2 tests), "stop" TO `refused` and 410/404 TO 422 (ruling 2 tests), `[2,2,2]` calls TO `[1,1,1]`, `again` 3 TO `refused` 3; runInfo `c01.onSkip` 0 TO 10 (a person skipped for C02 is skipped for C01, counted for both).
- skip spec: reason `stop` TO `refused` (3); 12 bad day one: 54 calls and 4 stopped TO 12 and 0; "404 to everyone": 10 calls a tick, 60 skip rows, hour wait TO 5 calls, 0 skip rows, all 60 mailed on the next tick; N2: 8 asks and 1 skip TO 5 asks, 0 skips; "mail logged lately": `first` TO `refused`, 24 h; the 24 h retry uses an aged row and a new service object.
- relay-trouble: 404 for everyone: `skips` 10 TO 0, and the 20-people-an-hour-later branch removed. budget2: "skipped for the template, still mailed C01" TO "skipped for every topic mail" (mailed N-1, not asked again).
- Migrations: none added (the table and columns stay; only the comment on `reason` changed in schema.prisma).

## Conflicts
`topic-mail.service.ts` only (3 hunks): the skip fields and C14 fields kept together; `due` now takes `now` and `createdBefore` and returns `{people, skipEnd}` (`launchLeft` reads `.people.length`); the `budget` object keeps C02's `ownMax` and main's `budgeted` switch. `mail.service.ts`, `deletion.service.ts`, `schema.prisma`, openapi merged clean.

## Commands
- `npx tsc --noEmit`: 0 errors. eslint on the two services and `test/mail/topic-mail*.spec.ts`: 0 errors, 0 warnings.
- `npx jest test/mail` x3: 12 suites, 231 tests, 3 of 3 passed.
- Full `jest --runInBand` on a fresh database: 127 suites passed; 1517 passed, 1 skipped, 1518 total. (Audio node tests not run.)
- Migrations: DB migrated with origin/main's own migrations, then `migrate deploy` applied this piece's two cleanly; `migrate status` up to date; `migrate diff` is the same 24 lines as on main's own schema (nothing of ours).
- Contract: `build.py` then `cmp` identical (no change needed).

## Not done or unsure
Real relay answers (above); a real timeout (tested through a mocked aborted fetch, not a 10 s wait); real processes and timer; audio tests. A dead address now costs one call a day per person for as long as it stays dead.
