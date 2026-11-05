# Home (signed in) (Home)

## 1. Boards
- Board files (4): project/entry/Home-1440.dc.html, Home-390-2.dc.html, Home-390-dark.dc.html, Home-390.dc.html (folder A2)
- Pictures (3): shots/A2/Home-390-2-v3.png, Home-390-dark-v3.png, Home-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- / when signed in.
## 3. Regions
- App bar: Logo, Country button, Messages icon, Notifications icon (new dot).
- Greeting "Hi Ada, what is your take today?"; QuestionHero; TopicOfWeek; "Flash poll" with Live badge and Poll (vote state, closes in 6h).
- Trending answers (See all), two AnswerCards; New conversations, two TopicTiles; ad slot; BottomNav.
- 390-2 is the scrolled view; 390-dark is the dark theme of the same screen.
- At 1440:
  - Left SideNav (units 12.5, free-left count), top bar with SearchField, Country button "Nigeria", Messages link, bell (units 12.5, bell new); centre: greeting, QuestionHero, "Top voices on today's question"; Right rail aside "This week": TopicOfWeek (rail) and TrendingList.
## 4. Strings (verbatim)
- Nigeria
- Hi Ada, what is your take today?
- When salary arrives, how many hours pass before it disappears?
- Are You Really Fine? You Dey Okay?
- Week 1 · 10 questions · Poll open
- Flash poll
- Live (badge)
- Should failed transfers be refunded within one hour by law?
- Yes, for every day it is late | Only after the first week | No, just pay on time (flash options per board data)
- closes in 6h
- Trending answers
- See all
- New conversations
- Power and light: Has bad electricity cost you a job, a client or an exam?
- Faith: Is a tithe a rule or a choice?
- Zobo Fresh | Cold zobo, delivered in 30 minutes | Lagos Island and Lekki only. | Order now
- Home | Discover | Speak | Profile
- 1440: Search questions, voices and handles | Top voices on today's question | See all 12,480
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Signed in, light (390, 390-2, 1440) and dark (390-dark). Unread dot on bell. Flash poll in vote state.
## 6. Numbers, lists, actions -> contract
- Greeting name "Ada" -> GET /home -> greetingName
- Hero question and counts -> GET /home -> dailyQuestion
- Flash poll and its vote -> GET /home -> flashPoll; POST /polls/{pollId}/votes -> optionIds
- Trending, new conversations, ad -> GET /home -> trending, newConversations, sponsored
- Bell dot and count -> GET /notifications/unread-count -> unread
- SideNav units 12.5 and free-left -> GET /wallet -> balanceMilli, freePostsRemaining
- Messages icon -> GAP: V-10
## 7. Where each tap goes
- Bell -> Notifications; Messages -> Messages (V-10); Add your voice -> Record-ready; See all -> Question; Profile tab -> Me; Discover -> Discover; Speak -> Record-ready.
