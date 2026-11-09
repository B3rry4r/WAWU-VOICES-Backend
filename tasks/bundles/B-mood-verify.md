# Verifier for bundle B (mood): LCH-02, LCH-04, LCH-03. Tier T1. Lead brief, 9 Nov 2026

You are the verifier. You built nothing. You fix nothing: you check, attack, report and give a verdict MERGE or FIX.
No commits, no pushes. Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/B-mood.md`, the three task files,
DECISIONS (V-31, V-35 to V-38) and the boards in `docs/design/launch/`.
Code: branches `v/lch-b` (backend 94c2df7, web 0d9bea2) against origin/main. Worktrees /home/user/wt/vb-backend and
/home/user/wt/vb-web; resources: ports 15040-15059, Redis db 11, Postgres databases `vb_*`.

## The builder's claims to test (do not take any on trust)
- Migration `20261110000000_mood_words` additive with a working rollback (run down and up).
- A mood question refuses an answer without a word (voice and text, every route that creates an answer); the word is
  served on every answer shape; `?mood=` filter; counts per word.
- Where you sit: share of unique valid answers with the same word, Nigeria vs World; percentage only at 50 or more in
  THAT group (check each group on its own: the builder shows the switch once any group reaches 50); valid = one per
  person, not removed, not deleted, not a suspended person’s; Redis counts refreshed by a timer (how stale can they be,
  and what happens after a removal or a deletion?).
- Seed `npm run seed:launch`: the launch question on Sun 15 Nov 2026 with the four words; the replaced question kept in
  the spare bank unchanged; run it twice (idempotent); other days unchanged.
- Cards: three sizes incl. the new `/share/{code}/square`; the name only with the switch on; a deleted account’s card
  never served (cache too); the 49/50 line on the card.
- Changed existing test `test/reach/helpers.ts`: does the change weaken any check?
- Defaults the builder took (Posted keeps old share buttons; no “Share my word” switch yet; web base address on the
  card; the tab bar hidden on MoodPick; a “Save the card as a picture” button): say if any breaks a board or a ruling.

## Also
Privacy: can anyone learn one person’s word other than from their public answer (counts per small group, the
where-you-sit endpoint for another person’s answer)? Regression: answers, replies, ranking, share pages, the existing
cards, payments untouched. Copy rules (curly quotes, no em-dash, British spelling). Pictures: compare the builder’s 13
in /tmp/voices-shots/lch-b/ with the boards and take your own of the pick screen and the Posted card, light and dark.
Checks to EXIT lines on both branches (RULES.md list).

Report: /tmp/voices-reports/v-lch-b.md (and copy it into the backend repo is NOT your job). Severity per finding
(BLOCKER, HIGH, MEDIUM, LOW), file:line, the rule broken. Hand back in 10 lines: verdict, findings, EXIT lines.
Clean up: remove worktrees, drop `vb_*`, FLUSHDB db 11, stop your PIDs.
