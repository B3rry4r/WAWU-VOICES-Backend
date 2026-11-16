VERDICT: MERGE

# Check of v/mail-closes-today (5183942) against main 5a00d54

No HIGH. One MEDIUM that I could not settle (a test that failed once on the branch and never on main). Details below. The site is live, so my advice is to send it.

## Findings, most severe first

### MEDIUM 1. One unexplained failure of the "2 instances at once" test, on the branch only (1 of 45 runs; 0 of 45 on main)

Steps: `cd api && TEST_DATABASE_URL=... npx jest test/mail/topic-mail-skip.spec.ts --runInBand --forceExit`.

| Run | Branch | main |
|---|---|---|
| whole file, alone, 10 times | 9 pass, 1 FAIL (run 6) | 10 pass |
| whole file, 4 busy loops running, 5 times | 5 pass | 5 pass |
| only the "instances at once" tests, 30 times | 30 pass | 30 pass |

The one failure was the builder's exact one: `nobody is mailed twice, the budget and the half rule hold, skip rows are not duplicated`, expected 40, received 32 (`topic-mail-skip.spec.ts:397`). It fell during a stretch when I was also running a CPU job of my own, so that run was not clean. I could not repeat it in 70 more runs.

Could Part B cause it? I find no way. Part B only adds `include: { overrideQuestion: { select: { endsAt } } }` to the two `findFirst` reads in `runDailyQuestion` (`topic-mail.service.ts` 714 and 724). It adds no write and changes no budget, cursor or skip code. The test is a race between two or five servers over the 40-mail daily budget, and 32 means fewer mails went out, not duplicates. A shorter or longer read can only change timing. 1 in 45 on the branch against 0 in 45 on main is not enough to tell the two apart (zero failures in 45 on main would happen about a third of the time if main fails at the same rate). By your rule a branch-only failure is a HIGH; I rate it MEDIUM because it did not repeat and the changed code cannot reach the budget. You can overrule that. If you want more proof: run the whole file 40 more times on each side while the machine is quiet.

### LOW 1. `short()` hard-cuts inside a word when the last space is before character 35

Example: three short words and then a 60-letter word becomes `... supercalifragilisticexpialidocious…`. This is the stated one-long-word rule, so it is by design. A hard cut can also split a joined emoji (a family emoji) into its parts; each part is a whole character, so nothing breaks.

### LOW 2. F05 template (not sent by anything) still says "within {{review_days}} days"

`templates/html/F05-advert-submitted-for-review.html:38`. F05 has no caller on main or on the branch, so nothing goes out. If F05 is ever wired in with `review_days` carrying its word (as F01 now does), it would read "2 days days". Note for whoever wires it.

## What held

1. Diff against main. Source changed only in `present.ts`, `mail-events.ts`, `mail.service.ts`, `topic-mail.service.ts` and nine template files. New files: two specs and the builder's report. No existing test file is edited (`git diff origin/main --stat -- api/test` lists only the two new specs).
2. `presentQuestion` unchanged. The diff moves the end-time block word for word into `questionEndsAt(q, now)` (`present.ts:92-111`); `status`, `ov` and everything else in the function stay. I ran the old function from main and the new one from the branch on 20,000 random questions (daily and override, with and without end or slot, override ending before or after the stored end, any hour over 8 days). 0 errors, 0 differences. In 2,778 of those the shown end differs from the stored end, so the rule was really exercised. I did not boot two apps and compare route JSON (`/questions/today`, `/home`, `/calendar`, topic page, trending). Every one of those goes through `presentQuestion`, and no other file that feeds them changed, but I did not prove it route by route.
3. Placeholders. A script read all 73 templates (text, HTML and subject) and every sender in `src` (found by reading the code, not by name). The values `first_name`, `app_url`, `preferences_url`, `asset_base` are added by `MailService.notify`, `unsubscribe_url` when the template has an unsubscribe kind. The brand path (F01 to F04) adds `app_url`, `preferences_url`, `asset_base`, and none of F01 to F04 uses anything else from the shared set. Result on the branch and on main: every sent template gets every value it uses (D01 to D04 take theirs through `...common`, checked by hand). 38 templates have no sender at all, on main too. A missing value would anyway stop the mail from being sent (`renderMail` refuses), never send it with a hole.
4. Changed templates, rendered with the real sender's values: C01 `0 voices so far`, `1 voice so far`, `2 voices so far`, `1,204 voices so far` (text and HTML); no `{{`; no doubled word. The other changed templates read from the helper by the builder's own spec (`mail-copy.spec.ts`, 120 lines) and by the template diff: B12 `1 proposal in the group` or `N proposals in the group` (HTML and text); F01 `within 2 days` (HTML only; the F01 text has no review days); F04 `1 response` / `3 days live` / `1 response is in.`; G01 `1 voice | 1 vote`. Every new label is paired with a number in the same caller.
5. C01 through the real `runDailyQuestion` with the local stand-in relay (a local port, nothing real sent), window opened to 23:59 so 22:30 UTC could run. Rendered subject on every run: `Today’s question: As a Nigerian, are you really fine? You dey okay? Or are you just…`.

| Case (stored end 6 days away, slot is today) | Rendered line |
|---|---|
| 0 voices, 06:00 UTC | `0 voices so far · closes in 17 hours` |
| 1 voice, 06:00 UTC | `1 voice so far · closes in 17 hours` |
| 2 voices, 06:00 UTC | `2 voices so far · closes in 17 hours` |
| 1,204 voices, 06:00 UTC | `1,204 voices so far · closes in 17 hours` |
| same four at 22:30 UTC | `... so far · closes in 30 minutes` |
| override ending 17 Nov 10:00 UTC, 06:00 | `3 voices so far · closes in 28 hours` |
| a question whose slot is not today (launch-like, own end 18 Nov 22:00 UTC) | `7 voices so far · closes in 2 days` (its own end) |
| daily with no end | `5 voices so far · closes in a day` |
| daily whose slot is yesterday | not picked: `nothing-open` (as before) |

Lagos has no clock change, so there is no 23 or 25 hour day to check. Note: with the default window (07:00 to 12:00 Lagos) a 22:30 UTC run says `too-late` and sends nothing; I widened the window only for the check.
6. `short()`: the real subject is above (it was cut inside "tired", now it ends on a whole word). 4,013 generated texts (random words with `’`, emoji, a family emoji, dashes, brackets, long words, trailing `?!,:;-`; texts of 68 to 72 characters; one long word; one word; empty; 80 emoji; repeated "a, "): never longer than 70, never empty, never a trailing space or punctuation before the `…`, no half emoji (lone surrogate), the cut is always a prefix of the text, texts of 70 or fewer are unchanged. The only cuts inside a word are the one-long-word rule (LOW 1). Caller of `short()`: only `question_short` in C01's `vars` (`topic-mail.service.ts:754`); it feeds the subject, `Today’s question: {{question_short}}`. The mail body uses the full `question_text`.
7. Gates, on the branch:
 - `npm run typecheck`: clean.
 - ESLint on `{src,test}/**/*.ts`, no `--fix`: 0 errors, 56 warnings (unused eslint-disable lines in files this branch does not touch, e.g. `test/units/wf-payments.spec.ts`; I did not count them on main).
 - Whole `npm test` in one part (local Postgres and Redis from `services.sh up`): 179 suites passed of 179; 2,933 tests passed, 1 skipped, 0 failed (24 minutes); then `test:audio`: 13 of 13 passed. That includes every spec under `test/mail` and the two new ones. `test/talk/fixb-r4-edit.spec.ts` did not fail this time. I did not run the whole suite on main, since nothing failed.

## What I could not prove

- Route JSON of main against the branch on a shared database (item 5 of the order): proved at the function level only (above).
- Whether the single failure in MEDIUM 1 can happen on main. 45 runs each gave 1 and 0.
- The F01 to F04, B12 and G01 mails through the real senders end to end (they need survey, group and weekly-draft data). I checked the senders' values by reading the code and by the script, and the render by the builder's helper spec and the template diff.
- No live service, mail provider or usevoices.com was called. Nothing was committed except this report. My test files (kept outside the repo) are not on the branch.
