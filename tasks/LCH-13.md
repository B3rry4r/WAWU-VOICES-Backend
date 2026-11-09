---
id: LCH-13
title: The weekly report as an Instagram post
area: LAUNCH
priority: launch week
tier: T1
repo: api (card renderer) + web admin
status: done (merged 9 Nov, backend 1b10fb6, web 5816801; verified in 2 rounds)
depends_on: [LCH-14]
decisions: [V-34]
boards: [new: WeeklyInstagram]
---
# LCH-13 · The weekly report as an Instagram post

Source: LAUNCH-SPEC.md §10.

## Build
- When a weekly report is published, make Instagram pictures from the approved text: a carousel at 1080x1350 (cover,
  the headline numbers, the main views, the closing line) and a 1080x1920 Story.
- Admin Weekly gets "Download Instagram pictures". Nothing is posted automatically.

## Done when
- Pictures beside the board; no em-dash, curly quotes, numbers as the report shows them.
