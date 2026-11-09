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
- Q3 decided (V-38 b, lead default): the 10 free posts stay; the PDF prices apply after them.
- Q4 decided (V-36, owner): the name is tokens (“VOICES Tokens”).
- Q5 decided (V-38 c, lead default): subscriptions after launch, paid once up front, tokens credited monthly, unused
  tokens carry over.
- Q7 decided (V-38 c, lead default): pay-as-you-go prices at launch, subscriptions after.
- The AI text fix (Q6) is 5 tokens per fix (V-37).
