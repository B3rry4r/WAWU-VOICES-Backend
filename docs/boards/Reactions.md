# Question page with reaction tray open (Reactions)

## 1. Boards
- Board files (2): project/talk/Reactions-1440.dc.html, Reactions-390.dc.html (folder B)
- Pictures (3): shots/B/Reactions-1440.png, Reactions-390-v3.png, Reactions-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id] (Discuss), reaction tray on an AnswerCard.
## 3. Regions
- Same page as Question (390). The second AnswerCard (Owerri, text) has its reaction tray open with "free reactions" 17 left.
- All other regions as Question.
- At 1440:
  - Same as Question at 1440 (tray not shown at 1440; board shows the page only).
## 4. Strings (verbatim)
- React to this voice. One reaction each.
- One reaction each. Changing is free.
- Your reaction: (label when chosen)
- 17 free reactions (tray note count)
- Money
- Salary, Bonuses and Year-End Money
- When salary arrives, how many hours pass before it disappears?
- Walk us through payday, hour by hour.
- Voices
- 3,104
- Sort voices: Top. Change (aria)
- Top | New | Debated
- View 86 replies
- 41 agree · 27 disagree
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Tray open on a text answer. Free reactions left 17 of the day. No "out of free reactions" (paid reaction) state drawn.
## 6. Numbers, lists, actions -> contract
- The 10 reactions (names, emoji) -> GET /reactions -> ReactionKindInfo (kind, emoji, name)
- Set or change my reaction -> PUT /answers/{answerId}/reaction -> ReactionRequest.kind; response ReactionState.charge
- Remove -> DELETE /answers/{answerId}/reaction
- Free reactions left 17 -> GET /me/allowance -> Allowances.freeReactionsLeftToday
- Cost after free -> ActionCosts.reactionAfterFreeMilli
- Rest of the page -> as Question
## 7. Where each tap goes
- Tap a reaction -> sets it and closes the tray; tap outside -> closes. Other taps as Question.
