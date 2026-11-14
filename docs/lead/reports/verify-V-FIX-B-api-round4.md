VERDICT: FIX

# Verify V-FIX-B round 4, API side (first version, written at the first verdict-changing finding)

Code under test: `origin/v/fix-b` at f7f4444. `git merge origin/v/fix-b` into `verify/v-fix-b` conflicted (add/add in `docs/lead/reports/V-FIX-B-builder-report.md`, the only conflict), so I tested f7f4444 in a separate worktree, as told. Own Postgres 16 (port 15443) and Redis (16391, 16392), the repo's fakes only, no live provider, no `.env` or key file opened. My attack specs are not in the commit.

## N-3: not closed. The fix moves the hole to the other twin (R4-1, MEDIUM)

`posts.service.ts` `editAnswer` now reverses a charge only when `created` (the call that wrote the charge row). Two identical longer edits share one charge row (same key). If the call that CREATED the charge is the one refused, it reverses the shared charge; the twin that did not create it then passes the lock, writes the longer text, and its charge is already REVERSED. Result: longer text, no live charge, poster paid 0.

Held at the gap (both edits stopped after the shared charge; the poster asks for Verified; creator A released: 409 and reverses; the editor declines; twin B released: 200):
- two identical edits: A 409, decline 200, B 200; ledger `REVERSED:4970`, poster paid 0, body 150 chars.
- three identical: 409, 200, 200; `REVERSED:4970`, paid 0, body 150.
- five identical: 409, 200, 200, 200, 200; `REVERSED:4970`, paid 0, body 150.
- the reverse order (twin first, creator last, all refused) gives one reversal and a paid 0 with the old text (right); creator stands and the rest refused gives `COMMITTED:4970`, paid 4,970 (right). B refused first and A after: both 409, `REVERSED`, paid 0, old text (right).

Not only held: plain race, no hooks. 3 identical edits (or 2) against the poster's request followed at once by the editor's decision (DECLINE_VERIFIED, KEEP, SEND_TO_MODERATION in turn), 300 runs, delay 25 ms: **45 of 300 ended with the new 100-character text and one REVERSED charge of 3,300 milli** (wallet = start: the poster paid nothing). Delay 45 ms: 34 of 300. Example: edits `409, 200` + request 201 + decision 200, `charges=REVERSED:3300`, `bodyLen=100`. No 5xx.

Should happen: a reversal must not leave a standing edit unpaid. Either give the charge back only when no twin is still running on it, or re-check at the end that a charge for the standing text is live (and charge again if not), or key each edit call so two calls never share one charge.

The builder's own spec ("N-3") passes because it only has the twin refused, never the creator refused with the twin standing.

(rest of report to follow)
