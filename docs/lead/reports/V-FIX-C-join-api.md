# V-FIX-C join (api)

Head pushed before this report: 8ab47db on `v/fix-c` (started from 830680c, as ordered). This report is one more commit on top.

## Open findings of the latest check (round 7, verdict FIX)
- F4b HIGH (combining marks in email names and domains) and M3 MEDIUM (full-width angle marks became markup): both were fixed by the builder in 830680c (`scrub.ts` classes now hold `\p{M}`; fold before the tag strip). No check has verified that commit yet. I did not re-test them beyond the piece's own specs (they pass, see below).
- LOW items listed in round 7 are untouched (words that are tag names dropped without a mark; `[Removed]` in other case not refused on approve).

## Conflicts
- `api/package.json` (jest `setupFiles`): kept both `test/no-provider-key.ts` and `test/list-ttl-off.ts`.
- Everything else merged without conflict. Contract sources auto-merged; `build.py` rebuilt `openapi.yaml` (admin 60, text-fix 1, direct-messages 9); `build.py /tmp/o.yaml && cmp` identical.

## Step 2 answers
- Nameless posts: this piece reads only `body` and the transcript text of answers (summary-draft, weekly-draft); `authorId` and `anonymous` are never selected into a prompt or a draft. `moodCounts` uses `authorId` only in memory to count one mood per person. `scrub` runs on every text sent to the AI (weekly-draft voices, summary-draft voices) and on every quote and model line shown to an editor (`cleanModelText`). Approving with `[removed]` in mainView, opposingView, pollLine or nextStepsLine answers 422 "Take out or rewrite the marked places before approving." (`topics.service.ts` near line 1167).
- Direct messages: grep for `dmMessage|dmConversation|dmMute|/dm/|direct message|\bdm\b` over the 14 `api/src` files this piece changed: no match.
- Window rule: two reads were not using it. I fixed them with main's `questionReadableWhere` (no second version): `weekly-draft.ts` `moodCounts` (was raw SQL over all questions of the topic; now a Prisma read, first mood per person), and `admin/summary-draft.ts` (answers, mood groups, voice sum, categories, proposals now under readable questions). The weekly draft's answer reads already used it. Not changed: `admin/weekly.service.ts` `spokenLanguages` and quote checks (read language names and ids only, no text).
- Migrations: this piece has none (`git diff --name-status 4fa9d50 830680c -- api/prisma` is empty; `prisma/` equals origin/main's). `npx prisma migrate deploy` on a fresh PostgreSQL 16: all applied. `migrate diff` against schema.prisma shows the same drift main already has (index on User.handle, one VoiceClip index name); nothing from this piece.

## Step 3
No spec of this piece failed on the 5 free posts, so none was changed. No other spec was touched.

## Commands
- `npm ci` (929 packages), `prisma generate`; `npx tsc --noEmit`: exit 0.
- `eslint` on `weekly-draft.ts` and `summary-draft.ts`: exit 0.
- `jest test/admin/fixc.spec.ts test/reach`: 19 suites passed, 997 passed, 1 skipped.
- Whole suite, in band, fresh database (own PostgreSQL 16 on 55432, Redis on 56379, empty provider key): 128 suites passed of 128; 2255 passed, 1 skipped, 2256 total. `test/talk/hotfix1-block-oracle.spec.ts` passed in the whole run.
- Not run: `npm run test:audio` (not ordered).

## Not sure
- The two window fixes have no new spec of their own; they are covered by the existing suites only. A spec with a not-yet-open question holding a mood answer would pin them.
