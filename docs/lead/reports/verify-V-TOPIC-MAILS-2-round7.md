VERDICT: MERGE
INTERIM

# V-TOPIC-MAILS-2 round 7: independent check (interim, about 30 minutes in)

Branch `v/topic-mails-2` head 13f35d3. Own Postgres 16 and Redis. The relay was always a local stand-in. No `.env` or key file opened. My attack specs are not committed. No product code or existing test changed.

This is a verdict so far, not the full check. Still running: flapping-relay runs, once-only with 50 parallel runs, 100,000 people, full suite totals, round 5 cases for 3 days. Nothing found yet that is HIGH.

## Round 6 findings, closed or open (my own runs)
- HIGH-1 (outage sets good people aside): CLOSED so far. Builder's round 7 spec passes here (9 of 9, 91 s). My own runs: 2,000 people at 19%, 15% and 10% random failure for a whole window: 2,000 of 2,000 mailed each, 0 set aside, 0 mailed twice, relay calls 2,459 / 2,341 / 2,226. 
- MEDIUM-1 (more than 30% truly dead addresses, brake fires every tick): OPEN, by the builder's own admission (needs a ruling). I have not re-run it; the code at `topic-mail.service.ts` ~line 985-1010 is unchanged from round 6.
- LOW-2 (start before migration): the code now catches a missing `TopicMailTrouble` table in `due()` (~line 410-430, one warning, mail goes). Not yet run by me against a database without the table (still to do).
- LOW-1 (slow relay): unchanged, fine.
- LOW-3 (tight time margin in `topic-mail-skip.spec.ts`): not yet seen in a run.

## Findings so far
### LOW-1 (new). A person who joins or turns the mail on after the day's run has finished gets nothing that window
`finished` (`topic-mail.service.ts:161`, `isFinished` ~790) marks the window done once everyone due was mailed. In my run, 50 people created after that point were never tried that window (0 relay calls) and were mailed the next day. This is the same as on main (`finished` exists on main), not new in this branch.
### Note. Last-30-minutes outage
200 people, 150 mailed, the other 50 unmailed at the end of the window; not set aside; day 2 mailed 200 of 200, nobody twice, the day-1 question is not mailed late. (Full numbers in the final report.)

## Migrations (item 7)
- Main (6eccda4, current `origin/main`) is fully inside the branch (`merge-base --is-ancestor` true), so the merged tree is the branch itself.
- Added: `20261114210000_mail_log_template_created`, `20261114250000_topic_mail_skip`, `20261114270000_topic_mail_skip_2`, `20261114330000_topic_mail_trouble`. Main's stamps: `...200000`, `...220000`, `...230000`, `...280000`, `...290000`, `...300000`, `...310000`, `...350000`. No equal stamp. Each of the four has `rollback.down.sql`.
- Ran: applied main's migrations only, then `prisma migrate deploy` with the four added after the newer stamps: all applied, none failed.
- `...270000` deletes all `TopicMailSkip` rows before dropping the address column (skip times only; as in round 5). The other three are additive.

## Gate
`npm ci`, `prisma generate`, `tsc --noEmit`: exit 0. eslint without `--fix`: 0 errors, 51 warnings. Full `npm test` still running (own database and Redis).
