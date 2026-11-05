# Home (guest) (HomeGuest)

## 1. Boards
- Board files (2): project/entry/HomeGuest-1440.dc.html, HomeGuest-390.dc.html (folder A2)
- Pictures (1): shots/A2/HomeGuest-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- / when signed out (Home route; guest variant).
## 3. Regions
- App bar: Logo, Country button, Messages icon, Notifications icon.
- Heading "What is Nigeria saying today?"; QuestionHero; info Banner "Listening is free."; TopicOfWeek card.
- Trending answers (See all) with two AnswerCards; New conversations with two TopicTiles; BottomNav (Home active; Discover, Speak, Profile).
- At 1440:
  - Left SideNav (units 12.5, free-left count), top bar with SearchField, Country button "Nigeria", Messages link, bell replaced by header with Sign in button; Right rail aside "This week": TopicOfWeek (rail) and TrendingList; ad slot; centre column shows "Top voices on today's question" with See all 12,480.
## 4. Strings (verbatim)
- Nigeria
- What is Nigeria saying today?
- When salary arrives, how many hours pass before it disappears?
- Add your voice
- Listening is free.
- Read, listen, like and share without an account. We only ask for your number when you post, react or vote.
- Are You Really Fine? You Dey Okay?
- Week 1 · 10 questions · Poll open
- Trending answers
- See all
- Tunde Adewale @tunde.a 2h Ibadan voice, 1284 likes, 86 replies, Most Relatable
- Lagos 3h text: Salary lands at 9am. By 11am rent contribution, my mother's upkeep and generator fuel have taken their share. What is left is for transport and prayer. (642 likes, 41 replies)
- New conversations
- Power and light: Has bad electricity cost you a job, a client or an exam? (2,400 voices)
- Faith: Is a tithe a rule or a choice? (6,100 voices)
- Home | Discover | Speak | Profile
- 1440: Search questions and voices | Sign in | Top voices on today's question | See all 12,480 | Zobo Fresh: Cold zobo, delivered in 30 minutes. Lagos Island and Lekki only. Order now
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Guest (this screen). Signed-in version is Home. 390 and 1440. Light. No loading or error state drawn.
## 6. Numbers, lists, actions -> contract
- Hero question, voices 12,480, closes in 9h -> GET /home -> dailyQuestion (Question.text, voiceCount, endsAt)
- Topic of the week card -> GET /home -> topicOfWeek (title, weekNumber, voiceCount, weeklyPollId); "10 questions" count GAP: no question count on Topic
- Trending answers + See all -> GET /home -> trending[]; See all -> GET /feed/trending (cursor)
- New conversations tiles -> GET /home -> newConversations[] (category.name, text, voiceCount)
- Sponsored ad slot (1440) -> GET /home -> sponsored; GET /ads/placement; POST /ads/{adId}/events
- Messages icon -> GAP: V-10 (Messages is week 2)
- Notifications icon (no dot for guest) -> GET /notifications/unread-count (signed in only)
- Guest (no account): X-Guest-Id header on /home, /share/links, likes -> GET /home with X-Guest-Id
## 7. Where each tap goes
- Logo -> Home; Messages -> Messages (V-10); bell -> Notifications; Add your voice -> Record-ready; TopicOfWeek -> topic; See all -> Question (feed); cards -> Question/Thread; BottomNav: Home, Discover, Speak -> Record-ready, Profile -> SignIn.
