---
id: LCH-03
title: Personal share card
area: LAUNCH
priority: launch
tier: T1
repo: api (card renderer) + web
status: done (merged 9 Nov, backend 107b031, web 7245463; verified in 2 rounds)
depends_on: [LCH-02, LCH-04, LCH-14]
decisions: [V-31]
boards: [new: ShareCardMood]
---
# LCH-03 · Personal share card

Source: LAUNCH-SPEC.md §4 and source/spec-2-share-card.jpg.

## Build
- api/src/reach/card-renderer.ts: a mood card: "MY VOICE. MY NIGERIA." / "I feel {WORD} about Nigeria." /
  "What about you?" / the VOICES logo with "Add your voice" / the campaign link / the LCH-04 line
  ("You’re with the 38% who feel HOPEFUL." or "You’re one of the first.").
- Sizes: 1200x630 (link preview), 1080x1920 (Stories), 1080x1080 (square for WhatsApp and feeds). Cached as today.
- The person’s name only when they turn on "Show my name on the card" (off by default). Otherwise no name.
- WhatsApp first; the card can be saved as a picture and forwarded.

## Done when
- Tests: no name without consent; the line matches LCH-04 at 49 and 50 responses; a deleted account’s card is never served.
- Pictures of every size beside the board.
