# VOICES lead log

The lead's running record: what is merged, what is running, what waits on whom. Newest at the bottom. Any account can
continue from here: read this file, `tasks/README.md`, `DECISIONS.md` and `docs/agents/RULES.md`.

## How work runs (the Fable workflow)
- The lead orchestrates, rules and merges; it writes no feature code (the owner allowed the lead to do the repo split
  and the launch design himself, 9 Nov).
- Each bundle: one Sonnet builder on branches `v/<id>` in the repo(s) it changes, then one separate Sonnet verifier
  (T2 bundles get the money and privacy attacks), at most two fix rounds (the builder is resumed for its own fixes), then
  the lead runs `scripts/lead/fullcheck.sh <backend-ref> <web-ref> <tag>` on the joined code and merges only on every
  EXIT 0. Keep agents low (one or two at a time).
- Records: task files carry their status; this log carries the timeline; `docs/lead/polish.md` holds accepted lows;
  `docs/lead/phone-list.md` holds the checks only a real phone can prove.
- Build machine setup (fresh container): `scripts/dev/services.sh up` (installs nothing; Postgres 16 and Redis must be
  present: `apt-get install -y postgresql-16 redis-server` if not), `npm ci` in backend `api/` and in the web repo.

## Where it stands
- 5 to 7 Nov: first plan built in one repo (36 of 41 tasks; 724 server and 585 web tests; final walks passed).
- 8 Nov: the two repos created and the history split; the joint history is on the backend branch `archive/monorepo`.
- 9 Nov: REPO-SPLIT done (web stands alone, checks pass). Launch designs drawn (canvas v43, sources in
  `docs/design/launch/`). Owner answers: usevoices.com (V-35), tokens (V-36), AI fix 5 tokens (V-37, owner delegated);
  lead defaults V-38. Owner: build the launch features on this account with the Fable workflow, records in the repos.

## Timeline
- 9 Nov: baseline full check on both mains, new build machine: all 10 EXIT 0 (724 api, 585 web).
- 9 Nov 00:31 UTC: bundle B (mood: LCH-02, 04, 03) and bundle F (money: LCH-10, 12) builders started (Sonnet), branches
  v/lch-b and v/lch-f in both repos. Next: a separate verifier for each, then merge on fullcheck. A wake-up is set for
  05:33 UTC (the owner's 5-hour usage window) to resume.
