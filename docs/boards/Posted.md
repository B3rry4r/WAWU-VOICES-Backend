# Posted (success and share) (Posted)

## 1. Boards
- Board files (2): project/talk/Posted-1440.dc.html, Posted-390.dc.html (folder B)
- Pictures (3): shots/B/Posted-1440.png, Posted-390-v3.png, Posted-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/posted.
## 3. Regions
- App bar: Close (to Question), "Posted", eyebrow "Today’s question".
- Success mark, "Your voice is live", note, FreePosts counter, share buttons (Share to WhatsApp block, WhatsApp Status, Instagram Stories, Copy link, More apps), AnswerCard of the new post, note, ShareCard; BottomNav.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; Messages is V-10, week 2), bell "Notifications" with dot.
  - "It is under New on today’s question." panel "Now let people hear you", share buttons, card; Back to the conversation; right rail TrendingList and ad slot.
## 4. Strings (verbatim)
- Posted
- Today’s question
- Your voice is live
- It is under New. We will tell you when people reply.
- Share to WhatsApp
- WhatsApp Status
- Instagram Stories
- Copy link
- More apps
- Just now · Lagos
- People get this card and a link. Your recording itself is never shared as a file.
- Salary, Bonuses and Year-End Money
- Nigeria
- A voice from @ada.okafor
- 12,480 voices
- updated Just now
- 1440: It is under New on today’s question. We will tell you when people reply. | Now let people hear you | Back to the conversation
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Posted (free posts left 6). Share failed and card pending not drawn.
## 6. Numbers, lists, actions -> contract
- Receipt -> POST /questions/{questionId}/answers -> PostReceipt.answer, charge, allowances
- Free posts left 6 -> PostReceipt.allowances.freePostsRemaining
- Share link and card -> POST /share/links -> objectType ANSWER; POST /share/{code}/events kind intent
- "We will tell you when people reply" -> NotificationType REPLY via GET /notifications
## 7. Where each tap goes
- Close / Back to the conversation -> Question; share buttons open the target app; Copy link copies the short link.
