# Bundle F (money): LCH-10 + LCH-12. Tier T2 (money). Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-f` in BOTH repos. Read `docs/agents/RULES.md` first, then the two task
files, `docs/launch/PRICING.md` (the owner's figures: never change one), DECISIONS V-36, V-37, V-38, and the boards
`docs/design/launch/BuyTokens-390`, `FixText-390`, `Subscriptions-390` (Subscriptions is NOT built now: V-38 c).
Resources: ports 15020-15039, Redis db 13, Postgres databases named `lchf_*`.

## Build
- LCH-10 tokens (api + web): 1 token = ₦1; the 7 packs from ₦183 to ₦14,640, no bonus; packs and rates in config
  (`units.*` config today: keep the config seam, values from PRICING.md). Text costs ₦5 per 150 characters in proportion
  (2 decimals; the ledger already keeps thousandths), at most 5,000 characters, one character count on web and server
  (Unicode and emoji the same way, tested). Voice: up to 30 s = 78 tokens, over 30 s up to 60 s = 100, at most 60 s;
  charged only when the message is sent; a cancelled recording is never charged. The 10 free posts stay as built
  (V-38 b); prices apply after them. At most 20 outgoing messages (answers and replies) per person per day, reset at
  midnight Lagos time; reading, listening, likes, shares and reactions never count; a plain message at the limit.
- The name is tokens everywhere people read it (V-36): screens, receipts, notifications, emails, legal texts (docs/legal
  masters, then web `sync:shared`; list every legal line changed for the owner), CLAIMS rows. Never “wallet”.
  The Extra voice tokens (V-8) become the voice prices above. The Buy screen as BuyTokens-390 draws it.
- LCH-12 AI text fix (api + web): `POST /text/fix` returns the corrected text and the changes; only spelling, typos and
  grammar, never meaning (a test set of sentences whose meaning must not change, run against the Gemini stand-in’s
  contract); 5 tokens per fix, charged only when a fix comes back, once per request (Idempotency-Key); rate limited.
  The Write screen as FixText-390 draws it (“Use the fix”, “Keep mine”). Privacy line: the text goes to the AI provider
  to be corrected, used for nothing else (owner approves the legal text).
- Contract updated; web types regenerated.

## Verifier attacks (T2, for the separate verifier)
Double taps and parallel posts at 19 and 20 a day, midnight Lagos boundary, a failed or cancelled send never charged,
the proportional text cost at 149, 150, 151, 5,000 and 5,001 characters and with emoji, the fix charged once under 20
parallel requests and never on a failure, refunds and the books balanced against the payment stand-in.
Pictures: every screen touched at 390 light and dark and 1440, in `/tmp/voices-shots/lch-f/`.
Hand back per `docs/agents/RULES.md`.
