VERDICT: FIX

# Verify V-FIX-B round 4, API side

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


File and line: `api/src/talk/posts.service.ts` `editAnswer`, the `created` flag (about lines 444-496, the `catch` with `if (charge && created)`).

Why FIX: one MEDIUM money hole (R4-1), still the N-3 shape. Everything else claimed is closed. MERGE would need no path where a longer edit is free.

## Round 3 findings and state

| Finding | State | Run |
|---|---|---|
| N-3 money | **Open, moved (R4-1)**. The builder's exact run now holds (A 200, ask 201, B 409, A's text stands, one COMMITTED charge, poster paid once). B refused first then A: both 409, one REVERSED, paid 0, old text. Twin-refused cases right. Creator refused and a twin stands: free. | Section above. |
| N-4 edit vs delete / removal | **Closed** | 20 races of the author's DELETE route and 20 of a removal (status set to REMOVED by a direct write at a random delay; the moderator route was not driven). 0 bad: 404 only with text unchanged and no live charge, wallet = start minus live charges; 200 only when the edit came first, with its charge live. |
| N-5 notice after KEEP / SEND_TO_MODERATION | **Closed** | Request open: KEEP and SEND_TO_MODERATION 1 notice each, "An editor looked at your request. Your post keeps its tag.", no body, no "moderation". DECLINE, APPROVE, CHANGE_TAG Gossip, CHANGE_TAG Verified: 1 each. No request: KEEP 0, SEND_TO_MODERATION 0, CHANGE_TAG 1 (as before), DECLINE/APPROVE 409. |
| N-6 request vs CHANGE_TAG Verified | **Closed** | 100 races: 0 OPEN rows on a Verified post. 25 x 409 `ALREADY_VERIFIED`, 75 x 201 with the request APPROVED, review RESOLVED. |
| N-7 (a) fan-out throws | **Closed** | Fan-out forced to throw once: post marker and hour marker both gone; next try announced (follower got 1); third try 0. (b) and (c) left as stated by the builder. |
| N-8 two different edits, grow/shrink/grow | Open, as the builder said; identical to origin/main | Plain steps 33 to 100 / 33 / 100 / 140 / 100 / 140 cost 2230 / 0 / 0 / 1340 / 0 / 0 on both this branch and origin/main (4fa9d50). |
| N-9 same edit after a refusal | **Closed** | After a refused edit (REVERSED), the editor declines, the same text: 200, ledger REVERSED then COMMITTED, paid once. Five at once after that: 200 x 5, one COMMITTED, paid once. Grow, refused, grow again, shrink, grow: costs 0 (refused), 2230, 0, 0; origin/main cannot refuse an edit, so only its plain steps compare (identical). |
| N-10 rollback comment | Closed (read the diff; the SQL is unchanged) | |

## New findings

### MEDIUM
**R4-1** above. Same as N-3 in effect: a longer edit stands with the charge REVERSED. Measured 45 of 300 and 34 of 300 plain races (poster asks for Verified, the editor declines / keeps / sends to moderation, 2 or 3 identical edits in flight), plus the held runs for 2, 3 and 5 edits. The ledger afterwards: `REVERSED:3300` or `REVERSED:4970`, wallet at start, text new. Needs an editor to answer a request while identical edits are in flight, so it is narrow but it is real money and needs no special tools.

### LOW
**R4-2** The builder's N-1 spec mock now calls `opts.onCreated()` to stand in for a creator, so that spec cannot see R4-1 (it has no creator-refused-twin-stands case). Added assertions only; see item "assertions changed".
**R4-3** The `given` count in the key (`posts.service.ts` `startsWith` base) also counts reversed charges of other targets with a longer number that starts with the same digits (`edit:id:5:10` matches `edit:id:5:100`). The effect found is a fresh key (a charge where main would give a free repeat); no free edit came out of it. Not run beyond reading.

## Random races (item 1)
Two families, 700+ runs, edits 1 to 3 (identical and different lengths) against: approve, decline, CHANGE_TAG Verified, CHANGE_TAG Gossip, KEEP, SEND_TO_MODERATION, the poster's request, the poster's delete, a request opened before in half of them, delays 0 to 70 ms. Checked after each run: wallet = start minus COMMITTED charges, REVERSED charges all have a reversal txn, text new only if a 200 edit, longer text only with a live charge, no 5xx. 800 runs of the mixed set (400 + 400): 0 bad. Then 600 runs with identical edits and the ask-then-decide sequence: 79 bad, every one "longer text, no live charge". Run with the hook never changed the result classes: no 5xx anywhere, no charge for an unchanged text, no double reversal (the wallet check held in all runs).

## Item 7 and 8
- A plain post (no tag, isNews false, news with no tag, Verified direct): `201 / 201 / 422 TAG_REQUIRED / 403 VERIFIED_NEWS_FORBIDDEN`, byte for byte the same as origin/main.
- `test/units/ledger.spec.ts`: not in `git diff 9b66b7c f7f4444`; unchanged; `test/units` 6 suites, 115 passed.
- `onCreated`: only set in `posts.service.ts:461`, called at `units.ledger.ts:401`; no request body or DTO is spread into `ChargeOpts` (grep). Not reachable from a request field. One note: it is called inside the ledger transaction before commit; if that transaction then rolled back, `created` would be true with no charge (the catch would then call reverse with a charge id that is not there). Read only.
- `npx tsc --noEmit`: exit 0. eslint `{src,test}/**/*.ts`: 0 errors, 44 warnings (same as round 3).
- test/talk 11 suites 216 passed; test/units 6 suites 115 passed; test/admin 27 suites 268 passed; test/news 1 suite 12 passed; test/reach 13 suites 114 passed, 1 skipped.
- Whole API suite once: 108 suites, 1252 passed, 1 skipped, 0 failed.
- Assertions changed in `9b66b7c..f7f4444`: one removed line, `fixb-r2.spec.ts` the N-1 charge mock (`mockResolvedValue({chargeId})` to a mock that calls `onCreated` then returns the same), which is the ruling's mechanism and nothing else; the rest are added assertions (a sixth decision row and the one-notice expectation, KEEP/SEND text and no "moderation"). `fixb-r4-edit.spec.ts` is new. No other assertion changed.

## Proved by runs
R4-1 (held 2, 3, 5 and 600 plain races); N-3 builder's run, B-first run; N-4 40 races; N-5 table; N-6 100 races; N-7a; N-9 and S6 sequences; main compare of plain steps and plain posts; 800 mixed races; full suite and folders; tsc, eslint.

## Read only
`onCreated` rollback ordering; `startsWith` prefix (R4-3); migration comment change.

## Not proved
Moderator removal through the real moderation route (set by a direct write); N-7 (b), (c); two real API processes; L-3 to L-8 not retouched.
