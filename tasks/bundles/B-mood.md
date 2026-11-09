# Bundle B (mood): LCH-02 + LCH-04 + LCH-03. Tier T1. Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-b` in BOTH repos. Read `docs/agents/RULES.md` first, then the three task
files, `docs/launch/LAUNCH-SPEC.md` §2, §4, §5 and the boards in `docs/design/launch/`: MoodPick-390, MoodAnswers-390,
YoureLive-390 (only its where-you-sit card and the share card preview), YoureLive-390-first, ShareCardMood (1200x630),
ShareCardMood-Square (1080x1080, with name), ShareCardMood-Story (1080x1920, before 50).
Resources: ports 15000-15019, Redis db 12, Postgres databases named `lchb_*`.

## Build
- LCH-02 (api, additive migration with rollback): a question can carry mood options; `Answer.mood` (enum ANGRY, TIRED,
  PROUD, HOPEFUL, nullable). On a mood question every answer (voice and text) must carry one word; refused in plain
  words otherwise. The word is served on every answer shape (cards, thread, profile, /s). Counts per word for a question.
  The launch question "How do you feel about Nigeria right now?" with the line "With everything going on, say it in your
  voice. 10 seconds." and the four words is seeded for Sun 15 Nov 2026 (V-38 a), using the existing seed or calendar
  mechanism; say how the question it replaces is kept (held bank, not lost).
- LCH-02 (web): the MoodPick screen before Record or Write on a mood question (four words, one pressed, change until
  posted, “Say it in 10 seconds” and “Type it instead”), the word chip beside every answer, the “How Nigeria feels so
  far” bar and the word filter chips on the question, as the boards draw. Mood colours: the design system pairs
  danger, warning, success, verified (light and dark).
- LCH-04 (api + web): where-you-sit for the person’s own answer: share of unique valid answers with the same word, in
  Nigeria (people whose country is Nigeria) and the World; a percentage only at 50 or more valid answers in that group,
  else “You’re one of the first.” Valid = one per person, not removed, not deleted, not a suspended person’s. Counts kept
  in Redis and refreshed in the background (not read from the database on every request). The card on the Posted
  screen as YoureLive-390 draws it, with the Nigeria and World switch (no switch before 50).
- LCH-03 (api card renderer + web): the mood share card in the three sizes with the where-you-sit line, cached like the
  existing cards, a deleted account’s card never served. The person’s name only with “Show my name on the card” (off by
  default; a switch on the Posted screen; stored on the answer). The share links use the existing share flow.
- Contract: `docs/contract/openapi.yaml` and the contract docs updated; web `npm run api:types` and `sync:shared`.

## Tests (new; existing ones change only where a ruling changes a value, list each)
- A mood question refuses an answer without a word; the word is stored, served, filtered.
- Where you sit: 49 vs 50 in each group; one person counted once; a removed answer leaves the count; Nigeria vs World.
- Card: no name without consent; the 49/50 line; a deleted account’s card is not served.
Pictures: every screen touched at 390 light and dark and 1440, and the three card sizes, beside the boards, in
`/tmp/voices-shots/lch-b/`. Look at each.
Hand back per `docs/agents/RULES.md`.
