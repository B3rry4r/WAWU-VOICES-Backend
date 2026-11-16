# V-MAIL-CLOSES-TODAY

Branch `v/mail-closes-today`, made from `v/mail-copy`. PREPARED ONLY: not released, no pull request, waiting for the owner's word. No schema change, no migration.

## What changed

- `api/src/feed/present.ts`: the end-time rule is now one exported function, `questionEndsAt(q, now)`. `presentQuestion` calls it. Same rule as before: an override question ends when the override ends (or when the question was closed early); today's daily question ends at the end of the Lagos day; any other question keeps its own stored end.
- `api/src/mail/topic-mail.service.ts`: the C01 run now reads each question with its override row, and `closes_in` comes from `closesInFor(q, t)`, which uses `questionEndsAt`. This is the same function the website uses, not a second copy. The "closes in" wording itself (`closesIn`) is unchanged.
- New spec `api/test/mail/mail-closes-today.spec.ts` (pure, no database).

## What people would have seen

At 06:00 UTC on 16 Nov the site said "Closes in 17h" and the mail said "6 days". With this change the mail says "closes in 17 hours".

## Spec results (the cases asked for)

- Today's daily question, stored end 6 days away, mailed 06:00 UTC: "17 hours".
- Same, mailed 22:30 UTC: "30 minutes".
- A question with an override: the override's end ("9 hours" in the test).
- An override that closed the question early: that earlier moment ("4 hours").
- The launch question (not today's slot): its own end, "6 days".
- No stored end: "a day", as before.
- `presentQuestion` gives the same `endsAt` as the rule on origin/main for each of these rows, plus one for the next day. The spec carries a copy of the old rule as the check, and I did not run origin/main itself.

## Runs

- typecheck: clean. eslint without `--fix` on the touched files: clean.
- New spec: 14 passed. (The Part A mail suites, 287 tests, passed on the Part A branch; I did not re-run them alone here, only inside the full run below.)
- Whole `npm test`: 178 suites passed, 1 failed; 2932 tests passed, 1 skipped (as before), 1 failed.
- The failure: `test/mail/topic-mail-skip.spec.ts`, "V-TOPIC-MAILS-2 round 3: refusals are remembered in the database > 2 instances at once > nobody is mailed twice, the budget and the half rule hold, skip rows are not duplicated" (line 397: expected 40 mails, got 32). It is a two-servers-at-once timing test. I ran the file alone twice on this branch: 18 of 18 passed both times. It passed in the full run on the Part A branch. I did NOT run it on origin/main, so I cannot say whether it also fails there. I believe it is load-related, but I did not prove that.
- The 13 audio tests did not run on this branch: `npm test` stops before them when a jest test fails. They passed on the Part A branch.

## Not proven

- No real email was sent and no live service was called.
- I did not read a real mail out of the running API to check the 17 hours; the spec tests the same function the C01 run calls.
