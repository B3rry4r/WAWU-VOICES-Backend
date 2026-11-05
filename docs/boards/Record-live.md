# Record: recording (Record-live)

## 1. Boards
- Board files (3): project/talk/Record-live-1440.dc.html, Record-live-390-dark.dc.html, Record-live-390.dc.html (folder B)
- Pictures (5): shots/B/Record-live-1440.png, Record-live-390-dark-v3.png, Record-live-390-dark.png, Record-live-390-v3.png, Record-live-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /speak (recording state).
## 3. Regions
- Full-screen dark-forest recorder. App bar: Close the recorder, "Speak", "Today’s question".
- Section "Voice recorder": "Recording", question, ring timer (arc), Stop recording button, elapsed 0:04, level bars, live caption "4 seconds left. It stops by itself at 10."
- At 1440:
  - Same shell as Record-ready with the recording card; right rail "Your recording time".
## 4. Strings (verbatim)
- Speak
- Today’s question
- Voice recorder
- Recording
- When salary arrives, how many hours pass before it disappears?
- Stop recording (aria)
- 0:04
- 4 seconds left. It stops by itself at 10.
- Close the recorder (aria)
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
- Recording at 0:04 (390 light, 390-dark, 1440).
## 6. Numbers, lists, actions -> contract
- Start/stop and upload -> POST /voice-clips -> purpose ANSWER, mime, sizeBytes, durationMs; PUT putUrl; POST /voice-clips/{clipId}/complete; GET /voice-clips/{clipId} (status, peaks, transcript)
- Max seconds (10) -> GET /me/allowance -> Allowances.maxVoiceSeconds; ActionCosts.freeVoiceSeconds
## 7. Where each tap goes
- Stop -> Record-preview (also auto at 10 s); Close -> Question (recording discarded).
