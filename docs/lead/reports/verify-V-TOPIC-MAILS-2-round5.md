VERDICT: FIX
INTERIM

# V-TOPIC-MAILS-2 round 5 check: interim (a HIGH found; the full report follows)

Branch `v/topic-mails-2` head 39935f9, checked on my own Postgres 16 and Redis, relay always a local stand-in, no `.env` or key file opened. Specs written by me, not committed.

## HIGH-1. Five addresses the relay always answers with a 5xx block every later daily mail, for everybody

What happens: a person whose mail fails with a 5xx, a reset or a timeout is never skipped (that is the round 5 rule: only a named address is skipped). Such a person is never mailed, so they have no earlier mail and are sorted FIRST in every later run (`due()`, `topic-mail.service.ts:~372-381`, order is "never mailed first, then by id"). Five of them in a row end the run (`MAX_CONSECUTIVE_FAILURES = 5`, `:42`, stop at `:735`), and the next tick starts at the same five again. Nobody behind them is ever reached.

Numbers (C01, a tick every minute, relay answers 500 for the named addresses and 200 for the rest):
- 4 such addresses first among 200: all 196 good people mailed.
- 5 such addresses first among 200: **0 of 195 mailed after 1 hour**, 1,800 relay calls (30 a minute with C02 also due). Same with 6, with connection reset, with 503.
- 5 such addresses in the middle (ids 100-104) of 200: 100 mailed, **the 95 behind them never**, 1,900 calls.
- **Scattered: every 7th person of 210 (30 addresses) answers 500.** Day 1: 180 of 180 good people mailed (the 30 are mixed in by id, no five in a row). Day 2: **0 of 180**. Day 3: **0 of 180**. From the second day the 30 are all "never mailed", so they sit together at the front.

So any five people in the audience whose address the relay keeps failing (5xx) stop the daily question mail and the weekly topic mail for everybody from the second day, until someone fixes or removes those addresses. It is the same on `main` (not new in this branch), but the round 5 rule that sends 5xx to "trouble" and never to a skip is what leaves it open, and the brief says relay trouble must never cost good people the day's mail.

Steps: Postgres + a relay stand-in that answers 500 for `zzaddr0000@verify.test` ... every 7th address; 210 users with mail addresses; one question per day; call `TopicMailService.runDailyQuestion(at)` every minute from 06:00Z for 60 minutes on three consecutive days (spec `zz-verify-f.spec.ts` F5, kept local).

Not yet checked at this point: items 3 (partly), 4, 6, 7, 8 are in the full report that replaces this file.
