# Sign in to post (phone number) (SignIn)

## 1. Boards
- Board files (2): project/entry/SignIn-1440.dc.html, SignIn-390.dc.html (folder A2)
- Pictures (1): shots/A2/SignIn-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /sign-in (sheet over the saved voice preview; opens from Post voice).
## 3. Regions
- Preview of the question screen behind: Back, "Today's question", Share, StageBar (Speak), question, "Your voice · preview" VoicePlayer, Post voice button.
- Bottom sheet "Sign in to post": phone field (+234 prefix), consent line, Send code button, footnote.
- At 1440:
  - Dialog (centred sheet) over Home with SideNav, search, AnswerCard, TopicOfWeek rail, TrendingList; Sign in secondary button in header.
## 4. Strings (verbatim)
- Today's question
- When salary arrives, how many hours pass before it disappears?
- Your voice · preview
- Post voice
- Sign in to post
- Your voice is saved. It posts as soon as you are in.
- Phone number
- +234
- 803 214 7720 (default value)
- We send a 6 digit code by SMS. One account per number.
- I am 18 or older and I accept the Community rules and Terms.
- Send code
- Reading, listening, liking and sharing stay free without an account.
- Sign in (1440 header)
- Search questions, voices and handles
- Week 1 · 10 questions · Poll open
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Phone entry (this board). 1440 dialog variant. No error state drawn (wrong number, rate limit).
## 6. Numbers, lists, actions -> contract
- Send code (SMS code, +234 number) -> GAP: sign-in and the SMS code are WAWU ID (id.wawuafrica.com), not a VOICES operation
- Saved voice kept until sign-in -> GAP: client-held draft; POST /voice-clips needs a signed-in user (guest upload not in contract)
- 18+ and rules acceptance -> POST /me -> CreateMeRequest.ageConfirmed, termsAccepted, rulesAccepted (after sign-in)
## 7. Where each tap goes
- Send code -> Verify; Back (header) -> previous question screen; Share (header) -> ShareSheet; Community rules and Terms -> Rules.
