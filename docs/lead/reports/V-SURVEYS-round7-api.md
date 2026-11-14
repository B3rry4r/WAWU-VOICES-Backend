# V-SURVEYS round 7 (API): report

Branch `v/surveys`, joined with `origin/main` 63aa77c (a normal merge commit). No pull request opened.

## The join
Merge was clean, no file conflict. `prisma generate` and `tsc --noEmit` clean. No new migration in this round (stamp 20261114370000 stays the last of this branch; nothing needed 380000).

## M1: brand mail follows main's 429 rule
- `api/src/mail/mail.service.ts` (`sendBrand`, about lines 475 to 530): a 429 with no named code is a rate limit: the mail is not logged as sent, uses none of the brand's daily limit (the log slot is given back), and the result is `paused`; `mailResults` sees "not sent" and the ten-minute sweep sends it later. The relay's named daily cap (`classify429` kind `daily`) returns `capped` and ends the day for brand mail (until the next UTC midnight, the same day the brand limit counts in): later brand mail that day is not tried and the relay is not asked; nothing is lost, it goes the next day.
- `test/admin/surveys-round2.spec.ts`:
  - "a relay that answers 429 is capped, not logged, and sends later" (now "a relay that answers a bare 429 is paused, ..."). Before: relay body `{error:"daily_cap"}` (no `code`), expected result `"capped"`. Now: the same bare 429 expects `"paused"`; still 1 call, nothing logged, sent on the next try.
  - "brand mail has its own daily limit": no change of its own; it failed only because the first spec left the mock in 429 mode. Passes unchanged.
  - New: "the named daily cap ends the day for brand mail; nothing is lost and it goes the next day" (`{code:"daily_cap"}` gives `capped`; same day: relay not asked again, nothing logged; next UTC day: `sent`).
- `test/admin/surveys.spec.ts` (the `0803` spec): before it searched the whole report for `0803|08031234567`; now it searches only the texts a brand can read (prompts, choice labels, written answers, voice transcripts). The other banned words are still searched in the whole report. Same meaning.

## M3: a purge takes out exactly the purged person's own listed items
- `survey-report.ts`: when free answers are built, each written and voice item has its answer-row id kept in the stored report (`textIds`, `voiceIds`, same position as `texts` and `voices`). Answer id only. `withoutAnswerIds` takes them out; `surveys-results.service.ts` (`report`) applies it, so no response carries them. Test: report (staff and ad manager), detail, list and review list contain no answer id and no `textIds`/`voiceIds`.
- `survey-erase.ts` (`dropFree`, `freeAnswersOf`): removes exactly the items whose answer id belongs to the purged person, nothing if they had none (a staff-hidden answer, an answer whose transcript came after release). `answered` is no longer lowered: frozen at release, so a brand can see `answered: 14` with 4 items.
- A stored report without ids (none exists live): numbers untouched; an item goes only on an exact text match AND when the answer and its transcript existed before the release time.
- Proofs (`test/admin/surveys-round7.spec.ts`, 8 specs, all pass): the check's steps (13 people, floor 5, two say `same voice`, C's transcript lands after release, purge C: voice list and `answered` unchanged); same text twice, purge one: exactly that person's item goes (checked by the id of the one left); 14 released, 10 purges: every number as released, 4 texts and 4 voices, `answered` 14; a changed scrub simulated by storing a different text: the right item still goes; purge of a person with no listed item: report unchanged; old-style report without ids; purge and release together, 20 rounds, no trace of the purged, no half state; no answer id in any response.
- Two existing round 6 assertions had to change because of the ruling "answered is frozen" (outside the three named, please look): `test/admin/surveys-round6.spec.ts` "51 answers released ... one purge": `answered` was 50, now 51 (50 items listed); "a purge and the release at the same moment": `answered` was 7, now equal to `totals.responses` (8 if the release came first, 7 if the purge did).

## M2: the scrub (`api/src/reach/scrub.ts`)
1. `Word.Ending` after a full stop (`isSentenceEnd`) stays only when at least one more word follows it, and no contact cue stands within three words before it (the 27 cues of the ruling, kept in `CONTACT_CUES`). Otherwise removed. All 25 sentences of the round 5 report (the 21 of the ruling among them) stay; scrub specs green.
   Of the check's twelve newly kept shapes, tested as the whole text: all twelve are now removed: `Chidi.Me`, `MyBrand.Me`, `mybrand.Me`, `Chidi.Shop`, `chidi.Shop`, `ChidiShop.Store`, `Chidi.Link`, `Chidi.Page`, `Mybrand.To`, `Mybrand.Africa`, `MyBrand.Info`, `find me on Chidi.Me`. Still kept, by the ruling: the same shape when words follow it with no cue before it (`Chidi.Me is my page`, `Chidi.Me and more`), because it cannot be told from `Wait.Me I am coming`.
2. A plain 10-digit number that starts with 0 is removed again (`0241234567`, `0803123456`, `0123456789`); one ending in five or more zeros stays (`1000000000`). Existing `scrub-surveys-round6.spec.ts` listed `Account type is 0123456789 savings?` as unchanged; it conflicts with the ruling, so I moved that one entry to a "removed" case at the end of that file (flagging it, outside the three named).
3. Speed: the address patterns scan long runs with no dot and cannot match without a "." or the word "dot", so they are skipped for such text (same output). 200,000 characters of `1-` (the spec calls `scrub(text)`, which cuts to 5,000 characters first), 30 runs in one process, three batches:
   - this branch: median 3.5, 3.2, 5.8 ms (after the guard); worst 11.3, 11.2, 14.5 ms; two later batches: median 2.7 and 3.3, worst 9.1 and 10.3.
   - `origin/main`: median 9.1, 9.6, 9.7 ms; worst 26.5, 16.4, 19.7 ms.
   The existing timing tests are untouched. `test/reach/scrub-round7.spec.ts` adds one check on the median of 15 runs under 25 ms, plus the sentence, cue and phone cases.

## Shared test database
New specs of this branch checked (`git diff --name-only --diff-filter=A origin/main...HEAD -- api/test api/src`): none creates a post or moderation row or a question scheduled for today. Only `test/admin/surveys.spec.ts` left three LIVE questions (no answers, not scheduled); its `afterAll` now sets every question to DRAFT.

## Contract
Rebuilt with `build.py`: no change to `openapi.yaml`. No response shape changed (the answer ids are stripped), so the website copy needs nothing.

## Suites
`tsc --noEmit` clean. eslint without `--fix`: 0 errors, 26 warnings (fixable ones are existing). Whole `npm test` in band on a fresh database after the join: 169 suites, all passed; 2,832 tests passed, 1 skipped, 0 failed; audio 13 of 13. `hotfix1-block-oracle` and `shared2` passed.

## Could not prove
- No second OS process, no real relay (the mail relay is a local mock; the daily-cap day is kept in memory, so a restart forgets it and the first try after a restart asks the relay once).
- The scrub spec of the twelve shapes covers them alone or ending the text; other surrounding words were tried by hand only.
- Timing is from this machine alone, with nothing else running.
