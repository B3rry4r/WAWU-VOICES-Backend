# Verifier for bundle C (share): LCH-06, LCH-05. Tier T2 (privacy). Lead brief, 9 Nov 2026

You are the verifier: you built nothing, fix nothing; attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/C-share.md`, the task files LCH-05 and LCH-06,
LAUNCH-SPEC §6 to §8, DECISIONS V-31 and V-35, the boards YoureLive-390, YoureLive-390-first, Friends-390, MoodPick-390.
Code: `v/lch-c` (backend d42b105, web 7272910; main with bundle F merged in). Worktrees /home/user/wt/vc-backend and
/home/user/wt/vc-web; resources: ports 15040-15059, Redis db 11, Postgres databases `vc_*`.

## Attack (command, result, PASS or FAIL)
1. Privacy: can anyone but the inviter learn a friend’s word or that they answered? Every route (GET /me/friends as
   someone else, answers, profiles, share pages, admin as each role, export of another person). A friend who turns
   “Share my word” off: the word gone at once (cached anywhere?).
2. Claim abuse: claim your own code; claim two codes (first wins); claim after answering; an old account claiming to
   be counted (the builder counts only accounts under 30 days with a published answer: judge that rule); 20 parallel
   claims; guessing codes (7 characters: entropy, rate limits on claim and lookup, enumeration through /go/<code>
   redirects or timing).
3. Export and purge: the invite code and who invited whom in the export; the deletion purge removes links both ways;
   a deleted inviter’s friends, a deleted friend’s inviter.
4. Share screen: the message text exactly (LAUNCH-SPEC §6), the WhatsApp link and the sms: body encoded on the
   Android and iPhone forms; nothing sent without a tap; no contacts API anywhere; the QR decodes to the personal link;
   the before-50 version; no tab bar; the Friends screen and its WhatsApp text (the builder’s default).
5. /go/<code>: keeps the code 30 days, first link wins, redirects to /go; a bad code; the cookie holds only the code.
6. Regression: bundle B (mood words, where you sit, card name switch) and bundle F (prices, 20 a day, Fix my text)
   still hold on this branch; the Posted screen for a non-mood answer unchanged.
7. Legal: the privacy.md lines and the six CLAIMS rows match the code.
8. Pictures: the builder’s 12 in /tmp/voices-shots/lch-c/ against the board sources; your own of You’re live and
   Friends at 390 light and dark.
9. Checks to EXIT lines on both branches.
Report: /tmp/voices-reports/v-lch-c.md, written as you go. Hand back in 10 lines. Clean up worktrees, `vc_*`, db 11.
