# Profile setup (ProfileSetup)

## 1. Boards
- Board files (2): project/entry/ProfileSetup-1440.dc.html, ProfileSetup-390.dc.html (folder A2)
- Pictures (1): shots/A2/ProfileSetup-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /join/profile (step 2 of 2).
## 3. Regions
- App bar: Back (to Topics), "2 of 2".
- Heading; Photo section (Avatar, Add a photo button, note); Handle field with hint; Voice Card block (image, Optional tag, text, record button, note); Finish and post my voice button; free-post note.
- At 1440:
  - Centred with Logo header; "Step 2 of 2"; record prompt reads "Click to record".
## 4. Strings (verbatim)
- How should people know you?
- Add a photo
- Optional. Photos never go on share cards.
- Handle
- @
- ada.okafor (default)
- @ada.okafor is free. Letters, numbers, dots and underscores.
- Your Voice Card
- Optional
- Say hello in up to 10 seconds. People hear it when they open your profile.
- Record your Voice Card (aria)
- Tap to record (1440: Click to record)
- Free. It does not use a free post.
- Finish and post my voice
- This is your 1st of 10 free posts.
- 2 of 2
- Step 2 of 2
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Handle free (drawn). Handle taken, photo chosen, Voice Card recorded: not drawn.
## 6. Numbers, lists, actions -> contract
- Handle free check -> GET /me/handle-check -> HandleCheck.available, reason
- Create profile -> POST /me -> handle, countryCode, languages, categoryIds, referralCode
- Photo -> POST /uploads (kind AVATAR) then PATCH /me/profile -> avatarFileId
- Voice Card -> POST /voice-clips (purpose VOICE_CARD), /complete, PATCH /me/profile -> voiceCardClipId
- Finish and post my voice -> POST /questions/{id}/answers (clipId); allowances.freePostsRemaining gives "1st of 10"
## 7. Where each tap goes
- Back -> Topics; Finish and post my voice -> Home (signed in); Add a photo -> photo picker; record button -> Voice Card recorder.
