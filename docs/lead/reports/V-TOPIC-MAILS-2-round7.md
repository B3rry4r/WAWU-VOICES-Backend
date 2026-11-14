# V-TOPIC-MAILS-2 round 7

Branch `v/topic-mails-2`. HEAD: see the last commit on the branch (the final commit has no `[skip ci]`).
The local branch was at a6b4966 and origin/v/topic-mails-2 was too; d73d730 (round 6) was only reachable from the check's branch, so I fast-forwarded to it first, then merged origin/main (6eccda4).

## The rule as built (`api/src/mail/topic-mail.service.ts`)
- `relayLooksUp`, `note`, the `recent` list and the 30-minute window are gone.
- Constants (line 79 on): `TROUBLES_ASIDE = 3`, `OTHERS_MIN = 5`, `OTHERS_FAIL_SHARE = 0.2`.
- `winState` (line 577): per template and window, running totals of sends tried and sends that hit trouble, kept in memory, plus for each person who had trouble the totals at their last attempt. Ids only, no address, no hash.
- `noteTrouble` (line 594): a trouble counts only if, since the person's previous attempt in the window (or the window start), at least 5 sends to others were tried and fewer than 20% of them hit trouble. The row in `TopicMailTrouble` is written every time (it puts the person in the "after everyone else" group). Only counted troubles raise `troubles`; at 3 the person is set aside (`asideAt`) for the window.
- `due()` (line 420): any trouble row puts the person last (round 6 order); a person with a row in this window gets one call per try (`attempts: 1`, line 917). The cursor and five-in-a-row stop are as in round 6. Sent and refused sends add to the totals (line 984).
- Daily cap, once-only (`MailLog` unique key) and "no address kept" are untouched. The cursor and trouble rows never decide "already mailed".
- Restart: counted troubles survive (database); the totals and snapshots restart at zero, which can only make fewer troubles count. Two servers each count their own sends, same direction.

## Numbers (`api/test/mail/topic-mail-round7.spec.ts`, a tick a minute, relay is a local stand-in)
| Case | Mailed | Set aside | Relay calls |
|---|---|---|---|
| 200, relay fine for 149 sends, then 500 for 20 ticks, then fine 40 ticks | 200/200 | 0 | 402 |
| 2,100, down 60 ticks after 2,000 mailed, then 30 ticks up | 2,100/2,100 | 0 | 2,600 |
| 200, half the requests failing (seeded) for 60 ticks, then fine | 200/200 | 0 | 359 |
| 2,000, 10% failing (seeded) all window | 2,000/2,000 | 0 | 2,229 |
| 200, down from the first send for 20 ticks, then fine | 200/200 | 0 | 500 |
| Two servers on each tick, both replaced at tick 25, 7 always-500 of 200 | 193/193 good, nobody twice | 0 | 784 |

Round 5 cases, three consecutive days each (60 ticks a day), every good person mailed once each day:
- 5 always-500 first of 200: each failing address got 62 relay calls a day (310 in all), set aside 0.
- 5 always-500 in the middle: the same, 62 each, 310 in all, set aside 0.
- every 7th of 210 (30 addresses): 12 calls each a day (360 in all), set aside 0.

## Said plainly
- A dead address is not set aside by this rule when the only people left are other dead addresses. Between its tries the "others" it can see are the other dead ones, so the relay looks unwell and its trouble is not counted. It costs one try a tick (the first try has 3 calls, later ones 1): 62 calls a day for 5 dead addresses alone at the end of the list. It never blocks a good person. If the lead wants these capped at 3 counted calls a day even then, that is a rule change (for example, count a trouble when the relay mailed anybody at all since the person's last try); I did not make it.
- 10% random failures: 0 set aside here. A person needs three counted troubles on three attempts; the first attempt has 3 calls, so the expected number is about 0.

## From the check report
Last read: the FULL report (check branch head 34e7eae), after the interim one (4d8e451).
- HIGH-1: fixed as above.
- LOW-2 (app starts before the trouble table exists): fixed. `due()` now treats a missing table as "nobody has trouble" and logs one warning; the mail still goes. Deploy order is still: migrate, then start.
- MEDIUM-1 (more than 30% truly dead addresses: the refusal brake fires every tick, about 1,900 calls and 2,100 warning lines a day for 40 dead of 100): NOT fixed. The fix changes the round 6 brake rule (what the relay's named refusals mean), which is a ruling, not mine to make. Good people are all mailed; it is cost and log noise. Real life (1 to 5% dead) is not affected. Needs a ruling.
- LOW-1 (slow relay, one long tick): noted by the check as fine; no change.

## Migrations
None. `TopicMailTrouble` is as it was. A row with `troubles = 0` now exists for an uncounted trouble.

## Tests
New: `topic-mail-round7.spec.ts` (9 tests, all pass). Rewritten: three round 5 cases in `topic-mail-round6.spec.ts` (the branch's own tests, which pinned "2 sends a day" and "set aside = every failing person"); they now say at most one try a tick and set aside at most the failing people. No test from origin/main was changed. All the other topic mail specs pass (194 of 197 before the rewrite, the 3 being the rewritten ones). Full suite: see the last line.

## Not proved
- Live relay behaviour (the relay is always a stand-in).
- Totals are per server; with several servers each sees fewer sends, so fewer troubles count. This errs toward not setting anyone aside.
