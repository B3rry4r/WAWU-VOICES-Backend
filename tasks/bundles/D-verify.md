# Verifier for bundle D (load): LCH-09. Tier T2. Lead brief, 9 Nov 2026

You are the verifier: you built nothing, fix nothing; check, attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/D-load.md`, `tasks/LCH-09.md`, LAUNCH-SPEC §2 and §3,
DECISIONS V-30 and V-35, and the builder's report `docs/launch/LOAD-REPORT.md` on the branch.
Code: `v/lch-d` (backend d778965, web 8e4dfe1; main merged in). Make your own worktrees under /home/user/wt/vd-*.
Resources: ports 15000-15039, Redis db 12, Postgres databases `lchd_*` and `vd_*` (the builder has finished and dropped
its own). The builder's raw results are in `/tmp/voices-load/lch-d`; read them, never write there (use
`/tmp/voices-load/vd`).

## Order: the machine is quiet only for your first part
1. **Quiet part first.** No other agent runs until you write the file `/tmp/voices-reports/d-verify-quiet-done`
   (one line: the time and "quiet part done"). In this part run only what needs a quiet machine: one replay of the ramp
   with the harness as the builder left it (`scripts/load/run.sh`, the 5, 10 and 15 a second stages) and the shared-address
   run. Write that file as soon as these finish, even if they disagree with the report, and never later than 50 minutes
   after you start. After it, other agents share the machine: do not run load again (say so if you wanted to).
2. Then everything else below.

## Check (command, result, PASS or FAIL)
1. **The headline numbers hold.** Your replay against the report's table: 10 a second passes (p95 under 1 s, under 1%
   errors), 15 fails, and what breaks first is the voice work. Your numbers will differ a little; say by how much, and
   FAIL only if a verdict changes. Every number in LOAD-REPORT.md traces to a result file (spot-check ten).
2. **Cached guest reads never carry a person's data** (the money and privacy attacks of this bundle). Two people and two
   guests, one cache: a signed-in read is never stored or served from the shared copy (Authorization header, cookie,
   both); `Cache-Control` on every signed-in answer is private; guest A's likes (X-Guest-Id) never show for guest B;
   a person's own answer, saved and hidden people, blocks: never in a guest copy; the nginx config caches nothing it should
   not (read `infra/nginx/voices.conf`, run `nginx -t` on it). How long does a removed, blocked or deleted answer stay
   visible to guests after the action (the cache and the 30-second category counts)? Measure it; the lead decides if it is
   acceptable.
3. **The fixes are right, not only fast.** `FeedService.faces` gives the same newest 40 answerers as main (blocked,
   removed, anonymous and deleted people excluded as before; ties; fewer than 40); the category counts match main after the
   30 s; the share card from `renderAsync` is the same picture as main's (pixel compare, three sizes, name on and off);
   transcription still reaches every voice answer in production mode and its failure path is unchanged; `FFMPEG_NICE`
   off outside production; recordings sound the same (byte or waveform compare of one recording, main against branch).
4. **The new limits.** Each value in the report's limits table matches the code and the nginx config. Abuse from one
   address is still stopped for every limit (the 301st invite lookup, the 301st handle check, the 1,201st route call, the
   nginx burst), per-person limits unchanged. The busy answer (`api/src/common/busy/busy.ts`): never fires under normal
   load or in tests; when it fires the person sees the plain page with Retry-After; nginx 502, 503 and 504 show
   `infra/nginx/busy.html`.
5. **Existing tests changed (five, listed in the report).** For each: the old and new assertion; only values the new
   limits changed; the abuse boundary is still tested. Anything else changed in an existing test is a FAIL.
6. **Infra.** `provision.sh`, `deploy.sh`, `RUNBOOK.md`, env examples: valid, idempotent, nothing secret, the droplet still
   provisions from empty (read through; `bash -n`). `THROTTLE_LIMIT` default 1200 in `app.module.ts` matches the report.
7. **The busy page**: 390 light and dark, 1440 (`/tmp/voices-shots/vd/`); the words exactly "We are busy. Try again in a
   minute."; no em-dashes; curly quotes; nothing else on it a person could tap that does nothing.
8. **Regression**: bundles A, A2, B, C, E, F hold on this branch (their own specs, and one walk of /go, posting, a token
   payment on the stand-in, the share page).
9. **Checks** to EXIT lines on both branches: eslint, tsc, build, the full api suite on a fresh database, web tsc, lint,
   vitest, build, `sync:shared --check`.

Report: `/tmp/voices-reports/v-lch-d.md`, written as you go. Hand back in 8 lines: verdict, SERIOUS and MEDIUM findings
with steps, the replay numbers beside the report's, anything NOT RUN with the reason. Clean up your worktrees, stacks,
nginx site, `vd_*` and `lchd_*` databases, Redis db 12.
