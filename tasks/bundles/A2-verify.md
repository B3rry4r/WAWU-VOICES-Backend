# Verifier for bundle A2 (follow-ups). Tier T1, with a privacy attack on the new public route. Lead brief, 9 Nov 2026

You are the verifier: you built nothing, fix nothing; check, attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/A2-followup.md`, the reports `docs/lead/reports/v-lch-a.md`
and `v-lch-c-round2.md`, LAUNCH-SPEC §1 to §3 and §7, DECISIONS V-35, the boards Go-390 and Landing-390.
Code: `v/lch-a2` (backend a1a4d78, web 7112ab2, on main 72e01f7 / b12a833). Worktrees /home/user/wt/va2-backend and
/home/user/wt/va2-web; resources: ports 15040-15059, Redis db 11, Postgres databases `va2_*`. Bundle E builds at the same
time on 15000-15019 and db 12.

## Check (command, result, PASS or FAIL)
1. Contract: `python3 docs/contract/src/build.py <tmp>` then `diff <tmp> docs/contract/openapi.yaml` prints nothing; the
   yaml differs from main only by the new GET /invites/{code} and whitespace re-wraps (show the diff); the web's generated
   types match the yaml.
2. www.usevoices.com: read the nginx site and provision.sh: www answers 301 to https://usevoices.com with path and query
   kept, certbot covers both names (and an existing apex certificate gains www), the RUNBOOK DNS step has the www record.
   If nginx can be installed or run in a container here, prove the redirect live; otherwise say NOT RUN and why.
3. Guest Write: at 390 in a browser, as a guest, /go, pick a word, Type it instead, the Sign in button, sign in (stand-in),
   back on Write with the word and the composer; a typed draft before sign-in (kept or not: say which, and whether a
   guest loses text without warning); the other guest screens unchanged.
4. Onboarding: /join slide 1 has the LAUNCH-SPEC §1 words exactly; no "Nigeria is talking" left anywhere (grep both repos
   and the built bundle).
5. Invited-by line, attack it: GET /invites/{code} returns the handle only (no id, name, avatar, counts); a suspended,
   deleted or anonymous-only inviter and an expired or unknown code return null; the rate limit holds (61 in a minute
   from one address) and per-address on a shared network is acceptable at broadcast scale (judge it); enumeration: can
   anyone list handles by walking codes faster than the limit, and does the response time differ between good and bad
   codes; the cookie is never sent when malformed; the line text is exactly as Go-390 draws it; no line on a bad code.
6. Existing tests changed: only the three w1-entry lines (the slide's words changed by the ruling). Anything else is a FAIL.
7. Regression: bundles A, B, C, F hold (landing words, /go, mood, where you sit, invites and friends, prices, Fix my text).
8. Checks to EXIT lines on both branches. The builder's full api run had one failure: test/feed/ranking.spec.ts worst
   latency 248 ms against 200 ms while another agent's tests ran. Run that spec alone and the full suite on a fresh
   database; if it fails only under another agent's load, say so with both numbers.
9. Pictures: the builder's 9 in /tmp/voices-shots/lch-a2/ beside the boards (render the Go-390 board source), and your
   own of /go with the line and the guest Write at 390 light and dark.
Report: /tmp/voices-reports/v-lch-a2.md, written as you go. Hand back in 8 lines. Clean up worktrees, `va2_*`, Redis db 11.
