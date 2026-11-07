# VOICES pricing structure (owner's team, 7 Nov 2026)

Source: `source/VOICES_Pricing_Structure.pdf` ("WAWU AFRICA | VOICES PRICING", 2 pages). Copied here as written.
These are owner figures: they come from the PDF and config, never from a design (CLAUDE.md money rules).

## Tokens
- 1 VOICES Token = ₦1. Minimum purchase ₦183. People get exactly the tokens they buy: no bonus, no promotional units.

| Package | Price | Tokens |
|---|---|---|
| Entry | ₦183 | 183 |
| Starter | ₦366 | 366 |
| Standard | ₦732 | 732 |
| Plus | ₦1,464 | 1,464 |
| Pro | ₦3,660 | 3,660 |
| Premium | ₦7,320 | 7,320 |
| Ultimate | ₦14,640 | 14,640 |

## Text
- ₦5 per 150 characters, charged in proportion to the characters sent (500 characters = 16.67 tokens).
- At most 5,000 characters a message. Spaces and punctuation count; Unicode and emoji are counted the same way everywhere.

| Characters | Tokens |
|---|---|
| 150 | 5 |
| 300 | 10 |
| 500 | 16.67 |
| 1,000 | 33.33 |
| 2,000 | 66.67 |
| 3,000 | 100 |
| 5,000 | 166.67 |

## Voice
| Length | Tokens |
|---|---|
| Up to 30 seconds | 78 |
| Over 30 and up to 60 seconds | 100 |
- At most 60 seconds. Charge only when the voice is sent. A cancelled recording is never charged.

## Subscriptions
| Name | Length | Price | Tokens a month | Total |
|---|---|---|---|---|
| VOICES CONNECT | 3 months | ₦2,999 | 500 | 1,500 |
| VOICES PLUS | 6 months | ₦5,399 | 600 | 3,600 |
| VOICES INFINITY | 12 months | ₦9,599 | 750 | 9,000 |
- Tokens are credited monthly, not all at once. Subscribers can still buy tokens. Subscriptions are separate from
  pay-as-you-go purchases.

## Daily limit
- At most 20 outgoing messages per person per day (text and voice both count). Reading, listening, likes, shares and
  reactions do not count. The same for free users and every subscription.

## How this meets what is built today (lead, 7 Nov 2026)
Built today: "Voice Units" packs (`units.tiers`), 10 free posts of 10 seconds, Extra voice time bought with tokens (V-8),
a ledger in thousandths of a unit (so 16.67 tokens fits), payments through Flutterwave. No subscriptions.
- OPEN Q3: do the 10 free posts stay, and is the launch answer ("say it in 10 seconds") free? The PDF charges 78 tokens
  for any voice up to 30 seconds and ₦5 per 150 characters of text, and does not mention free posts.
- OPEN Q4: the name people see: "VOICES Tokens" (PDF) or "Voice Units" (built). Never "wallet" for either.
- OPEN Q5: subscriptions: one payment up front with tokens credited monthly, or a monthly charge? Do unused monthly
  tokens carry over? Refunds for a subscription?
- OPEN Q7: does the new price list apply at launch, or after? Changing money rules days before a launch is a risk;
  the lead suggests the pay-as-you-go prices at launch if answered by 9 Nov, and subscriptions after launch.
