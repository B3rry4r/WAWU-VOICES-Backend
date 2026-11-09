---
id: LCH-04
title: Where you sit (Nigeria and World)
area: LAUNCH
priority: launch
tier: T1
repo: api + web
status: done (merged 9 Nov, backend 107b031, web 7245463; verified in 2 rounds)
depends_on: [LCH-02, LCH-14]
decisions: [V-31]
boards: [new: WhereYouSit]
---
# LCH-04 · Where you sit

Source: LAUNCH-SPEC.md §5 and source/spec-3-where-you-sit.jpg.

## Build
- After posting: "You’re with the 38% who feel HOPEFUL." with a Nigeria / World switch.
- Nigeria = answers by people whose country is Nigeria; World = all answers.
- A percentage only when at least 50 valid responses exist in that group; before that "You’re one of the first."
- Valid = one per person, not removed, not deleted, not a suspended person’s. Rounded to a whole percent.
- Counts kept in Redis and refreshed in the background, so a broadcast burst does not hit the database on every post.

## Done when
- Tests: 49 vs 50; one person counted once; a removed answer leaves the count; World vs Nigeria.
- Pictures beside the board.
