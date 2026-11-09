---
id: REPO-SPLIT
title: Split VOICES into the two GitHub repositories
area: OPS
priority: launch, first
tier: T1
repo: WAWU-VOICES-Web + WAWU-VOICES-Backend
status: done (8 Nov 2026)
depends_on: []
decisions: []
boards: []
---
# REPO-SPLIT · Two repositories

The code is one repository today (web/ and api/ side by side). It goes into B3rry4r/WAWU-VOICES-Web and
B3rry4r/WAWU-VOICES-Backend, with history.

## Build
- Web repo: the history of web/ (git subtree split). The web reads two files from outside web/ today:
  web/src/features/legal/load.ts reads ../docs/legal/*.md, and the api:types script reads ../docs/contract/openapi.yaml.
  Copy docs/legal into the web repo (for example web content/legal) and point load.ts at it; keep a copy of the contract
  for api:types, refreshed from the backend repo by a script. web/e2e/record.e2e.ts imports from ../../api: move that
  test to the backend or give it its own copy of the helper.
- Backend repo: everything else (api/, docs/, infra/, scripts/, tasks/, DECISIONS.md, README.md), history kept.
- infra/deploy: deploy the two checkouts on the droplet (web from one, api from the other).
- Both repos: every check to an EXIT line (api eslint, tsc, test, build; web lint, tsc, vitest, build).

## Done when
- Both repos build and pass from a fresh clone; the legal pages render; the deploy script works on a test droplet.

## Done (8 Nov 2026)
- The owner created the two repos; the lead split the history (web: git subtree split of web/; backend: everything else,
  web/ filtered out) and pushed both. The joint history is on this repo's `archive/monorepo` branch.
- Web repo: `content/legal/` (copies of docs/legal), `contract/openapi.yaml`, `e2e/vendor/` (the audio helper), a
  `sync:shared` script with `--check`, its own CI and deploy workflows, a README. load.ts, the legal test, api:types and
  the e2e import point at the copies (the legal test's folder path changed with the move; nothing else in a test changed).
- Web checks: lint 0, typecheck 0, 585 tests 0, build 0 (legal pages build with their text).
- This repo: its deploy already handled a repo with only api/ (the web jobs skip); README and RUNBOOK updated.
- Done by the lead at the owner's word (no agents, 9 Nov); no separate verifier ran.
