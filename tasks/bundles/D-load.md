# Bundle D (load): LCH-09 ready for a 1-million-person broadcast. Tier T2. Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-d` in the repos you change, from origin/main (bundles A, A2, B, C, E, F merged).
Read `docs/agents/RULES.md`, `tasks/LCH-09.md`, LAUNCH-SPEC §2 and §3 (the broadcast and /go), DECISIONS V-30 and V-35,
`infra/` (nginx site, provision.sh, systemd units, RUNBOOK). Resources: ports 15000-15019, Redis db 12, Postgres
databases `lchd_*`. The lead starts you when no other agent runs, so your numbers are not skewed; still never touch other
agents' ports or databases, never run services.sh down, never FLUSHALL.

## The question to answer
The broadcast text sends people to usevoices.com/go. The launch droplet is planned at 4 GB / 2 vCPU (provision.sh). How
many people can arrive at once before anything slows past 1 s (p95) or fails, what breaks first, what fixes move that
line, and what wave size and droplet size the owner should choose.

## Build
1. A repeatable load test in the repo (`scripts/load/`, plain Node or autocannon via npx; no paid service) of the real
   production builds (api `npm run build` then node dist; web `next build` then `next start`) behind nginx with the
   repo's own site config (install nginx with apt-get if missing; local ports, no TLS). Pin the app processes to 2 CPUs
   (`taskset -c 2,3`) to stand in for the droplet, and the load generator to the others. Seed the launch question and
   realistic data (thousands of answers, voices, votes) in `lchd_*`.
2. The broadcast path as a mix: guest /go, pick a word, the question page, listening to voices, sign-in return through
   the WAWU ID stand-in, posting (text and voice), where you sit, the share page and its card image, /go/<code>. Say the
   mix and why. Ramp until p95 passes 1 s or errors pass 1%; record requests a second, people at once, p95 per path, CPU
   and memory per process, database connections, Redis.
3. Shared addresses: many Nigerian mobile users reach us from one carrier address. Test the nginx limit (20 a second per
   address, burst 40) and every per-address limit in the app (claim, invite lookup, share page, sign-in, listens) with
   load from a few addresses. Recommend safe values that still stop abuse; change them only with numbers.
4. Fix what breaks first, then the next, each with before and after numbers: cached guest reads (today's question, /go,
   share pages, card images: never a signed-in page or a person's own data in a shared cache; prove it), database pool,
   nginx upstream keepalive and gzip, Next caching, Redis use.
5. A plain busy page when full: "We are busy. Try again in a minute." (nginx error_page for 502/503/504 and the app's own
   overload answer), at 390 light and dark, no em-dashes, curly quotes.
6. WAWU ID: never load the live one. Measure the stand-in path only, and write the owner question: how many sign-ups a
   minute can WAWU ID take, and the sign-ups a minute each wave needs.
7. `docs/launch/LOAD-REPORT.md`: the numbers, the first thing that breaks, the fixes with before and after, and the
   owner's choices: wave size (for example 100,000 an hour; state the click-through and arrival assumptions), the droplet
   size, and what to watch on the day. Plain words first, tables after.

## Tests
The busy page; cached guest reads never carry a person's data (two people, one cache); the per-address limits hold for
abuse and pass a shared address at the planned rate; every existing check still EXIT 0. Pictures: the busy page at 390
light and dark and 1440, in `/tmp/voices-shots/lch-d/`.
Hand back per `docs/agents/RULES.md`, with the headline numbers in the first line.
