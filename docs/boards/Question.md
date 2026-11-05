# Question page (Discuss) (Question)

## 1. Boards
- Board files (4): project/talk/Question-1440.dc.html, Question-390-2.dc.html, Question-390-dark.dc.html, Question-390.dc.html (folder B)
- Pictures (8): shots/B/Question-1440.png, Question-390-2-v3.png, Question-390-dark-v2.png, Question-390-dark-v3.png, Question-390-dark.png, Question-390-v2.png, Question-390-v3.png, Question-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id] (Discuss stage).
## 3. Regions
- App bar: Back (Home), "Today's question", Save, Share. StageBar: Speak | Discuss | Vote | What Next? (current stage marked; visited stages ticked; 1440 shows counts 12.5K, 3.1K, 9.7K, 214).
- Question block with topic, title, hint, avatar stack, voice count, Speak (block) and Write instead buttons, free-post line.
- Voices list (header with count and sort), AnswerCards each with "View N replies" link; Poll block; What Next? block with top 3 proposals; Load more voices; "Add your voice in words" link; FreePosts pill; BottomNav (Home).
- 390-2 is the lower half of the same page; 390-dark is the dark theme.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; Messages is V-10, week 2), bell "Notifications" with dot.
  - Back to Home link, Share; StageBar with counts; question card with "Today's question", "Money · Salary, Bonuses and Year-End Money", 12,480 voices so far, Closes in 9h.
  - Panel "Add your voice": Speak for up to 10 seconds, or write up to 500 characters. Speak, Write instead, FreePosts.
  - Sort tabs Top/New/Debated, "3,104 voices", inline reply composer "Reply to @tunde.a. How are you replying?" with chips I agree, I disagree, My experience and buttons Reply by voice, Reply in words.
  - Right rail "More on VOICES": TrendingList, ad slot (Zobo Fresh).
## 4. Strings (verbatim)
- Today’s question
- Save this question (aria)
- Share this question (aria)
- Money
- Salary, Bonuses and Year-End Money
- When salary arrives, how many hours pass before it disappears?
- Walk us through payday, hour by hour.
- 12.5K voices
- closes in 9h
- Speak
- Write instead
- You have 10 seconds on a free post. Reading and listening are always free.
- Voices
- 3,104
- Sort voices: Top. Change (aria)
- Top | New | Debated
- View 86 replies
- 41 agree · 27 disagree
- View 41 replies
- View 132 replies
- View 2 replies
- Load more voices
- Add your voice in words
- Poll: What should every employer do before the year ends? (Pay salaries on time, every time | Pay a real year-end bonus | Publish clear pay scales | End unpaid overtime), closes in 2 days
- Labels: Most Relatable, Most Debated
- What Next?
- 214 proposals so far
- What is one practical change that would make pay fairer in your workplace?
- Most supported so far. These are proposals, nothing is agreed.
- 1 Every offer letter should state the salary date and a penalty for each day salary is late. (Proposed, 1,240 support · 180 challenge)
- 2 Companies should publish a simple pay scale for every role, so nobody negotiates in the dark. (Proposed, 860 support · 240 challenge)
- 3 Let staff choose to receive part of their salary every week instead of once a month. (Proposed, 410 support · 390 challenge)
- Propose a next step
- See all
- Tunde Adewale and others: avatars
- 1440: Back to Home | Today's question | Money · Salary, Bonuses and Year-End Money | 12,480 voices so far | Closes in 9h | Add your voice | Speak for up to 10 seconds, or write up to 500 characters. | 3,104 voices | Reply to @tunde.a. How are you replying? | I agree | I disagree | My experience | Reply by voice | Reply in words
- Trending: Should failed transfers be refunded within one hour by law? (8,200) | Is a tithe a rule or a choice? (6,100) | Should the minimum wage rise automatically with inflation? (4,900)
- Zobo Fresh | Cold zobo, delivered in 30 minutes | Lagos Island and Lekki only. | Order now
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Light 390, dark 390 (Question-390-dark), 390-2 scrolled, 1440. Free posts left 7. No empty-feed, loading, closed-question or guest state drawn.
## 6. Numbers, lists, actions -> contract
- Question header (text, hint, topic, voices, closes in) -> GET /questions/{questionId} -> Question.text, hint, category, topicTitle, voiceCount, endsAt
- Avatar stack of three people -> GAP: no recent-voices avatars field; derive from first listAnswers items (author.avatarUrl)
- Voices 3,104 and sort -> GET /questions/{questionId}/answers?sort= -> items[] (Answer), Question.answerCount; sort values not named in contract
- Answer cards: likes, replies, reactions, label -> Answer.likeCount, replyCount, reactionBreakdown, labels[]
- "41 agree · 27 disagree" -> Answer.agreeCount, disagreeCount
- Poll in feed -> GET /questions/{questionId}/polls -> Poll
- What Next? block and 214 proposals -> GET /questions/{questionId}/what-next -> summary, proposals[], proposalTotal; Question.proposalCount
- Stage counts 12.5K / 3.1K / 9.7K / 214 -> Question.voiceCount, answerCount, Poll.totalVotes, proposalCount
- Save this question (bookmark) -> GAP: no save or bookmark operation in the contract
- Share this question -> POST /share/links -> objectType QUESTION
- Trending rail (1440) -> GET /feed/trending
- Ad slot -> GET /ads/placement; POST /ads/{adId}/events
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- Back -> Home; Speak -> Record-ready; Write instead / Add your voice in words -> Write; View N replies -> Thread; proposals and See all -> WhatNext; Propose a next step -> Propose; poll -> Vote; StageBar tabs -> Record-ready, Question, Vote, WhatNext; 1440 Reply in words -> Thread, Reply by voice -> Record-ready.
