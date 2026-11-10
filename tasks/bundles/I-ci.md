# Bundle I (GitHub checks and the deploy workflows work before the first deploy). Tier T1. Lead brief, 10 Nov 2026

Builder: one Sonnet agent. Branches `v/ci-fix` in both repos, from origin/main (backend 985cce1 or later, web a29f851).
Read `docs/agents/RULES.md`, `infra/RUNBOOK.md` (section 7: the owner's first deploy runs these workflows) and both
repos' `.github/workflows/`. Resources: ports 15000-15019, Redis db 10, Postgres databases `vi_*`.

What the lead found on GitHub (10 Nov), after every merge so far was checked only by `scripts/lead/fullcheck.sh`:

| # | Finding | Fix |
|---|---|---|
| I1 | Backend: GitHub cannot read either workflow. Every run of `ci.yml` and `deploy.yml` fails at once with no job (Actions lists them by path, not by name). Both still carry the monorepo's `web` job and a job-level `if: hashFiles(...)`, which GitHub does not allow there. So CI has never run on the backend repo and the owner's first deploy (RUNBOOK section 7) would fail. | Both workflows valid for this repo alone: the api jobs only, no `hashFiles` in a job `if`, nothing else changed in what they run or deploy (the deploy job's steps, secrets, host-key pinning, smoke test and concurrency as they are). Proof: a push of `v/ci-fix` runs CI green on GitHub (its run and job ids in your hand-back); `deploy.yml` is listed by its name and its test job runs (on a `workflow_dispatch` from the branch the deploy job is skipped, as the file says). |
| I2 | Web: GitHub's runner fails `tests/date-format.test.ts` (2 tests): `clock("2026-11-04T23:39:00Z")` gives "0:39am" where the boards write "12:39am" (also "6 Nov 2026, 0:30am"). `src/lib/format/date.ts` asks Intl for `hour12: true`, which some ICU builds turn into the h11 cycle (0 to 11). People's browsers vary the same way, so a person could see "0:39am". The deploy workflow's test job fails on this too. | Ask Intl for the 12-hour cycle that has 12 (`hourCycle: "h12"`) wherever the app writes a 12-hour clock, and the same for any other 12-hour format in the web; the test unchanged. Proof: the test passes locally under `TZ=UTC` and under an ICU that picks h11 if you can reproduce one (say how), and CI green on GitHub on the branch. |

## Checks
Every existing check EXIT 0 locally on both branches (backend eslint, tsc, build, the full api suite on a fresh database;
web lint, typecheck, vitest, build, `sync:shared --check`), and the GitHub runs above green. Hand back in 6 lines with both
heads and the GitHub run ids.
