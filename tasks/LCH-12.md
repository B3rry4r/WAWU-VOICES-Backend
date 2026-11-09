---
id: LCH-12
title: Paid AI text fix
area: LAUNCH
priority: after launch unless the owner says launch
tier: T1
repo: api + web
status: done (merged 9 Nov, backend 36939f0, web ea860b6; T2 verified in 2 rounds)
depends_on: [LCH-10]
decisions: [V-33]
boards: [Write (a "Fix my text" control)]
---
# LCH-12 · Paid AI text fix

Source: LAUNCH-SPEC.md §11 ("AI to adjust text or typo, people can pay for it. Only for that").

## Build
- On the Write screen, "Fix my text": the AI corrects spelling, typos and grammar in the person’s own text only. It never
  adds ideas or changes the meaning. The person sees the change and chooses to use it or keep their own.
- Costs a set number of tokens per fix (OPEN Q6), charged only when a fix is returned.
- The AI is used for nothing else on the Write screen.
- Privacy text: the text is sent to the AI provider to be corrected.

## Done when
- Tests: charge once per fix, never on failure; the meaning check (a set of sentences whose meaning must not change).
