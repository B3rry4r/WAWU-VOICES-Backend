# VOICES agent rules (builders and verifiers). Read in full.

Two repositories (since 8 Nov 2026), both on GitHub:
- B3rry4r/WAWU-VOICES-Backend: `api/` (NestJS 11, Prisma 7), `docs/` (contract, legal masters, launch spec, design
  sources), `infra/`, `scripts/`, `tasks/`, `DECISIONS.md`.
- B3rry4r/WAWU-VOICES-Web: the Next.js 14 web app at the repo root. It keeps copies of a few backend files
  (`npm run sync:shared`, see its README).
Main clones on the build machine: /home/user/wawu-voices-backend and /home/user/wawu-voices-web (the lead's; never
commit in them). Work in your OWN worktrees under /home/user/wt/<task-id>-backend and /home/user/wt/<task-id>-web made
from origin/main (`git worktree add -b <branch> <dir> origin/main`), symlink node_modules from the main clones
(`api/node_modules`, web `node_modules`), and remove the worktrees at the end. Branch names: `v/<task-id>` in each repo
you change. Push your branches to origin; never push to main.

READ FIRST: `DECISIONS.md` (rulings V-n outrank everything else), `docs/WORKFLOW.md`, your task files in `tasks/`,
`docs/launch/LAUNCH-SPEC.md` and `docs/launch/PRICING.md` for launch work.

DESIGN: the boards are the authority for every screen. Launch boards: `docs/design/launch/*.dc.html` (source of the
canvas https://claude.ai/artifact/VgC2xwJ9ubB9qnbG1CbX2v, anyone with the link can open it). Their text, sizes, colours
and tokens are exact; read the source. Tokens: `docs/design/ds/tokens.css`; components: `docs/design/ds/index.d.ts`.
The web app already ships the same design system (web `src/`); reuse its components and classes, never fork one.

SERVICES: `scripts/dev/services.sh up` (Postgres 14001, Redis 14002) is shared: never run `down`. Use only the ports,
Postgres databases and Redis db your brief names; FLUSHDB only your own Redis db, never FLUSHALL. Stop only PIDs you
started; never kill by name.

STAND-INS ONLY: never call live Flutterwave, WAWU ID, Gemini or Spaces from tests or browser runs. Build the web with
every NEXT_PUBLIC_* base pointed at your local stand-ins before any browser run, and grep the built bundle for
`wawuafrica.com` and `usevoices.com` hosts first.

QUIET OUTPUT: run long commands as `cmd > <log> 2>&1; echo EXIT $?` and read only the tail; gate on the EXIT line.

NEVERS: never stash, reset --hard, checkout -- ., rebase, amend or force-push; undo by re-editing. Never edit a test,
gate or baseline to make a check pass (an existing test changes only where a ruling changes its value: list each). Never
commit a secret or a .env. Never touch the WAWU Hub, its droplet, database, website or dashboard. No em-dashes in any
user-facing copy, curly quotes and apostrophes, British spelling, never the word "Rant", never "wallet" for tokens.
No mocks on real paths: the web calls the API through `src/lib/api` only; fixtures live only in tests.

CHECKS before you hand back, each to an EXIT line: api `npx eslint "{src,test}/**/*.ts"` (no --fix), `npx tsc --noEmit`,
the full `npm test` on a fresh database, `npm run build`; web `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build`; and `npm run sync:shared -- --check` in the web worktree with VOICES_BACKEND_DIR at your backend worktree.
PICTURES: every screen you touch at 390 light and dark and 1440, beside its board, in the folder your brief names. Look
at each one.

COMMITS end with:
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

HAND-BACK, 10 lines or fewer: branches and heads, what is done (task ids), checks with EXIT lines, pictures N of N
(folder), defaults you took, anything not done.
