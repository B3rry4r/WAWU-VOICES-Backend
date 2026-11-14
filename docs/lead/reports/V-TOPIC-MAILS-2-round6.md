# V-TOPIC-MAILS-2 round 6

Branch `v/topic-mails-2`. Head: the commit that carries this report (see `git log -1`). Joined `origin/main` 21fa85a first (clean merge, 351f63c).
The checked-out branch was behind the stated head 39935f9; I moved it forward to 39935f9 (a fast-forward) before the merge.
The relay was always a local stand-in. No `.env` or key file opened. No address is stored anywhere new.

## HIGH-1: people the relay keeps failing (commit fe12871)
Design, `api/src/mail/topic-mail.service.ts`:
- Set aside after two troubles: `noteTrouble` (about line 584), table `TopicMailTrouble` (user id, template, window, count, time; no address, no hash). Window = Lagos day for C01, `week:N` for C02. `due()` (line 327) leaves out people set aside in this window.
- Order: `orderOf` (line 141): no earlier-window trouble first, then never mailed first, then id. A person with a trouble row from an earlier window is in the last group. A sent mail removes their rows.
- Stop without starving: a cursor per window (`this.cursor`, in memory, set after each person tried, line 916). The next run starts after that person, goes to the end, then round. Reset when a run goes through everybody.
- Cost: a person who already had trouble in this window gets one try, not three (`attempts: 1`, `mail.service.ts`). Set aside costs 2 sends, at most 4 relay requests (3 + 1) per window. Not 2 requests: the first send keeps its 3 tries.
- Relay-wide failure versus one person (`relayLooksUp`, line 566): the first trouble of a person in a window always counts as 1. A second counts only if, in the last 30 minutes of the run clock, the relay took at least one mail and fewer than 40% of the sends failed. Down or flaky for everybody: nobody reaches 2. Different from the lead's example ("a send succeeded since this person's last trouble"): that rule failed for the people left at the end after all others were mailed (day 2 and 3 of the "5 first" case), and the failure share also keeps a relay that fails every other call from setting people aside.
- C14 is unchanged (no trouble table, no cursor).

Numbers, each case three days, a tick a minute for an hour (`test/mail/topic-mail-round6.spec.ts`):
| case | mailed good, each day 1/2/3 | requests to a failing person per day | set aside per day |
|---|---|---|---|
| 5 always-500 first of 200 | 195/195 each day, once each | 4 at most (total 20) | 5 |
| 5 in the middle of 200 | 195/195 each day | 4 at most (total 20) | 5 |
| every 7th of 210 (30) | 180/180 each day | 4 at most (total 120) | 30 |
| relay down 20 min, nobody mailed before | 200/200 once each | 500 requests in all | 0 |
| relay down 20 min after 50 mailed | 200/200 once each | 515 in all | 0 |
Before: 5 first of 200 mailed 0 of 195; every 7th gave 180, 0, 0 (the check's numbers). Also tested: on day 2 the failing people are tried after all the good ones; a run stopped by five failures is followed by a run that starts at the sixth person.

## MEDIUM-1 (commit 18675f9)
- Wait after a named refusal: 1 hour, 6 hours, 24 hours, 7 days, stays at 7 days (`REFUSED_WAITS_MS`, `writeRefusal` line 455). Counted per address (hash) over C01, C02 and C14. A sent mail clears it. New column `TopicMailSkip.strikes`; skip rows are kept 30 days after their time so the count survives. Ladder tested: 1h, 6h, 24h, 168h, 168h, 168h; nobody asked inside a wait.
- Brake (`REFUSAL_BRAKE_MIN` 10, share 30%): counted over the Lagos day for that mail (this run and earlier runs of the day), so the dead addresses left at the end are not taken for a wrong relay. At the brake this run's skips are restored or removed (`rollbackRefusals`), the braked answers leave the day's count, one warning, run stops, next tick tries again.
- 600 people, everybody refused for an hour, then fine: 600 of 600 mailed, 600 requests during the hour (10 a tick), 0 skip rows ever, 1,200 requests in all.
- One real dead address among 30, 3 days, 5 hours a day: day 1 two requests (one at once, none for the first hour, one after), day 2 one, day 3 one; then none for 7 days.
- Cost I could not remove: dead addresses are "never mailed" so they sort first; the first 10 of them at a start of a day are braked once (10 calls, rolled back) and asked again at the end of the round (skip spec: 22 calls on day 2 for 12 dead people, not 12). Also a population with more than 30% truly dead addresses is braked every tick and nobody waits.

## MEDIUM-2 (commit 18675f9; `classify429` in `mail.service.ts`)
- The relay's own daily or monthly codes (`daily_cap`, `daily_limit`, `daily_quota`, `provider_daily_quota`, `provider_monthly_quota`, `monthly_cap`, `monthly_quota`) end the Lagos day, as before. Any other 429 (Retry-After, a rate-limit code, or no reason) is a pause: Retry-After if given (1 s to 30 min), else 2 minutes; at most 5 pauses per window, the 6th ends the day. The refused call's log row is given back. C14 keeps its old 429 behaviour (capped, 30 minutes). Other mail (not topic mail) keeps "capped".
- 429 after the 101st mail, fine ten minutes later: 300 of 300 mailed once, with a bare 429 (4 limited requests), with Retry-After 600 (1), with code rate_limited (4). Daily code: 100 mailed, 101 requests, day over. Rate limit all hour: 6 requests, then capped.

## LOW-1: `verifyUnsubscribe` takes one key or a list; the controller uses `unsubscribeKeys()` (secret when set, and the service key). New links are signed with the secret when set. Tested: a link made before the secret was set turns the switch off after it is set; a link with another key gives 400.
## LOW-3: refusals in a row in the steady state log at debug, not error; the admin run shows `done` (with the refused and on-skip counts) instead of `stopped`; the brake logs one warning. LOW-2 and the rest of LOW-3 (the crash loss of one mail, the table needing migration first, the address hash) left as they are; LOW-2 (C14) is as the check described.

## Migration
`20261114330000_topic_mail_trouble`: new table `TopicMailTrouble`, new column `TopicMailSkip.strikes` (NOT NULL DEFAULT 1). Additive; `rollback.down.sql` drops both. Tried on a database with all migrations and 2,000 skip and trouble rows: rollback kept the 2,000 skip rows, deploy applied it again. (`migrate diff` shows one older drift, a VoiceClip index rename, not from this branch.) Contract unchanged (no route changed).

## Tests
- Full `npm test` jest on a fresh database I started: 151 suites, 150 passed, 1 failed; 2,568 passed, 1 skipped, 1 failed. The failure: `test/vote/vote.spec.ts` "serves a guest the live counts, cached in Redis" (Redis key missing); I did not touch `src/vote` (no diff from main) and did not run it on a clean main, so I cannot say it fails there too. Audio node tests: not run separately by me.
- Lint: no errors on `src/mail` and `test/mail` (2 old warnings). `tsc --noEmit` clean.
- Branch-own specs changed to the rulings (round 2, 3, 4, 5 and budget2 specs): the 24 hour waits are 1 hour then 6 hours; ten in a row at the start is the brake; the quiet stop; a bare 429 is a pause; trouble rows cleared in each `beforeEach`. No test from `origin/main` was changed; the C14 specs pass.

## Not proved
- The real relay's words for a rate limit and a daily cap (the list is a guess); whether it honours Retry-After.
- A relay that fails for everybody right after a long run of successes, with only a few people left, can set those few aside for the day (they come back next window).
- The cursor and the 30-minute relay record are in memory per server; with two servers each keeps its own.
