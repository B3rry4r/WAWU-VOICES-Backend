VERDICT: MERGE
INTERIM

# Check of V-SURVEYS round 7 (API), interim

Branch `origin/v/surveys` at fffa0c9, checked on `verify/surveys-7`. I changed no product code and no existing test. My attack specs, solver and word lists are not committed. Own PostgreSQL 16 (port 18532, deadlock log on) and Redis, fresh databases. Floors 5 and 20 (`weekly.min_group_size`).

This is the interim: verdict so far is MERGE, with no HIGH and no MEDIUM found yet. Still to run before the final: the join with main 6efe83b+ (items 6), the whole `npm test` totals and speed runs (5, 7), eslint, migrations (7), and the 100-round purge-with-moderator race (6). Those can still change the verdict.

## Round 6 findings, from my own runs

| Finding | State |
|---|---|
| MEDIUM 1 join breaks two round 2 specs (429) and one flaky | CLOSED for the 429 pair (bare 429 now `paused`, named daily cap `capped`, both run green, see 4 below). The flaky `0803` spec now searches only readable texts (see "Changed assertions"). Merged-tree run still to do. |
| MEDIUM 2 scrub newly lets shapes through | CLOSED for the 12 shapes of round 6 (all removed as the whole text). Still kept, as ruled: `Word.Ending` followed by more words with no cue (5 of my shapes, below). 10 digits starting 0 removed again (`0241234567`, `0803123456`, `0123456789` all go). |
| MEDIUM 3 purge moves a number when a transcript lands after release | CLOSED. Purge by answer id: a person with no listed item loses nothing, nobody else's item goes, `answered` frozen (run below). |
| LOW 4 released report shows less than the floor after purges | OPEN, now a ruled consequence (see LOW 1). |
| LOW 5 review list at 50,000 | not re-run yet |
| LOW 6 purge matches by today's scrub | CLOSED (answer id, not text). |
| LOW 7 deploy window, `releasedTotals` NULL | not re-run, unchanged by this round (no new migration). |

## Findings so far

### HIGH
None found.

### MEDIUM
None found yet.

### LOW

**1. After purges a brand reading only the current report can count withdrawn items, and can see a list under the floor.** Ruling-made, for the owner to confirm it is what was meant. Run (real HTTP answers, release, then purges by account deletion):
- Floor 5, 14 people with a written and a voice answer, 5 silent people (no free answer), one text hidden by staff, one clip with no transcript at release: released lists 13 and 13, `answered` 13 and 13. After 1, then 3, then 10 purges (14 people gone in the end, one left): every number identical to the released one, `answered` stays 13 and 13, written list 1 item, voice list 1 item.
- Floor 20, 30 people, 20 silent: lists 29 and 29, after 13 purges lists 16 and 16, `answered` 29 and 29, every number unchanged.
- What a brand that reads only the current report learns: `answered` minus the list length is how many listed items were withdrawn (after 1 purge, `answered` 13 against a list of 12 says exactly one). That is a count under the floor. It learns nothing about choices, and nothing about who. With the list down to 1 to 4 items it can read a group under the floor, which the floor rule says hidden; the rulings ("numbers stay", `answered` frozen) are what allow it.
- What a brand that kept the old report learns: exactly which written and voice items were withdrawn (it already had their text). Nothing about choices. Same as the expected answer.

**2. `CONTACT_CUES` holds 24 words, the report says 27.** `api/src/reach/scrub.ts:61-65`: `on at via visit find follow check dm message contact page site link handle website whatsapp telegram instagram ig tiktok x twitter facebook fb`. I do not have the ruling's list, so I cannot say which 3 are missing. `add`, `ping`, `text`, `mail`, `reach` are not cues: `add Chidi.Me to your list` is kept (words follow, no cue).

**3. A date followed by a capital word loses its year.** `Rice happened on 12/11/2026.Me too.` becomes `Rice happened on 12/11/ too.` (the `2026.Me` is read as an address). Same on `origin/main`, so not new.

**4. Brand mail shares the relay pause with topic mail.** A bare 429 on a brand mail sets the shared `pauseMs` (`mail.service.ts:768`), which the next topic mail that is paused reads once. Not shown to cause harm; brand mail itself does not wait, the ten-minute sweep sends later.

## What held (interim)

1. **Frozen numbers by answer id.** Over real HTTP (answers posted through `/surveys/:id/responses`, staff review read, staff hide, release, purge through the deletion service). Floors 5 and 20, runs above: every number byte for byte as released after 1, 3, 10 and 13 purges, `answered` unchanged, only the purged people's own items gone (checked by the answer rows left), the same text twice leaves the other person's item, the staff-hidden answer and the transcript that landed after release move nothing. A person in 50 released surveys: one purge, all 50 reports numbers unchanged, none holds the purged person's text, no response row of theirs left in any of the 50.
   - Answer id never served: staff report (ADMIN and AD_MANAGER), detail, list, review list, account export, brand page, guest survey and placement: 24 responses scanned (21,264 characters), 8 answer ids searched, 0 hits, and no `textIds` or `voiceIds`. Log lines: the test harness wrote no log chunk during those calls (0 captured), so for logs I only grepped the source: no logger call in `api/src/surveys` names an answer or clip.
   - After the purge of 3 of 8 people: `pg_dump --data-only --inserts` of the whole database holds none of their 9 answer ids, none of their respondent keys, none of their texts or transcripts. The answer row is deleted (cascade), `SurveyResponse` too. Tables that still hold the purged user id (existing purge, not this branch): `User` (tombstone), `AuditLog.targetId`, `DataExport.userId`, `Wallet.userId`, `VoiceClip.ownerId` (the survey clip row stays, status REMOVED, purpose SURVEY_ANSWER, no survey link), and a `Transcript` row of the removed clip stays (its text is not in the dump). No other table holds an answer id. The review handle in `AuditLog` is an HMAC with the pepper (`survey-rules.ts:41`), not the answer id.
   - Races, 30 rounds (even rounds purge with release; odd rounds two purges with release), then a further purge each: no half state, purged people in no list, every stored id still points at a live answer, a later purge moves no number. Postgres log: 0 "deadlock detected" (log covers the whole cluster, including my other runs and the full suite).
2. **Small groups.** Solver over `buildReport`, floors 2 to 6, 2 to 4 choices, counts 0 to 2 x floor + 1 and unanswered 0 to 2 x floor + 1: 1,007,944 datasets. Pinned hidden groups under the floor (exact or nonzero-small): 0. Shown group or Other under the floor: 0. Small unanswered remainder readable: 0. Other different from answered minus shown: 0. (10,455 classes pin a hidden group at or above the floor: a lone folded group equals the shown Other, which the rule allows.) The solver ran against `buildReport` as it is on the branch; I did not run it against a weakened rule, so its sensitivity is argued, not shown.
3. **Target under floor, totals before release.** Real HTTP, a watcher (`GET /surveys/:id`) and the staff report: old row target 1, floor 5: first change at answer 5 (200 to 404, REVIEW). Old row target 3, floor 20: at 20. Target equal to floor 5: at 5. Answers after the target: 409. Create with target 3 under floor 5: 422. Edit to 3: 422. Create with 5 and 20: 201. Old row with target 3 submits (200) and the approve is refused (422). Running totals before release: staff (ADMIN and AD_MANAGER) read `answeredSoFar` at 3 answers with floor 5, no breakdown in the body; a non-staff signed-in person gets 403 on the report, a guest 401 on the survey.
4. **Brand mail.** Local relay stand-in that records every request's idempotency key. For each of bare 429, named rate limit (`rate_limited`, retry-after 1), named daily cap, 500, 422 and a relay that never answers: first try not logged and no allowance used; a second try while still failing also not logged; when the relay is well again the mail goes once; a further try says `limited`. Outcomes: bare 429 and rate limit `paused` (1 relay call each), daily cap `capped` (1 call, the next try the same day makes 0 calls, goes the next UTC day), 500 `failed` (3 calls, same key), 422 `failed` (1 call), hang `failed` (3 calls, same key). Duplicate deliveries by key: 0. Daily limit `BRAND_MAIL_DAILY_MAX=4` with 3 mails paused first: log rows 0; then 6 mails give sent x4, budget x2, rows 4: never passed, never used by a mail not sent. Restart in the capped day (memory cleared): the first try after it asks the relay once more and gets the cap again; nothing sent twice, nothing lost (all 3 went when the relay was well, 0 duplicates).

## Changed assertions (git diff 3d2b480..HEAD -- api/test)

- `surveys-round2.spec.ts`: the 429 spec now sends the same bare 429 and expects `paused` (was `capped`); a new spec sends the named `daily_cap` and expects `capped`, then no relay call that day, then `sent` next UTC day. What the lead's rule needs, nothing more.
- `surveys.spec.ts`: `0803|08031234567` no longer searched in the whole report, now searched in prompts, labels, texts and transcripts; the other banned words still in the whole report. This is what the lead's rule needs (and it ends the flaky spec of round 6). Added: `afterAll` sets every question to DRAFT.
- `surveys-round6.spec.ts`: two `answered` expectations (50 to 51; 7 to the released `totals.responses`). Needed by "answered frozen". The second one is looser (8 if release first, 7 if purge first), which matches the race.
- `scrub-surveys-round6.spec.ts`: the one entry `Account type is 0123456789 savings?` moved from "stays" to a new "removed" case. Needed by the phone ruling.
- Existing `origin/main` tests changed on the branch: `test/me/me.spec.ts` (+1 line, new setting `useMyStateForSurveys: false`) and `test/vote/vote.spec.ts` (two new specs, nothing removed). Both from earlier rounds, additive. No other test file of main is changed.

## Scrub (item 5, interim)

- Round 5's 25 sentences: 22 stay; 3 change on the branch: `He is a dot com millionaire`, `Amaka at home dot com is a joke name` (both as on main and as the ruling keeps), `Account type is 0123456789 savings?` (the phone ruling). Main changes all 25.
- My 300 ordinary sentences (Nigerian English, Pidgin, prices, dates, amounts; 225 generated, 75 written): branch changes 9, every one also changed on main: 7 of the date shape `12/11/2026.Me too.` (LOW 3) and `Price don change.N95.50/kg now, no be last week.`, `Fine.N95.50/kg is okay by me.`. Main changes 195 of the 300.
- 163 contact shapes (emails, spoken forms, links, handles, 62 phone forms): 39 survive on the branch, 35 on main. Newly kept compared with main: 5, all the `Word.Ending` family with words after it and no cue: `Chidi.Me is my page`, `Chidi.Me and more`, `Chidi.Store now`, `Chidi.Link, thanks`, `add Chidi.Me to your list`. One shape that survived on main is now removed (`c h i d i @ g m a i l . c o m`). Survivors that main also keeps: the spoken and look-alike email forms (`chidi_at_gmail_dot_com`, `chidi at gmail dot c0m` and the like), `mybrand.c0m`, `mybrand.corn`, `mybrand%2Ecom`, `my_brand.com`, `localhost:3000`, `@ chidi`, `u/chidi`, `r/chidi`, `#chidi`, `whatsapp chidi`, `add me chidi_o on telegram`, `803 123 4567`, `07700 900123`, `8 0 3 1 2 3 4 5 6 7`, `eight oh three one two three four five six seven`, `one two three four five six seven eight nine zero`, `chidi at the rate gmail dot com` (partly), `chidi%40gmail.com` (partly), `x dot com slash chidi`. All 12 round 6 shapes alone are removed.
- Speed and the full suite totals: to come in the final.

## What I could not prove yet

Everything listed as still to run above. Also: no second OS process, no real relay, no real clip file; a brand cannot sign in, so I read the brand's report through the staff route and the public brand page.
