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
- 9 Nov 01:03 UTC: bundle B built (backend 94c2df7, web 0d9bea2 on v/lch-b): migration 20261110000000_mood_words, mood
  required on mood questions, word on every answer shape and ?mood= filter, where-you-sit in Redis (50 floor, Nigeria and
  World), mood card in 3 sizes (/share/{code}/square new), name only with the switch, seed:launch puts the question on
  15 Nov (replaced question kept in the spare bank). 743 api, 599 web, all EXIT 0; 13 pictures. Builder defaults to
  check: Posted keeps old share buttons (LCH-05), no Share-my-word switch yet (LCH-06), web base address on the card
  (LCH-08). Verifier V-LCH-B started (Sonnet; brief tasks/bundles/B-mood-verify.md).
- 9 Nov (early hours) UTC: both agents (bundle F builder, bundle B verifier) stopped at the owner's 5-hour usage limit (reset
  04:50 UTC). F's uncommitted work survived in /home/user/wt/lch-f-{backend,web}. 05:34 UTC: both resumed with
  their saved context; F told to commit and push v/lch-f after each working step.
- 9 Nov 05:36 UTC: V-LCH-B verdict FIX (report docs/lead/reports/v-lch-b-round1.md): MEDIUM explain-my-vote
  posts a wordless answer on a mood question; MEDIUM toggling the card name does not redraw the stored 1200x630 card.
  Lows to polish.md; the domain (LCH-08) and the Posted tab bar (LCH-05) belong to later bundles. All checks EXIT 0.
  Fix round 1 sent to the B builder.
- 9 Nov 05:37 UTC: bundle F built (backend abeff18, web 5781c5e on v/lch-f): 7 packs, text 5 per 150
  characters, voice 78/100, 20 a Lagos day (429 DAILY_LIMIT_REACHED), extra voice no longer sold, POST /text/fix 5
  tokens once per Idempotency-Key with a meaning guard. All EXIT 0. Legal lines changed in terms, refunds, privacy (owner
  to approve). Many existing tests changed by the price and name rulings: the verifier reads each. V-LCH-F (T2) started
  (brief tasks/bundles/F-money-verify.md).
- 9 Nov 05:48 UTC: bundle B fix round 1 back (backend 519760a, web 5643b40): explain-my-vote needs a word on
  a mood question (api + web picker); the name switch resets every stored card at once (no re-POST needed); 745 api,
  all EXIT 0. Builder noted a draw-in-flight race that could store a named card after the switch: lead ruled to close
  it in the same round (store only if the card setting is unchanged). Then the verifier re-checks (round 2).
- 9 Nov 05:55 UTC: V-LCH-F (T2) verdict FIX (report docs/lead/reports/v-lch-f-round1.md). Money held under
  every attack (ledger, 20 a day under 20 parallel, Lagos midnight, idempotency, refunds, payments, books balanced);
  774 api, 593 web, all EXIT 0; test changes all follow V-36/V-38. Must fix: F1 30.0-30.5 s voice shown 78 charged 100;
  F2 fix results kept 24 h, not purged; F3 "Voice Units" left in privacy.md; F4 meaning guard weak both ways. Lead
  rulings LF (one cost function with a 500 ms grace both sides; fix results 10 min + cleanup + purge + privacy line;
  guard rebuilt on a 40-pair labelled set) and 8 lows; fix round 1 sent to the F builder.
- 9 Nov: owner asked about launching Who Made This (the WAWU Expo app) as a web app by Wednesday. Lead checked:
  the web export (expo export --platform web) on wawu-wmt-mobile main 446ed24 builds (EXIT 0, 8.9 MB main bundle) and the welcome
  screen renders at 390 and 1440 with no errors (phone layout stretched at 1440). Answer given: Expo web by Wednesday
  is feasible (quick desktop layout; designed desktop after); upgrading the old WAWU website is weeks. Waiting on the
  owner: address, desktop choice, which account.
