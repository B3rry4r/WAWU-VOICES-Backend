VERDICT: FIX

# Check of V-SURVEYS round 5 (API)

Checked `origin/v/surveys` at d4d1bb9, on branch `verify/surveys-5`. I changed no product code and no existing test. My attack specs, solvers and sentence lists are not committed. Own PostgreSQL 16 (port 18532) and Redis, fresh databases. Floor means `weekly.min_group_size`; I used 5 and 20.

## Findings, most severe first

### HIGH

**H1. The number of answers, under the floor, is shown to anyone at the moment a response target is reached.**
- `responseTarget` may be 1 or more (`api/src/surveys/dto.ts:117`). Nothing ties it to the floor.
- `isLive()` (`api/src/surveys/surveys-admin.service.ts:72`) switches a survey off when `responses >= responseTarget`. The public brand page `GET /brands/:slug` (no sign-in, `brands.service.ts:249`) and the feed slot `GET /surveys/placement` (`surveys-public.service.ts:181`) both drop the survey at that moment.
- Steps and numbers (my spec, real API): floor 20, survey with target 3, brand tied to it. Before any answer: brand page lists 1 survey, feed offers it. After answer 1: same. After answer 2: same. After answer 3: brand page lists 0, feed offers none, staff report stage goes to REVIEW. A person with no account who reads the brand page every few seconds learns that exactly 3 people have answered, and when the third did. 3 is under the floor of 20.
- Same code was in round 4; it was not found then.
- Fix: refuse a target below the floor when a survey is created, edited or approved (and treat an old one as invalid when the floor is raised), or keep the survey on the brand page and in the feed until results are released.

### MEDIUM

**M1. After a purge the staff totals no longer fall together: `responses` drops by one, `starts` and `completes` do not.**
- Code: `api/src/surveys/survey-erase.ts` deletes the response; `deletion.service.ts:312` only sets `userId` to null on the events, and COMPLETE events carry no person, so none of them goes. Staff read `completes`, `starts`, `responses` at `surveys-admin.service.ts:243` (detail and list).
- Numbers (API, floor 5): survey with 6 answers, released. Staff detail `[responses, starts, completes]` = `[6, 6, 6]`. After one purge: `[5, 6, 6]`. 7 answers, three purges one after the other: `[4, 7, 7]`. Release of 51, one purge: `[50, 51, 51]`. So `completes - responses` is exactly the number of purged people, a difference of one that singles out the purge. The brand report shows it too: `totals.starts` and `completionRate` become null after one purge (the gap rule hides them); below the floor, `starts` stays visible while `responses` is null (starts 5, responses hidden after a purge from 5).
- Not an identity leak by itself. It breaks "totals drop together".
- Fix: when a person with an answer is purged, delete their START rows for that survey and one COMPLETE row of that survey in the same transaction (or serve `completes` as the response count).

**M2. A brand that kept the report released before a purge can read the purged person's answers from the difference.**
- This is the rebuild itself (`survey-erase.ts`, `releasedReport` replaced). Nothing after the purge shows the person; the difference between the two copies does.
- Numbers (API, floor 5): 51 answers, released: Rice 45, Other 6, Oyo 25, Lagos 26, text list 51. One person purged. New copy: Rice 44, Oyo 24, text list 50. Old minus new: that person chose Rice, shared Oyo, and the one text missing from the list is theirs. With 24 answers, 12 Lagos and 12 Oyo before, 12 and 11 after: the state of the purged person.
- Group of exactly 5 and of 6: the brand's old copy shows 5 or 6 texts; after the purge from 5 the report shows nothing (4 is under the floor), from 6 it shows 5 texts and the missing one is theirs. The new report passes the floor everywhere (checked: purge from 5, from 6, two purges in a row 7 to 6 to 5 to 4, no shown group under the floor, hidden total always the whole minus the shown).
- The builder named this ("could not prove"). It follows from rebuilding counts. Choice is the lead's and the owner's: keep counts frozen and only strip the free answers, or accept it.

### LOW

**L1. The scrub takes words out of ordinary sentences (300+ sentences, my own list).**
392 sentences (272 by hand, 120 from templates: prices, dates, times, "dot", "at", studio and shop names, Nigerian English and Pidgin). 25 changed. Every one is listed here.
- No space after a full stop and the next word is a web ending (21): `I love it.Me too o.` becomes `I love [removed] too o.`; `Thanks.Us too.`; `The food was great.Live music too.`; `We did it.Top class service.`; `See the shop.Page after page of goods.`; `Buy it.Online is cheaper.`; `That is nice.Pro tip, bring cash.`; `Take it.Link me when you reach.`; `It is hot.Co-workers sweat too.` (leaves `-workers`); `Oga.Me I no go.`; `Sorry.Us na friends.`; `Wait.Me I am coming.`; `I dey.Me too.`; `Money.Me no get.`; `Love.Us dey together.`; `Yes.To you too.`; `Done.Net is bad now.`; `Fine.Top of the morning.`; `Jollof.Live and let live.`; `Pay now.Pro rata for the rest.`; `He said yes.To be honest I doubt it.`. Cause: `ENDING_LINK` (`scrub.ts:47`) takes `word.ending` with no space for me, us, to, net, top, live, page, online, pro, link, co.
- A plain 10-digit amount or number (2): `The budget is 1000000000 naira` loses the number; `Account type is 0123456789 savings?` too (`PHONE_SINGLE`, `scrub.ts:149`).
- Spoken "dot com" (2): `He is a dot com millionaire` and `Amaka at home dot com is a joke name` lose words.
- Clean (no change): all 120 template sentences, all prices (`N1,200.50`, `N617.50/litre`, `USD1.50/kg`), dates, times, `Studio 54`, `Glow Studio`, `Dinner at home. Studio later`, `handle with care`, `at the dot of noon`.
- Round 5 new cases all hold: `call 08O3I234567 now`, `c h i d i @ g m a i l . c o m`, `chidi dot okafor at gmail dot com`, `visit mybrand.studio`, `mybrand dot studio`, `t . me / chidi` become `[removed]`; the 9 named unchanged cases are unchanged. Also removed in my tries: `oh eight oh three, one two three, four five six seven` (the lead said commas are left alone; they were not here), `O8O3I234567`, `08O3 123 4567`. Left: `@ chidi_o` (space after the at sign), `c.h.i.d.i at gmail dot com` leaves `c.`.
- Speed: 200,000 characters of `1-` takes 10.6 ms (round 5) against 12.5 ms (clean main). 18 other worst-case shapes at 5,000 characters: under 14 ms each.

**L2. The purge gets slower with the answers of the surveys the person joined.**
- Worst case I built: 200 released surveys, 250 answers each (50,000 responses, 150,000 answers), one person in all 200. Purge: 6.1 seconds, one transaction (timeout 30 s, `deletion.service.ts:521`), which also holds the global role lock the whole time. Same person, surveys still running: 1.1 seconds. A cheap read (`GET /me`) during the purge: median 20 ms, worst 40 ms. Time grows with the responses in the surveys they answered (each is read again and rebuilt twice), so about 5 times that size would pass 30 seconds and the purge would fail and have to be retried. Not a problem at today's size.

**L3. eslint has one error on this branch.** `api/src/admin/trust/ads.service.ts:414` (prettier, from the ad audio check line `surveyAnswer.count`). `npm run lint` uses `--fix`, so CI mends it; run without `--fix` it fails. 51 warnings, 0 other errors.

**L4. The staff review list re-reads every answer for every page** (`surveys-results.service.ts`, `freeAnswers` calls `items()` per page). I built one survey with 50,000 answers; its review (1,000 pages of 50) had not finished after 10 minutes and I stopped it. Not measured further.

**L5. Open question, numbers only (no ruling): a choice nobody picked now hides that question's breakdown.** Simulated 20,000 questions per row, 4 choices, 60 answers, floor 5 (before round 5 in brackets). Breakdown hidden whole: even split 0.1% (0.1); 40/30/20/10 22.8% (22.6); 55/25/15/5 33.3% (31.3); 70/20/8/2 24.4% (23.8). One choice nobody picks (40/35/25/0): 95.4% hidden (0). With 5 such questions in a survey and 40/30/20/10, at least one loses its breakdown 72.6% of the time, all five keep it 27%. Per-option numbers actually visible: 77% (40/30/20/10), 67%, 76%, and 4.6% for the dead option (100 before). At 200 answers and one dead option: 0% visible (100 before). At the default floor 20 and 60 answers the rule changes nothing (per-option numbers show 0 to 9% of the time before and after: everything is under 40 and is folded into Other); at 200 answers and floor 20 a dead option hides 96% (0 before).

## What held

1. **Purge (round 4 M1).**
   - After `DeletionService.purge`: no choice, text or voice answer of the person in any table: `pg_dump` of the database grepped for the person's unique text and voice strings: 0 hits (groups of 5, 6, 7, 24; twice 3). Their `VoiceClip` rows removed, `SurveyResponse` by recomputed key: 0 left. Stored snapshot and released report: no trace. Review list: the person's text and voice gone together (24 items to 22). No survey cache exists (only the vote poll uses Redis).
   - Rebuilt report passes the floor: from exactly 5 the report becomes "below minimum" (nothing shown); from 6, 5 shown; two in a row 7, 6, 5, 4. Shown groups never under the floor.
   - Races, 6 rounds each: purge of person A, purge of person B and release at once, in alternating order: all finished, 0 errors, no trace of A or B in dump or report, released report always the remaining 6 of 8. Same person purged twice at once: both returned, one effect. Purge at the same time as the person answering: the answer got 403 (a person pending deletion cannot answer), 0 rows left. Purges are serialised by the role lock, no deadlock seen.
2. **Small groups never computable.**
   - Offline solver over `buildReport` on one choice question: floors 2 to 6, 2 to 4 choices, counts 0 to 2 x floor + 1 with 0 to 2 x floor + 1 unanswered; about 1.0 million datasets of the larger runs (several million across the floors). A hidden choice pinned under the floor to anything narrower than "0 to floor minus 1": 0. Unanswered group of 1 to floor minus 1 recovered: 0. Shown "Other" under the floor, or different from answered minus shown: 0. (The solver counts a hidden group of exactly the floor as fine: it is allowed.)
   - States and age bands (3 x 3, floor 3, 588,245 datasets): 0 hidden groups pinned, 0 shared-state or shared-age remainders pinned.
   - API: groups of 1, 2, 4, 5, 6, 50 (floor 5), at each stage: running (staff detail, list, report), one more answer, released, after one purge. Staff routes gave totals only (`responses`, `starts`, `completes`, `views`, `skips`, `answeredSoFar`) and never `questions`, `byState`, `byAgeBand` or options while running or in review. Released: 1 and 2 answers show nothing; 4 answers plus the one I added (5) show 5, a hidden question and an "Other 5"; 50 shows Rice 45 and Other 6. After the purge 4 shows nothing.
3. **Scrub:** every existing scrub spec passes (see Suite); new cases hold; see L1 for the misses.
4. **Caps.** 20 requests at once from one person: VIEW with cap 1 gave 1 row, cap 3 gave 3 rows; START gave 1; SKIP gave 1; three people 7 each at cap 1 gave 3 rows (one each). Lagos day, Date faked only: 22:59:59.500Z VIEW (20 at once) one row dated Nov 14; 22:59:59.999Z again: still 1 row; 23:00:00.000Z: a second row dated Nov 15. SKIP before and at the boundary: one row each side. Placement the next Lagos day again offers a survey nobody skipped.
5. **Join with main.** Local merge of `origin/main` (21fa85a) into d4d1bb9: no conflicts (3 files from main: news service, posts service, `lock-no-key.spec.ts`), not pushed. `npx tsc --noEmit` clean. Whole suite on the merged tree: 153 suites, 152 passed, 1 failed, 2,568 tests passed, 1 skipped, 1 failed. The failure: `test/reach/scrub-round5.spec.ts` "200,000 characters of 1-: under 50 ms", 55.7 ms inside the full run. Three runs alone with `scrub-round4`: 629 of 629 pass. Audio: 13 of 13. The DM off-by-default, nameless reply, admin first, Admin mark, 2,500 characters, news tags and `FOR NO KEY UPDATE` lock specs are all in the passing ones. Migration stamps: this branch has 20261114190000, 240000, 260000 (none added now); `origin/main` has 20261114200000, 220000, 230000, 280000, 290000, 300000, 310000, 350000 and older; no stamp is shared, no duplicate prefix in the merged tree.
6. **Suite on the branch.** `npm ci`, `prisma generate`, `tsc --noEmit` clean. eslint without `--fix`: 1 error, 51 warnings (L3). `npm test` (jest in band, fresh database, own Postgres and Redis, `DATABASE_URL` and `REDIS_URL` set as CI sets them): 152 of 152 suites, 2,565 tests passed, 1 skipped, 0 failed; audio 13 of 13.
   - The builder's two "not mine" failures: `test/vote/vote.spec.ts` "serves a guest the live counts, cached in Redis" fails on clean `origin/main` only when `REDIS_URL` is not set (1 failed, 31 passed); with Redis reachable it passes (32 of 32). The scrub timing tests (`scrub-round4`, `scrub-round5`, the "1-" shape) passed on clean `origin/main` (661 of 661 with vote) and on the branch; they failed once in my merged full run by 5 ms. They are timing tests, not faults of the scrub.

## What I could not prove

- Brand-side reading of the report as a brand (there is no brand sign-in); I read what the staff route returns for a released report, which is the stored one.
- Differences between questions or between surveys (a brand with two surveys a state apart) were not solved.
- A real clip file in storage: the purge marks the person's clips removed in the database; I did not look inside object storage.
- L4 and the purge time for a single survey of 50,000 answers: not finished or not measured.
- A first full run of mine, started with `DATABASE_URL` unset and while my solvers shared the CPU, failed 68 suites with 429 and teardown errors; it is not repeatable (the same suites pass alone and in the clean runs above) and I took it to be my own setup. The numbers above are from the clean runs.
