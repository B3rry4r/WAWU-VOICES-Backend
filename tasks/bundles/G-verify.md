# Verifier for bundle G (the walk's fixes). Tier T2 with the money attacks. Lead brief, 9 Nov 2026

You are the verifier: you built nothing, fix nothing; check, attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/G-walkfix.md`, the three walk reports
(`docs/lead/reports/walk-a.md`, `walk-b.md`, `walk-c.md`), DECISIONS V-36 and V-40.
Code: `v/walk-fix` (backend 972afd8 on main a27dbfc, web c199532 on main e457dea). Your own worktrees /home/user/wt/vgv-*.
Resources: ports 15000-15019, Redis db 10, Postgres databases `vgv_*`. Other agents use 16040-16059.

## Check (command, result, PASS or FAIL)
1. Each row G1 to G9 as the brief's table says, on production builds behind the repo's nginx with stand-ins, in a
   browser. G1: stop the API, make it answer busy, and make it fail with a 500: only the first two show the busy words.
2. Money (G4, G5, G6): receipts say tokens everywhere a person reads; an old `VU-` receipt still opens; 20 parallel payment
   starts let exactly the limit through and 8 parallel starts on one key make one payment; a Fix my text replay of the same
   key is not counted and a different key is; the ledger still balances after your runs.
3. G3 (V-40): suspend from a post takes it down; from an account item removes nothing; a winning appeal puts the post back;
   the moderator who acted cannot decide the appeal; wrong roles refused.
4. G8: reproduce the walkers' 200 if you can (their notes are in walk-b.md and walk-c.md: the stack settings, nginx, the
   API base the web was given). Say whether it is real on a production setup; the builder pinned 404 with tests.
5. Existing tests changed (payments VU- to VT-, wf6b 503, lch-a2 and w1-entry queries): only what a row changed. The 1440
   card repeats the headline in the page: is the copy that is not shown hidden from screen readers too?
6. Pictures: every touched screen at 390 light and dark and 1440, beside its board (cards, cover, Go, onboarding, receipt,
   busy, moderation, Explain my vote); the builder left Explain my vote, the Ads form and dark moderation NOT RUN: take them.
7. Regression: bundles A to F hold (their specs in the full suite, and one walk of /go, a token payment on the stand-in,
   the share page).
8. Checks to EXIT lines on both branches: the full api suite on a fresh database, eslint, tsc, build; web lint, typecheck,
   vitest, build, `sync:shared --check`.
Report: `/tmp/voices-reports/v-walk-fix.md`, written as you go. Hand back in 8 lines. Clean up worktrees, `vgv_*`, Redis
db 10.
