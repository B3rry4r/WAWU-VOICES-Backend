# Onboarding carousel (Onboarding)

## 1. Boards
- Board files (2): project/entry/Onboarding-1440.dc.html, Onboarding-390.dc.html (folder A2)
- Pictures (1): shots/A2/Onboarding-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /join (after Join VOICES). Skip goes to /join/country.
## 3. Regions
- Top bar: Logo, Skip link.
- Carousel, 3 slides with image area and caption; dots (aria "Step N of 3"); Next button on slides 1 and 2, Start on slide 3.
- Slide 1: Today's question card with VoicePlayer. Slide 2: playing VoicePlayer, three reactions, a poll bar. Slide 3: FreePosts counter and price note.
- At 1440:
  - Centred card: Logo, Skip, three steps shown at once (Welcome, One question a day, Hear the country, 10 free posts to start), Get started and I have an account buttons, adult line.
## 4. Strings (verbatim)
- Skip
- Today's question
- When salary arrives, how many hours pass before it disappears?
- Nigeria is talking
- One question from our editors every day. Speak for 10 seconds or write a few lines.
- Hear the country
- Listen to real voices, react, and see where people lean in open polls. Listening is always free.
- Your first 10 posts are free
- Every price shows before you tap. No surprise charges. VOICES is for adults (18+).
- 💯 Exactly | ❤️ Relatable | 🤔 Thought-provoking
- Stable power and affordable food
- 41%
- Open poll · 12,480 votes so far
- Text and voice both count. Deleting a post does not give one back.
- Then Voice Units from ₦138. A text post uses 0.5 unit (₦6.90).
- Next
- Start
- Step 1 of 3 / Step 2 of 3 / Step 3 of 3 (dots label)
- 1440: Welcome | Nigeria's national conversation | One question a day | Speak for 10 seconds or write a few lines. | Listen, react and vote in open polls. Listening is always free. | 10 free posts to start | Then Voice Units from ₦138. Every price shows before you tap. | Get started | I have an account | 12,480 voices so far · Closes in 9h | VOICES is for adults (18+). By continuing you accept the Community rules.
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Slide 1, slide 2, slide 3 (390); single page (1440). Light theme only.
## 6. Numbers, lists, actions -> contract
- Slide 1 question and 12,480 voices -> GET /questions/today -> Question.text, voiceCount
- Slide 2 example poll and 41% -> GET /polls/current -> Poll.options[].percent, totalVotes
- Slide 3 FreePosts 10 and "0.5 unit (₦6.90)" -> GET /me/allowance -> costs.textPostMilli (500); price in naira derived from PRICES.md (GAP: guest-readable cost; allowance needs sign-in)
- Slide order/step state -> client only
## 7. Where each tap goes
- Skip -> Country; Next -> next slide; Start -> Country (390). Get started -> Country; I have an account -> SignIn; Community rules -> Rules (1440).
