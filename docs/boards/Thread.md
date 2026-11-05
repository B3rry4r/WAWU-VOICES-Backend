# Replies to a voice (Thread)

## 1. Boards
- Board files (2): project/talk/Thread-1440.dc.html, Thread-390.dc.html (folder B)
- Pictures (3): shots/B/Thread-1440.png, Thread-390-v3.png, Thread-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/a/[answerId] (replies).
## 3. Regions
- App bar: Back to the conversation, "Replies", "86 replies to @tunde.a", Share this voice. StageBar (Discuss).
- Link to the question; the parent AnswerCard (unfolded); filter chips All, I agree, I disagree, My experience with counts; reply cards each under a stance badge (compact AnswerCards).
- Reply bar: "How are you replying?" chips I agree | I disagree | My experience, voice button, link "Reply to @tunde.a in words"; BottomNav.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to the conversation, Share this voice, StageBar with counts; parent card and replies; Composer "Reply to @tunde.a" placeholder "Say it in your own words" with voice button; "86 replies"; right rail Poll, TrendingList, ad slot.
## 4. Strings (verbatim)
- Replies
- 86 replies to @tunde.a
- Share this voice (aria)
- Replies to a voice on
- When salary arrives, how many hours pass before it disappears?
- Show replies (aria)
- All | I agree | I disagree | My experience (each with a count)
- I agree (Enugu 1h text) | I disagree (Port Harcourt 58m voice) | My experience (Ilorin 40m text) | I agree (Abuja 12m text)
- How are you replying?
- Reply to @tunde.a in words
- Say it in your own words (1440)
- Reply to @tunde.a (1440)
- Back to the conversation
- Home | Discover | Speak | Profile
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Replies populated. Empty replies, blocked author and deleted reply not drawn. Light.
## 6. Numbers, lists, actions -> contract
- Parent answer -> GET /answers/{answerId} -> Answer
- Replies list and filter -> GET /answers/{answerId}/replies?stance= -> Reply (stance, kind, body, clip, author)
- Chip counts -> Answer.replyCount, agreeCount, disagreeCount; experience count GAP: no experienceCount field
- Reply by voice or words -> POST /answers/{answerId}/replies -> stance, kind, body or clipId, extraVoiceTokenId; ReplyReceipt.charge
- Delete my reply -> DELETE /replies/{replyId}
- Share this voice -> POST /share/links -> objectType ANSWER
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- Back -> Question; stance chips pick the stance; voice button -> Record-ready; in words -> Write; card taps -> same card.
