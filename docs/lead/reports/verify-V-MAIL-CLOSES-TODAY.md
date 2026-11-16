VERDICT: MERGE
INTERIM

# Check of v/mail-closes-today (5183942) against main 5a00d54: interim

Interim only. Not yet run: the real `runDaily` through the app, the website JSON compare against main, the 10x and load repeats of the skip test, and the whole `npm test`. Those follow in the full report.

## What I found so far

No HIGH, no MEDIUM.

LOW 1. `short()` cuts hard (inside a word) when the last space sits before character 35, for example three short words and then a 60-letter word. That is the stated one-long-word rule, so it is by design. It never produced a trailing space, a trailing punctuation mark, an empty subject, half an emoji (lone surrogate) or more than 70 characters in 4,013 generated texts (`api/test/zz-verify`, not committed). A hard cut can split a joined emoji such as a family (the pieces are whole characters, so the mail is still readable).

## What held

- Merge base of main and the branch is 5a00d54. Branch is 5183942.
- Diff against main: source changes only in `present.ts`, `mail-events.ts`, `mail.service.ts`, `topic-mail.service.ts`, 9 template files; new files are two specs and the lead report. No existing test file edited. In `present.ts` the end-time block is moved word for word into `questionEndsAt(q, now)`; `status`, `ov` and every other line of `presentQuestion` stay as they were.
- Typecheck is clean. ESLint (no `--fix`) on `src/mail`, `present.ts` and both new specs is clean.
- `mail-closes-today.spec.ts` and `mail-copy.spec.ts` pass (27 tests).
- Placeholder scan (a script reading all 73 templates, text and HTML and subjects, against every caller): no template that has a caller is missing a value, on the branch or on main. The shared values (`first_name`, `app_url`, `preferences_url`, `asset_base`, `unsubscribe_url`) are added by `MailService`. The brand mail path (F01 to F04) adds `app_url`, `preferences_url`, `asset_base` only, and F01 to F04 use none of the others. D01 to D04 take their values through `...common`, checked by hand. 38 templates (B02, B04 to B08, B10, C03 to C13, D05, D06, E03, E12, F05 to F10, G02, G03, G07, G08, H01 to H03, H05 to H07) have no caller anywhere, on main as well: nothing is sent, nothing to break.
- Real subject from this morning now reads `Today’s question: As a Nigerian, are you really fine? You dey okay? Or are you just…` (it was cut inside "tired").
- C01 text and HTML with 0, 1, 2 and 1,204 voices: `0 voices so far`, `1 voice so far`, `2 voices so far`, `1,204 voices so far`; no `{{` left.
- `closes_in` for a question whose stored end is 6 days away, with the slot being today: 06:00 UTC gives `17 hours`; 22:30 UTC gives `30 minutes`. The same question with yesterday's slot gives `6 days`. An override ending 17 Nov 10:00 UTC gives `28 hours`. No end gives `a day`. Lagos has no clock change, so there is no day of 23 or 25 hours.
