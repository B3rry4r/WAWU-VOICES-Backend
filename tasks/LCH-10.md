---
id: LCH-10
title: New token prices and the daily limit
area: MONEY
priority: launch if answered by 9 Nov, else after
tier: T2 (money)
repo: api + web
status: done (merged 9 Nov, backend 36939f0, web ea860b6; T2 verified in 2 rounds)
depends_on: []
decisions: [V-32]
boards: [BuyUnits, ExtraVoice, OutOfPosts, Wallet history]
---
# LCH-10 · New token prices and the daily limit

Source: docs/launch/PRICING.md.

## Build
- 1 token = ₦1; the 7 packs from ₦183 to ₦14,640; no bonus tokens. Packs and rates in config, never in code.
- Text: ₦5 per 150 characters, in proportion (the ledger already keeps thousandths); at most 5,000 characters; one
  character count everywhere (Unicode and emoji the same way on web and server).
- Voice: up to 30 s = 78 tokens, over 30 s up to 60 s = 100; at most 60 s; charged only when sent; a cancelled recording
  is never charged.
- At most 20 outgoing messages (answers and replies) per person per day; reading, listening, likes, shares and reactions
  do not count; a plain message when the limit is reached.
- What happens to the 10 free posts and the free 10-second answer waits on OPEN Q3. The name waits on OPEN Q4.
- Legal: Terms and Refunds updated (owner approves).

## Done when
- T2 verifier with the money attacks (double taps, parallel posts, a failed send, refunds, the 20 a day at midnight
  Lagos time); the books balance against Flutterwave.
