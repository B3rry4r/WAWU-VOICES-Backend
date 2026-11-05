# Record: ready (Record-ready)

## 1. Boards
- Board files (2): project/talk/Record-ready-1440.dc.html, Record-ready-390.dc.html (folder B)
- Pictures (3): shots/B/Record-ready-1440.png, Record-ready-390-v3.png, Record-ready-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /speak (query ?q=[questionId]; also /q/[id]/speak).
## 3. Regions
- Full-screen forest background, no bottom bar (V-5). App bar: Close the recorder, "Speak", eyebrow "Today’s question".
- Recorder (idle): question, big record button, free-posts left, extra-time passes; note; buttons Try a prompt, Write instead.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; Messages is V-10, week 2), bell "Notifications" with dot.
  - Back to the conversation; StageBar (Speak); question card; Recorder idle; ghost buttons "Need a starting point? Try a prompt", "Prefer to type? Write instead"; right rail "Your recording time" card.
## 4. Strings (verbatim)
- Speak
- Today’s question
- When salary arrives, how many hours pass before it disappears?
- Tap to record. You have 10 seconds (Recorder idle hint)
- Start recording (aria)
- Extra time is a one-off token for one message: ₦150 for up to 30 seconds, ₦200 for up to 1 minute. Your first 10 posts stay free.
- Try a prompt
- Write instead
- Close the recorder (aria)
- 1440: Back to the conversation | Money · Salary, Bonuses and Year-End Money | Walk us through payday, hour by hour. | Need a starting point? Try a prompt | Prefer to type? Write instead
- Your recording time
- Free post
- 10 seconds
- Extra voice, 30 seconds
- ₦150
- Extra voice, 1 minute
- ₦200
- Extra time is a one-off token for one message, not a subscription. Your first 10 posts stay free.
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Idle (this board). Microphone permission denied, unsupported browser and no-mic states not drawn.
## 6. Numbers, lists, actions -> contract
- Start/stop and upload -> POST /voice-clips -> purpose ANSWER, mime, sizeBytes, durationMs; PUT putUrl; POST /voice-clips/{clipId}/complete; GET /voice-clips/{clipId} (status, peaks, transcript)
- Max seconds (10) -> GET /me/allowance -> Allowances.maxVoiceSeconds; ActionCosts.freeVoiceSeconds
- Free posts left 7 and tokens -> Allowances.freePostsRemaining; GET /extra-voice-tokens
- Prices ₦150 / ₦200 -> GET /units/tiers -> extraVoice[].priceKobo (15000, 20000)
- Try a prompt -> GAP: V-10 (AI prompts are week 2)
## 7. Where each tap goes
- Record button -> Record-live; Close -> Question; Write instead -> Write; Try a prompt -> Prompts (V-10).
