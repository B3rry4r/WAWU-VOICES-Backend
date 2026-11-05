# Out of free posts (OutOfPosts)

## 1. Boards
- Board files (2): project/talk/OutOfPosts-1440.dc.html, OutOfPosts-390.dc.html (folder B)
- Pictures (3): shots/B/OutOfPosts-1440.png, OutOfPosts-390-v3.png, OutOfPosts-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Sheet over /q/[id]/write (error FREE_POSTS_EXHAUSTED or INSUFFICIENT_UNITS).
## 3. Regions
- Question page behind (as Question 390). Sheet "You have used your 10 free posts" over it: balance, saved draft, price note, Get Voice Units button, Keep my draft for later, footnote.
- At 1440:
  - Write page behind with Composer (cost 0.5 unit (₦6.90), balance 0 units) and dialog.
## 4. Strings (verbatim)
- You have used your 10 free posts
- Balance: 0 units
- Your draft is saved
- Salary lands on the 25th. By noon the rent contribution, my mother’s drugs and the school fees are gone. By the 27th I am back to side hustle money.
- To post it, get Voice Units. A text post uses 0.5 unit (₦6.90). The smallest pack is 10 units for ₦138.
- Get Voice Units from ₦138
- Keep my draft for later
- Reading, listening, liking and sharing are always free.
- 1440: Answering | Money · Salary, Bonuses and Year-End Money | Your free posts | Text and voice both count, and deleting a post does not give one back. After 10, a text post uses 0.5 unit (₦6.90) and a voice up to 10 seconds uses 1 unit (₦13.80).
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Out of free posts and 0 units (this board). Draft saved. Light.
## 6. Numbers, lists, actions -> contract
- Trigger -> POST /questions/{questionId}/answers error code FREE_POSTS_EXHAUSTED / INSUFFICIENT_UNITS
- Balance 0 units -> GET /wallet -> balanceMilli
- Price ₦6.90 and ₦138 -> ActionCosts.textPostMilli, minPackKobo (13800)
- Draft saved -> GAP: no draft operation; client-held
- Get Voice Units -> GET /units/tiers then POST /payments (BuyUnits board, folder C)
## 7. Where each tap goes
- Get Voice Units -> BuyUnits; Keep my draft for later -> closes to Question.
