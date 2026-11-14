VERDICT: FIX
INTERIM

Checked head b505087 (matches the brief) on `verify/c22-api`. This interim file is replaced by the final report. Own PostgreSQL 16 (port 55931) and Redis (56931), real API processes (compiled `dist`), no live provider, no `.env`.

So far (RAN, real processes, old code = origin/main tree):
- A (R1): DB migrated with origin/main's `prisma/` then this branch. Orders new-old-new-old-new, with and without the start time NULLed between boots, start time moved to 5 days ago: sweeps at +31 min and +2 h reversed 0; no REVERSAL row; no free post back; all answers still there. HELD.
- B (R2): this code's orphans (answer paid, answer free-post, reply "reply" mark; write failed + reversal failed, and process SIGKILLed with the retry record left open): +29 min 0, +31 min reversed once (free post came back, dead record removed), again 0; retry with the same key = 409 CONFLICT "Start again with a new key". HELD for text answers and replies. Voice: READ only.
- C (R3, open question): when the link step (`charge.updateMany` after `write()`) throws, the post is stored, the charge stays marked and unlinked, and the sweeper at +31 min reverses it: the person keeps the post and gets the money / the free post back. Same at 4dadb23 (RAN, same result), so not a regression of this round.

Still to run: 50-posts SIGTERM/SIGKILL, replays (D), other actions (E), load (F), give-back (G), repeats and suites (H).
