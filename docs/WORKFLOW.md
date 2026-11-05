# How VOICES is built (the Fable workflow, VOICES edition)

Separate from WHO MADE THIS? (V-6). Records: this repo's DECISIONS.md and tasks/; the lead's log; the VOICES status page.

## Roles
- The lead plans, cuts tasks, rules, merges and keeps the records. The lead writes no task code.
- Builders and verifiers are Sonnet agents. The session that builds a task never verifies it.
- Up to 8 agents at once on the machine (15 GB, 4 CPUs): keep all 8 slots busy while there is ready work.

## Tiers (first line of every brief)
- T0 Lean: copy, records, config, seed data, generated files. One run, ~25 steps. Checks: the affected tests and typecheck. The lead reads the diff. No verifier.
- T1 Plain: screens with no money, endpoints with no money, components, hardening. One run per bundle. Checks: affected tests, typecheck, lint; every screen pictured at 390 x 844 (light and dark) beside its canvas artboard, and 1440 for its desktop board. Lean verifier: claims list, tests, pictures beside the artboard, every drawn state, nothing drawn that is not built.
- T2 Money and identity: Voice Units ledger, purchases, tokens, sign-in, roles, deletes, migrations on money tables. Full verifier with the money attacks: twice, double tap, short balance, verify replay and forged references, reconcile, ledger equals provider record.
- Fix rounds: blocker, high and medium get a round (a patch brief naming finding ids, re-check of those ids), at most 2 rounds, then the lead rules. Low goes to the sweep list. A fix of 30 lines or fewer closing named findings may be accepted on the lead's diff read.

## Bundles
One builder per flow: 2 to 5 tasks of one area sharing a pattern or screen group, one branch named after the bundle, the commit names every id. One verifier per bundle. Shared files (api/src/app.module.ts, api/prisma/schema.prisma, web/src/app/layout.tsx, the design-system components, the contract) are fenced: a bundle that needs a change there says so in its hand-back, and the lead runs one SHARED pass per wave.

## Checks
- Affected tests always, quiet output, gate on the EXIT line.
- Full api suite, web typecheck, lint and build in CI on every push (GitHub Actions, once the GitHub repo exists; until then the merge agent runs them locally).
- Pictures: every screen a task touches, 390 x 844 light and dark, next to its artboard from the canvas; desktop 1440 once per screen.
- Phone paths are tested as a phone: recording, playback, uploads, mic permission, back, keyboard, offline. What only a real phone can prove goes on the owner's phone list before the walk.

## Batches and merges
A batch opens at 6 checked tasks or 6 hours, money first. The merge agent stacks the batch, runs migrations, the full api suite, web build and the picture set, then the lead merges to main. One batch at a time.

## Release
A full walk (guest, new user, poster, voter, payer, admin, on real phone browsers) on the exact code before release, then the owner's word, then the deploy to the VOICES droplet.

## What goes to the owner
Only: a money figure the designs and rulings do not give; a legal, licence or brand word; a key, account or billing setting only the owner holds; a destructive change to real money or data; a change to a rule the owner made. Everything else is the lead's: pick the default the design, the facts or the safest behaviour give, record "Lead default, owner may override", continue.

## Nevers
Never stash, reset --hard, rebase, amend or force-push. Never edit a test, gate or baseline to pass. Never commit a secret. No em-dashes in user copy; never the word "Rant". Never touch the WAWU Hub, its droplet, its database or the WAWU website from VOICES work.
