# Record: preview (Record-preview)

## 1. Boards
- Board files (2): project/talk/Record-preview-1440.dc.html, Record-preview-390.dc.html (folder B)
- Pictures (3): shots/B/Record-preview-1440.png, Record-preview-390-v3.png, Record-preview-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /speak (preview state).
## 3. Regions
- Same shell as Record-ready. Recorder (preview): VoicePlayer of the 8 second take (recorded=8) and a send button; the control labels live inside the Recorder component; board text is "Listen back. Nothing posts until you tap Send."
- At 1440:
  - Same shell with preview card and right rail "Your recording time".
## 4. Strings (verbatim)
- Speak
- Today’s question
- When salary arrives, how many hours pass before it disappears?
- Listen back. Nothing posts until you tap Send.
- Send button copy in the component: Post for ... / Send for 1 unit (varies with free posts left)
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
- Preview of an 8 second take. Posting, failed upload, transcript pending not drawn.
## 6. Numbers, lists, actions -> contract
- Start/stop and upload -> POST /voice-clips -> purpose ANSWER, mime, sizeBytes, durationMs; PUT putUrl; POST /voice-clips/{clipId}/complete; GET /voice-clips/{clipId} (status, peaks, transcript)
- Max seconds (10) -> GET /me/allowance -> Allowances.maxVoiceSeconds; ActionCosts.freeVoiceSeconds
- Free posts left 7 and tokens -> Allowances.freePostsRemaining; GET /extra-voice-tokens
- Prices ₦150 / ₦200 -> GET /units/tiers -> extraVoice[].priceKobo (15000, 20000)
- Post voice -> POST /questions/{questionId}/answers -> kind VOICE, clipId; PostReceipt.charge
- Discard (if offered by the component) -> DELETE /voice-clips/{clipId}
- Transcript -> GET /voice-clips/{clipId} -> transcript (PENDING/READY/FAILED)
## 7. Where each tap goes
- Send -> Posted; re-record or discard (inside the Recorder, labels not in board source) -> Record-ready; Close -> Question.
