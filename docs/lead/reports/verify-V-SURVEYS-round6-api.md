VERDICT: FIX
INTERIM

# Check of V-SURVEYS round 6 (API), interim

Checked `origin/v/surveys` at 3d2b480, on branch `verify/surveys-6`. I changed no product code and no existing test. My attack specs, solver and word lists are not committed. Own PostgreSQL 16 (port 18532) and Redis, fresh databases. Floor means `weekly.min_group_size`. Written about 20:20 UTC, 14 Nov; the full report follows.

## Round 5 findings, from my own runs so far

| Finding | State | Evidence |
|---|---|---|
| H1 (count readable under the floor) | CLOSED | Real HTTP, a watcher with no staff rights reading the brand page, the feed slot, the open check, a bad answer (error text), an event: nothing changes until the answer count equals max(target, floor). Old row target 1 with floor 5: first change at 5 answers. Old row target 3 with floor 20: at 20. Target equal to floor 5: at 5. Floor raised 5 to 12 after approval: at 12. Floor lowered 20 to 5, target 20: at 20. Edit of a live survey: target 2 and 4 with floor 5 give 422, target 5 gives 409 (no edit of an approved survey). 15 answers then 50 at once, target 20: exactly 5 got 201, 45 got 409 "This survey has closed.", 20 rows, snapshot taken. Brand page median 6 to 9 ms in every state. |
| M1 (totals fall together) | CLOSED | Running: 8 answers, 2 people who only started: staff detail and list `[responses, starts, completes]` = 8,10,8; after 1 purge 7,9,7; after 3 purges 5,7,5. Review (12 answers): 12,14,12; after 1 purge 11,13,11; 3 purges 9,11,9; 4 purges 8,10,8. The stored snapshot totals fall with them (responses 11, 9, 8). `starts` is null whenever `responses` is null. |
| M2 (frozen numbers after release) | CLOSED in every case I ran | See "What held". One condition, see MEDIUM 2. |
| L1 (scrub) | PARTLY OPEN | The 21 sentences and the 2 plain numbers are fixed. New things let through: see MEDIUM 1. |
| L3 (eslint) | CLOSED | eslint without `--fix`: 0 errors, 52 warnings. |
| L4 (review list) | not yet measured | in the full report |

## Findings so far, most severe first

### HIGH
None found yet.

### MEDIUM

**1. The scrub now lets through contact shapes it removed on `origin/main`.** 199 contact shapes of mine (emails, links, phones, handles, look-alikes): 42 survive on the branch, 28 of them also survived on main. Newly through (removed by `origin/main`, kept by the branch):
- A capitalised ending right after a full stop with no space (the lead's sentence-end ruling): `Chidi.Me`, `MyBrand.Me`, `mybrand.Me`, `Chidi.Shop`, `chidi.Shop`, `ChidiShop.Store`, `Chidi.Link`, `Chidi.Page`, `Mybrand.To`, `Mybrand.Africa`, `MyBrand.Info`, and `find me on Chidi.Me`. A person can write a handle or shop link this way and it goes through. This is the price of the ruling: `Wait.Me I am coming` and `chidi.Me` have the same shape. Lowercase `mybrand.me`, `MYBRAND.ME`, `mybrand.me/x`, any link with a scheme, `www.` or a path are still removed.
- A plain 10-digit number that starts with 0: `0241234567` (a Ghana mobile) and `0803123456` are kept; main removed them. Eleven-digit Nigerian forms (`07031234567`, `08031234567`) and `+234` forms are still removed. This one is not covered by any ruling.
- Strict "starts with 7, 8 or 9" rule, answered: 10 digits starting 1 to 6 would stop being a phone. Today the branch removes `1234567890`, `2125551234`, `4155550123`, `5551234567`, `6502530000`, `1999999999`. Under the strict rule all of those (US style numbers with area codes 2 to 6) would stay, and the existing `scrub-round5` spec that removes `1234567890` would fail. Nigerian mobile numbers without the leading 0 start 7, 8 or 9, so Nigerian numbers lose nothing.

### LOW

**2. After purges a released report can show fewer than the floor of written answers, and a gap under the floor.** Released 14 answers (floor 5), 10 purges: choice counts and totals stay at 14 (as ruled), the written list shows 4 items and says `answered: 4`. After 1 purge it shows 13 items against 14 responses, so a brand reading only the current report sees "one response has no written answer". This follows the 14 Nov ruling ("numbers stay, only the written or voice answer goes") but it is a group of 4 under a floor of 5 and a gap of 1 under the floor. For the owner to say yes or no; I did not treat it as a fault.

**3. A purge matches the person's text by re-scrubbing it with today's scrub.** If the scrub rules change after a report is released, the stored text no longer equals the re-scrubbed text and the purged person's text stays in the report. I proved it by editing a stored report to the older output of a sentence the round 6 scrub changed (`Thanks.Us too.` stored as `[removed] too.`): after the purge the item was still there. Real reports cannot be in that state today (surveys are not on `main`, nothing released), so this is a risk for the next scrub change, not a present fault.

## What held (so far)

- Purge, 14 released answers (text, voice, choice), purges 1, then 3, then 10 in total: every number in the report (counts, Other, states, age bands, totals) byte for byte the released one; staff detail and list `[views, starts, completes, skips, responses]` = 0,14,14,0,14 each time; only the purged people's written and voice items left (14 to 13 to 11 to 4); `pg_dump` grep: no text, voice text, respondent key of the purged in the whole dump; no user id or clip id in any Survey table. The user id, the removed clip row and a failed transcript row of the purged person do remain in `User` (DELETED tombstone), `AuditLog` (`account.purged`), `VoiceClip` (REMOVED) and `Wallet`: that is the existing purge, not this branch.
- Two people with the same text, and the same text after the scrub (`call 08031234567 now` and `...568 now`): one purged, exactly one item goes.
- A text hidden by staff before release, equal to another person's shown text: purging the hidden person leaves the other's item.
- Voice answer with no transcript at purge: nothing appears afterwards; a transcript created after the purge changes neither the report nor the review list.
- Races, 20 rounds each (purge and release at once; two purges and a release; a purge, a hide and a release): 0 traces of the purged person in the stored report or tables, no half state, no deadlock in the Postgres log.
- Small groups, solver over `buildReport`: floors 2 to 6, 2 to 4 choices, 1,007,944 datasets; 0 pinned hidden groups, 0 shown group or Other under the floor, 0 small unanswered remainders, 0 Other that differs from answered minus shown.
- Scrub: round 5's 25 sentences: 23 stay, 2 change (`He is a dot com millionaire`, `Amaka at home dot com is a joke name`; unchanged from main). 304 sentences of my own (Nigerian English, Pidgin, prices, dates, amounts): 2 change, both on main too: `Price don change.N95.50/kg now, no be last week.` and `Fine.N95.50/kg is okay by me.`. Main changed 22 of the same 304.
- Gate: `npm ci`, `prisma generate`, `tsc --noEmit` clean; eslint without `--fix` 0 errors, 52 warnings.

## Still running
Whole `npm test` on the branch; the merge with `63aa77c`; the timing runs; the review list at 50,000; the migration backfill and rollback; the stamp list.
