# Verifier for bundle F (money): LCH-10, LCH-12. Tier T2 (money). Lead brief, 9 Nov 2026

You are the verifier. You built nothing, you fix nothing: you attack, report and give a verdict MERGE or FIX. No commits,
no pushes. Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/F-money.md` (its "Verifier attacks" list is
yours), the task files LCH-10 and LCH-12, `docs/launch/PRICING.md`, DECISIONS V-8, V-36, V-37, V-38 and the boards
BuyTokens-390 and FixText-390 in `docs/design/launch/`.
Code: branches `v/lch-f` (backend abeff18, web 5781c5e) against origin/main. Worktrees /home/user/wt/vf-backend and
/home/user/wt/vf-web; resources: ports 15040-15059, Redis db 11, Postgres databases `vf_*`.

## Attack (each with the command, the result, PASS or FAIL)
1. Prices: every pack, every text length (149, 150, 151, 500, 5,000, 5,001 characters, emoji, combining marks, Yoruba
   and Igbo diacritics: the same count on web and server), voice at 10, 30, 31, 60 and 61 seconds. Free posts: a 10 s
   voice and a 500-character text are free while any are left; the builder’s default “a longer one pays in full and keeps
   the free post”: say if anything about it can be abused.
2. Charged only on send: a failed upload, a refused post, a cancelled recording, a removed post: never charged, or
   refunded exactly once. Double taps and 20 parallel posts: one charge each, the ledger balanced.
3. The 20-a-day limit: answers and replies count, nothing else does; 20 parallel at 19 used; the midnight Lagos boundary
   (move the clock); the plain message.
4. Fix my text: 5 tokens once per Idempotency-Key under 20 parallel calls, never on a failure, an empty change free;
   the meaning guard (can a larger change slip through, can a normal typo fix be refused?); rate limit; nothing about
   the text stored beyond what the privacy line says.
5. Payments with the stand-in: success, pending, failed, cancelled, overpay, underpay, two tabs buying one pack, the
   reconcile job; old Extra voice tokens still honoured, POST /payments EXTRA_VOICE refused 422; the books balance.
6. Existing tests: the builder changed many (api: units, payments, wf6a, shared1a, shared2, ops, me, talk, media,
   tokens.int, feed, payments-privacy; web: units-screens, units-format, talk, w4-speak, wf6b, w1-entry, w5-vote, w6,
   home-redraw). Read every diff: each change must follow a ruling (V-36 name, V-38 prices) and must not weaken a check.
   Name any that does.
7. Words: no “wallet” for tokens anywhere a person reads (the builder says “Wallet history” was re-worded: check), no
   “Voice Units” left on any screen, receipt, notification or email, no em-dash, curly quotes, British spelling.
8. Legal: the builder’s changed lines in docs/legal (terms, refunds, privacy) and CLAIMS.md: each matches the code.
9. Pictures: compare the builder’s 9 in /tmp/voices-shots/lch-f/ with the boards (two were never looked at by the
   builder); take your own of Buy, Fix my text and the daily-limit message at 390 light and dark.
10. Checks to EXIT lines on both branches (RULES.md list).

Report: /tmp/voices-reports/v-lch-f.md, written as you go. Severity per finding, file:line, the rule broken.
Hand back in 10 lines: verdict, findings, EXIT lines. Clean up: worktrees, `vf_*`, FLUSHDB db 11, your PIDs.
