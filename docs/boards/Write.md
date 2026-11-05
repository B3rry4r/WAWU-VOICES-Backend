# Write an answer (Write)

## 1. Boards
- Board files (2): project/talk/Write-1440.dc.html, Write-390.dc.html (folder B)
- Pictures (3): shots/B/Write-1440.png, Write-390-v3.png, Write-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/write (reply variant carries ?reply=[answerId]).
## 3. Regions
- App bar: Close without posting (to Question), "Your answer", eyebrow "Today’s question".
- "Answering" + question + hint; Composer (text, counter, tags, voice button); warning Banner "Last free post"; ghost button to Prompts; footnote.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; Messages is V-10, week 2), bell "Notifications" with dot.
  - Back to the conversation; StageBar (Speak); question card; Composer; right rail "Your free posts" FreePosts + cost note, TrendingList.
## 4. Strings (verbatim)
- Your answer
- Today’s question
- Answering
- When salary arrives, how many hours pass before it disappears?
- Walk us through payday, hour by hour.
- Composer: Your answer (label), Send answer, tag controls ("Is this news? Pick a tag so readers know.", Verified News | Unverified News | Not news, "Talk, rumour or opinion. Not presented as fact.")
- Last free post
- This post is free. After it, a text post uses 0.5 unit (₦6.90) and a voice uses 1 unit (₦13.80).
- Need a starting point? Try a prompt
- Reading, listening, liking and sharing are always free.
- 1440: Back to the conversation | Money · Salary, Bonuses and Year-End Money | Your free posts | Text and voice both count, and deleting a post does not give one back. After 10, a text post uses 0.5 unit (₦6.90) and a voice up to 10 seconds uses 1 unit (₦13.80).
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Last free post (1 left). Typing, over-500, error and posting states are inside the Composer, not drawn here. Light.
## 6. Numbers, lists, actions -> contract
- Post text -> POST /questions/{questionId}/answers -> kind TEXT, body (max costs.textMaxChars 500), isNews, newsTag, newsSourceName, newsSourceUrl
- Reply in words (1440 Thread) -> POST /answers/{answerId}/replies -> stance, kind TEXT, body
- Free posts left and cost -> GET /me/allowance -> freePostsRemaining, costs.textPostMilli (500), voicePostMilli (1000)
- Draft -> GAP: no draft save operation; client-held
- Prompts button -> GAP: V-10 (AI prompts are week 2; board Prompts skipped)
## 7. Where each tap goes
- Close -> Question; Send answer -> Posted; Try a prompt -> Prompts (V-10); voice button -> Record-ready.
