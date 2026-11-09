# Verifier for bundle A (go): LCH-01, LCH-08, the cleanup fix. Tier T1. Lead brief, 9 Nov 2026

You are the verifier: built nothing, fix nothing; check, attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/A-go.md`, the task files LCH-01 and LCH-08,
LAUNCH-SPEC §1 to §3, DECISIONS V-30 and V-35, and the boards Go-390, Landing-390, Landing-1440.
Code: `v/lch-a` (backend 6314808, web 7949a14). Worktrees /home/user/wt/va-backend and /home/user/wt/va-web; resources:
ports 15040-15059, Redis db 11, Postgres databases `va_*`.

Lead rulings already taken: the “@ada.okafor asked how you feel.” line is left for a follow-up after bundle C merges;
the /go bottom line keeps “Community rules, Terms and Privacy” (Privacy is always linked).

## Check
1. LCH-01: the words exactly as LAUNCH-SPEC §1 everywhere the old headline or intro was (pages, titles, share metadata,
   any email or notification); no old string left; curly apostrophes; no lone word at 390.
2. /go as Go-390 draws it: guest and signed in; a word tap opens the pick with that word chosen and survives sign-up
   (do it end to end in a browser); a non-mood question; the 1440 layout (the builder’s default: one centred column).
3. The address: grep both repos and both built bundles: no voices.wawuafrica.com outside history notes; share links,
   cards, emails, payment return URLs and customer emails use usevoices.com; nginx and certbot take VOICES_DOMAIN;
   does www.usevoices.com work or redirect to the apex? (if not, say so: the broadcast text is “usevoices.com/go” but
   people type www); RUNBOOK steps for DNS, TLS, the WAWU ID allowed origin and Spaces CORS are right and complete.
4. The cleanup every 60 s keeps the privacy line “up to 10 minutes” true (prove the worst case).
5. Existing tests changed (9 backend specs, web w1-entry): only values the ruling changed.
6. Regression: bundles B and F hold on this branch; Landing still links Sign in and Join.
7. Checks to EXIT lines on both branches. Pictures: the builder’s 7 in /tmp/voices-shots/lch-a/ and your own of /go at
   390 light and dark.
Report: /tmp/voices-reports/v-lch-a.md as you go. Hand back in 8 lines. Clean up worktrees, `va_*`, Redis db 11.
