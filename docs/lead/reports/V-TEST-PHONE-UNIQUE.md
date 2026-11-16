# V-TEST-PHONE-UNIQUE

## Cause
`api/test/me/helpers.ts` line 60 gives every test person the phone `+234801` + 4 digits + `000`. That is only 10,000 numbers.
`test/admin/fixc.spec.ts` signs up 26 people between two truncates: 6 staff from `world()` (fixed subs, all different digits) and 20 with a random sub (`fixc-<n>-<uuid>`: 6 in the first set-up, 14 in the weekly report set-up).
The chance that two of the 26 get the same 4 digits is **3.06% per run** (exact). A simulation of 2,000,000 runs gave 3.04%. Roughly one run in 33 fails.
People from earlier specs are not part of it: `world()` empties the user table when the spec starts.
I did not loop the old spec until it failed (about 33 runs expected); the numbers above are the proof.

## Other specs with random or time based subs
None sign people up through `POST /me` except fixc. Checked every spec that calls `signUp`, `h.token` or `jwks.sign` and also uses `randomUUID`, `Date.now` or `Math.random`.
- `shared/shared1a.spec.ts` (item 11) uses a random sub but already passes its own random 8 digit phone. Chance of a clash is below 0.1% per run. Left as it was (see below).
- The `ghost-` and `nobody-` subs (dm, talk, media, shared1a) never sign up.
- reach, vote, payments, talk, shared2 and results insert users with SQL and only sign tokens. No phone claim is used.

## Change
`api/test/admin/fixc.spec.ts`, 3 lines added in `mk` (around lines 25 to 35): a counter `phoneSeq`, and `{ phone: "+234809" + (1_000_000 + ++phoneSeq) }` passed to `signUp`. Subs unchanged. Helper unchanged. No assertion touched. No product code.
Second run on the same database passes: the spec's `world()` truncates the user table first, so the counter starting again at +2348091000001 is free.

I first changed `shared1a.spec.ts` the same way. That broke a second run (the spec leaves its people behind, so the same number gave 409). I put it back as it was (second commit).

## Runs
- fixc: 30 of 30 passed, back to back on one Postgres 16 database (no reset in between) with Redis on port 14002 (`REDIS_URL=redis://127.0.0.1:14002/4`).
- shared1a (the other file I touched, now unchanged from main): 5 of 5 on a fresh database.
- Whole `npm test`, in band, fresh database and empty Redis: 177 of 177 suites passed, 2906 tests passed, 1 skipped (already skipped on main), 2907 in all. The audio tests: 13 of 13.
- `npx tsc --noEmit`: clean. eslint without `--fix` on fixc.spec.ts and shared1a.spec.ts: clean.

## What I could not prove
- In an earlier full run, two `shared2.spec.ts` tests failed ("moderation rows carry postKind" and "needs no per-row detail call"). They pass alone on a clean Redis (twice) and in the clean full run. They fail when Redis db 4 already holds keys from earlier runs. I did not find which keys. I did not run main itself; the branch differs from main only in fixc.spec.ts, which shared2 does not use.
- I did not reproduce a real fixc failure on the old code.
- Commit trailers use the model and session from my own harness, not the ones in the brief.
