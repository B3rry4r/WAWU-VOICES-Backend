VERDICT: FIX

# Check of V-SURVEYS round 6 (API)

Checked `origin/v/surveys` at 3d2b480, on branch `verify/surveys-6`. I changed no product code and no existing test. My attack specs, solver and word lists are not committed. Own PostgreSQL 16 (port 18532) and Redis, fresh databases. Floor means `weekly.min_group_size`; I used 5 and 20. The interim report (20:10 UTC) said FIX; this one keeps FIX, for the reasons under MEDIUM. No HIGH found.

## Round 5 findings, from my own runs

| Finding | State |
|---|---|
| H1 count readable under the floor | CLOSED |
| M1 totals fall together | CLOSED |
| M2 released numbers move after a purge | CLOSED, with one small leak (MEDIUM 3) |
| M2 old reports and the migration | CLOSED (backfill and rollback checked) |
| L1 scrub | PARTLY OPEN (MEDIUM 2) |
| L3 eslint | CLOSED: 0 errors, 52 warnings without `--fix` |
| L4 review list | CLOSED for 5,000; first page at 50,000 still 7 s (LOW 5) |

## Findings, most severe first

### HIGH
None found.

### MEDIUM

**1. The join with main breaks two existing specs (and one flaky one).** Local merge of `origin/main` (63aa77c) into 3d2b480: no conflicts (auto-merged files: `prisma/schema.prisma`, `src/mail/mail.service.ts`, `src/me/deletion.service.ts`, `docs/contract/openapi.yaml`, `docs/contract/src/schemas.py`). `npx tsc --noEmit` clean. Contract build: no diff. Both purge additions sit in `deletion.service.ts` (survey erase first, topic mail skip later), nothing lost. But the whole `npm test` on the merged tree, in band, fresh database: 170 suites (168 passed, 2 failed), 3,470 tests passed, 1 skipped, 3 failed:
- `test/admin/surveys-round2.spec.ts:198` "a relay that answers 429 is capped, not logged, and sends later": expects `"capped"`, gets `"failed"`. Main's new 429 handling in `mail.service.ts` (`classify429`, results `paused`, `refused`) answers differently for a 429 with no code. Fails alone too, every time.
- `test/admin/surveys-round2.spec.ts:235` "brand mail has its own daily limit": fails as a follow-on of the one above (0 mails counted).
- `test/admin/surveys.spec.ts:971` "once the survey is over...": the spec bans the text `0803` anywhere in the report; this time a random uuid in the report held `...c0803...`. Passes alone and passed on the branch run. A flaky spec, not a product fault (about one run in a few hundred).
The F04 retry (`mailResults` retries every outcome except sent and limited) still works, so mail is not lost; the two specs need new expected values from the lead's rule for a bare 429.
How to resolve: no file conflict; edit the two round 2 expectations to main's classification.

**2. The scrub newly lets contact shapes through** (compared with `origin/main`, 199 contact shapes of mine; 42 survive on the branch, 28 of them also survive on main):
- Newly kept, from the sentence-end rule (`scrub.ts:55-63`, the lead's ruling): `Chidi.Me`, `MyBrand.Me`, `mybrand.Me`, `Chidi.Shop`, `chidi.Shop`, `ChidiShop.Store`, `Chidi.Link`, `Chidi.Page`, `Mybrand.To`, `Mybrand.Africa`, `MyBrand.Info`, `find me on Chidi.Me`. Same shape as `Wait.Me I am coming`, so it cannot be told apart. Still removed: `mybrand.me`, `MYBRAND.ME`, `mybrand.me/x`, anything with a scheme, `www.` or a path.
- Newly kept, not covered by any ruling (`scrub.ts:177-188`): a plain 10-digit number that starts with 0, `0241234567` (a Ghana mobile) and `0803123456`. Main removed them. Eleven-digit Nigerian forms and `+234` forms still go.
- Survived before this round too (not new): `chidi_at_gmail_dot_com`, `chidi-at-gmail-dot-com`, `803 123 4567`, `07700 900123`, `8 0 3 1 2 3 4 5 6 7`, `eight oh three one two three four five six seven`, `one two three four five six seven eight nine zero`, Devanagari digit phones (`०८०३१२३४५६७`), `mybrand dot c o m`, `mybrand.c0m`, `mybrand.corn`, `mybrand%2Ecom`, `my_brand.com`, `localhost:3000`, `chidi at gmail dot c0m`, `chidi at gmail d0t com`, `chidi at gmail do t com`, `chidi at gmail dott com`, `@ chidi`, `u/chidi`, `r/chidi`, `#chidi`, `whatsapp chidi`, `add me chidi_o on telegram`, `WhatsApp me on this number`, `e-mail: chidi / gmail / com`.
- Strict "starts with 7, 8 or 9" rule, what it changes: 10 digits starting 1 to 6 stop being a phone. Today removed, then kept: `1234567890`, `2125551234`, `4155550123`, `5551234567`, `6502530000`, `1999999999`. That means US style numbers with area codes 2 to 6 would stay, and the spec `scrub-round5` that removes `1234567890` would fail. Nigerian numbers without the leading 0 start 7, 8 or 9, so they lose nothing. Amounts that start 7, 8, 9 are removed either way (`7000000000`).
- Sentences: round 5's 25: 23 stay, 2 change (`He is a dot com millionaire`, `Amaka at home dot com is a joke name`; same as main). My 304 (Nigerian English, Pidgin, prices, dates, amounts, 10-digit amounts): 2 change, both also on main: `Price don change.N95.50/kg now, no be last week.` and `Fine.N95.50/kg is okay by me.`. Main changed 22 of the same 304.

**3. A purge can move a released number when a transcript arrived after release.** `survey-erase.ts:38-58` reads the person's voice answer as it is at purge time, `dropFree` (`:80-100`) then removes one equal item. Steps: 13 people, floor 5; 7 voice items listed (two say `same voice`), person C's clip had no transcript at release; after release C's transcript `same voice` lands; purge C. Result: list 7 to 6, `answered` 7 to 6, and one `same voice` item (another person's) is gone, though C was never in the list. A released number moved by a purge of someone who was not counted. Fix: only take an item out when the person's answer was in the list at release (for example store the item count per person, or compare against a flag), or do nothing when the transcript was not ready at release.

### LOW

**4. Released report after purges shows less than the floor.** 14 released, floor 5, 10 purges: counts, Other and totals stay at 14 (as ruled), the written list shows 4 items with `answered: 4`, voice 4. After 1 purge the brand reading only the current report sees 13 items against 14 responses ("one response has no written answer"). Visible exactly: the 4 remaining texts, `answered: 4`, `totals.responses: 14`, frozen choice counts. It follows the 14 Nov ruling, but it is a group of 4 under a floor of 5 and a gap of 1. For the owner to say yes or no.

**5. Review list at 50,000 answers.** 50,000 people with a text and a voice answer (100,000 items): first page 7.1 s (builder said 1.6 s for 50,000 text answers only), later pages median 79 ms. Items, order, hiding the same as a from-the-database reference (below). At 5,000 people (10,000 items): first page 632 ms, next 28 ms median, heap 231 MB, rss 843 MB. The second half of my 50,000 spec (purge, hide, new transcript steps) did not finish in my time; those steps passed at 5,000.

**6. A purge matches by today's scrub.** If the scrub changes after a report is released, the stored text no longer equals the re-scrubbed text and the purged person's text stays. Proved by editing a stored report (`Thanks.Us too.` stored as `[removed] too.`): the item survived the purge. No real report can be in that state today (surveys are not on main), so this is a risk for the next scrub change.

**7. Deploy window.** A survey released by the old process after migration `20261114370000` has `releasedTotals` NULL; staff totals then come live and fall after a purge. Only during a rolling deploy.

## What held

1. **H1.** Real HTTP, a watcher without staff rights reading the brand page (body, size, status), the feed slot, the open check, a bad answer (error text), an event, timing: the observation does not change until the answer count equals max(target, floor). Old row target 1, floor 5: first change at 5 answers. Old row target 3, floor 20: at 20. Target equal to floor 5: at 5. Floor raised 5 to 12 after approval (target 5): at 12. Floor lowered 20 to 5 (target 20): at 20. Create, edit, approve with a target under the floor: 422. Edit of an approved survey: 409. 15 answers then 50 at once, target 20: exactly 5 got 201, 45 got 409 "This survey has closed.", 20 rows, snapshot taken. Brand page median 6 to 9 ms in every state.
2. **M2.** 14 released (text, voice, choice). Purges 1, then 3, then 10: report numbers byte for byte the released ones; staff detail and list `[views, starts, completes, skips, responses]` = 0,14,14,0,14 each time; only the purged people's items left (14, 13, 11, 4). `pg_dump` grep: no text, voice text or respondent key of the purged person anywhere; no user id or clip id in any Survey table. The user id, a REMOVED clip row and a FAILED transcript row of the purged do remain in `User` (DELETED tombstone), `AuditLog` (`account.purged`), `VoiceClip` and `Wallet`: the existing purge, not this branch. Same text twice, and the same text after the scrub (`call 08031234567 now` and `...568 now`): one purge removes exactly one item. A text hidden by staff and equal to another's: purging the hidden person leaves the other's. Voice with no transcript at purge, transcript created after: no change to report or review list. Races, 20 rounds each (purge with release; two purges with release; purge, hide and release): no trace of the purged in report or tables, no half state, 0 "deadlock detected" in the Postgres log. Purge before release gave totals 7, after 8 with 7 texts.
   Migration `20261114370000_released_totals`: on a database built from the previous migrations with three rows (released 6 responses, 7 starts, 6 views, 1 skip; released with an earlier purge, 5 responses but 6 COMPLETE events and 6 starts; one not released): backfill gave `{views 6, starts 7, skips 1, responses 6, completes 6}`, `{views 0, starts 6, skips 0, responses 5, completes 5}` (completes now equals responses, not the 6 events) and NULL. Rollback refuses while totals exist ("rollback refused"), and after they are cleared drops the column. Stamps: branch 190000, 240000, 260000, 370000; main has 210000, 250000, 270000, 330000 not on the branch; no shared stamp, no duplicate prefix in the merged tree.
3. **M1.** Running, 8 answers and 2 people who only started: staff `[responses, starts, completes]` 8,10,8; 1 purge 7,9,7; 3 purges 5,7,5. Review with 12: 12,14,12; 1 purge 11,13,11; 3 purges 9,11,9; 4 purges 8,10,8; stored snapshot totals fall the same. `starts` is null whenever `responses` is null.
4. **Small groups.** Solver over `buildReport`, floors 2 to 6, 2 to 4 choices, counts 0 to 2 x floor + 1 and 0 to 2 x floor + 1 unanswered: 1,007,944 datasets; 0 pinned hidden groups (exact or nonzero-small), 0 shown group or Other under the floor, 0 small unanswered remainders, 0 Other different from answered minus shown. (I did not test the solver against a deliberately weak rule, so its sensitivity is argued, not shown.) The released-report visibility after purges is LOW 4.
5. **Scrub speed.** My copies of the timing tests (`scrub-round4` 78 timings, `scrub-round5` 52), 30 separate runs: branch round 4 worst per run median 20.5 ms, max 40.8 ms; branch round 5 median 21.2 ms, max 77.2 ms while another loop ran (2 runs over 50 ms); branch round 5 again with nothing else running, 30 runs: median 19.4, max 27.7, none over 50; `origin/main` 33 runs: round 4 median 24.6, max 43.2; round 5 median 21.4, max 32.8. Inside the merged full suite: worst 45.6 ms (round 4) and 46.5 ms (round 5). The only slow one is the 200,000 character `1-` shape; on the branch's full run it failed once at over 50 ms (see Suites). Closer to the limit than main under load; alone it is fine.
6. **Review list.** Same items, order and hiding as a from-the-database reference (the round 5 way: question, scrubbed text, handle) for 0, 1, 49, 50, 51, 5,000 and 50,000 people (item counts 0, 1, 61, 62, 63, 10,000, 100,000), with 40 hidden. After hiding through the route, deleting 3 and then 2 answers, and a longer transcript, the next read was right on the live service and on a second service instance (a second cache; not a second OS process). A same-length edit of a transcript is not caught by the fingerprint (`surveys-results.service.ts:~192`); I did not prove it, and the worker writes a transcript once.

## What I ran

- Branch: `npm ci`, `prisma generate`, `tsc --noEmit` clean; eslint without `--fix` 0 errors, 52 warnings. `npm test`, jest in band, fresh database: 155 suites, 154 passed, 1 failed; 2,613 tests passed, 1 skipped, 1 failed. The failure: `scrub-round5` "200,000 characters of 1-: under 50 ms", while I was also running my own attack specs on the same machine; it passed 30 of 30 alone. Audio: 13 of 13.
- Merged tree (main 63aa77c): above, MEDIUM 1.
- Specs that leave data behind: every `test/admin/surveys*.spec.ts` starts with `bootAdmin` (truncates User, Category, Question) and none of the new survey specs creates a post. `test/admin/surveys.spec.ts` creates 3 live questions with `seedQuestion` and no answers; `hotfix1-block-oracle.spec.ts` passed on the branch and on the merged tree, so no new spec of this branch breaks it in this order. A run order that puts a survey spec right before it was not tried.

## What I could not prove

- Two real OS processes for the review list (two service instances only).
- The 50,000 run after the first page (purge, hide, transcript steps) did not finish; my slow reference query is the likely cause.
- The solver's sensitivity (see 4); differences between questions or between surveys.
- Brand reading as a brand (there is no brand sign-in): I read the stored released report through the staff route.
- A real clip file in storage.
