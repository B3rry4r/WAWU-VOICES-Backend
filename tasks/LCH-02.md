---
id: LCH-02
title: Launch question with a mood word
area: LAUNCH
priority: launch
tier: T1
repo: api + web
status: blocked (OPEN Q1 date; LCH-14 boards)
depends_on: [LCH-14]
decisions: [V-31]
boards: [new: MoodPick, Record-live, Write, Posted, Question cards]
---
# LCH-02 · Launch question with a mood word

Source: LAUNCH-SPEC.md §2 and source/spec-1-launch-question.jpg.

## Build
- API (additive): a question can carry mood options (for the launch: ANGRY, TIRED, PROUD, HOPEFUL). New nullable column
  Answer.mood (enum), set when the answer is made; one word per answer; required on a mood question.
- The person picks one word, then records up to 10 seconds or types. They can change the word until they post.
- Every published answer to a mood question shows its word beside it (cards, thread, profile, /s).
- Results: counts per word (feeds LCH-04).
- Seed the launch question on the launch day in the calendar: "How do you feel about Nigeria right now?" with the line
  "With everything going on, say it in your voice. 10 seconds."
- Mood colours from the boards (LCH-14), never invented: the spec picture shows angry red, tired brown, proud green,
  hopeful blue as a draft.

## Done when
- Tests: posting without a word on a mood question is refused with a plain message; the word is stored and served;
  a removed answer does not count.
- Pictures of each screen beside its board, 390 light and dark, 1440.
