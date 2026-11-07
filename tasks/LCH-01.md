---
id: LCH-01
title: Landing words for the launch
area: LAUNCH
priority: launch
tier: T0
repo: web
status: todo
depends_on: []
decisions: [V-30]
boards: [Landing, HomeGuest]
---
# LCH-01 · Landing words for the launch

Source: docs/launch/LAUNCH-SPEC.md §1 and docs/launch/source/landing-now-copy-to-replace.jpg.

## Build
- web/src/features/entry/Landing.tsx (and the guest Home hero if it repeats the line): replace the headline
  "Nigeria is talking. Add your voice." and the line "Every day our editors ask one question…" with:
  - Eyebrow: NIGERIA’S NATIONAL CONVERSATION (already there; keep)
  - Headline: Finally, a place to say it. And be heard.
  - Intro: One question a day about life in Nigeria. Say your answer in 10 seconds, or type it. Hear people who agree
    and people who don’t. Vote. Then back the ideas that could actually help.
- These sit before "Listen as a guest". Curly apostrophes, no em-dash, the design type scale.
- The page title and share metadata for the landing use the new headline.

## Done when
- Pictures at 390 light and dark and 1440, beside the Landing board; the headline wraps with no lone word.
- Tests that asserted the old words change to the new words only (list them).
