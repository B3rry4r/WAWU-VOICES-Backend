# Post the numbers you see (PostResult)

## 1. Boards
- Board files (2): project/talk/PostResult-1440.dc.html, PostResult-390.dc.html (folder B)
- Pictures (3): shots/B/PostResult-1440.png, PostResult-390-v3.png, PostResult-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /live/[threadId]/post.
## 3. Regions
- App bar: Close (to LiveResults), "Post the numbers you see", subtitle "Polling unit results".
- Instruction; "Where" four fields; "The numbers on the sheet" three numeric fields; Photo (optional) with Add a photo; info Banner; "How it will look" ResultComment preview; Post button; free note.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to live results; right rail "What the labels mean" (Verified, Not verified) and the not-adding line.
## 4. Strings (verbatim)
- Post the numbers you see
- Polling unit results
- Copy exactly what is written on the result sheet at your polling unit.
- Where
- State (Lagos) | Local government (Lagos Mainland) | Ward (Ward 6) | Polling unit (PU 009)
- The numbers on the sheet
- Accredited (488) | Votes cast (471) | Rejected (5)
- Photo of the result sheet (optional)
- Add a photo
- It helps the WAWU team check faster. Only the team sees it.
- The WAWU team checks every post
- Until it is checked, your post shows Not verified. Post only what is written on the sheet.
- How it will look
- Ada Okafor, Just now, PU 009, Ward 6, Lagos Mainland, Lagos; Accredited 488, Votes cast 471, Rejected 5; Not checked yet. The WAWU team is on it.
- Post these numbers
- Posting results is free. It does not use your free posts or units.
- Back to live results (1440)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Filled form (this board). Empty, validation error, photo attached, posting, posted, not at a polling unit not drawn.
## 6. Numbers, lists, actions -> contract
- Post -> POST /result-threads/{threadId}/posts -> state, lga, ward, pollingUnit, accredited, votesCast, rejected, photoFileId
- Photo -> POST /uploads (kind RESULT_PHOTO) then PUT putUrl; photoFileId
- "How it will look" -> client preview; real row is ResultPost (status NOT_VERIFIED, label Not verified)
- Free (no post used) -> no charge field on createResultPost; ledger untouched
## 7. Where each tap goes
- Close -> LiveResults; Post these numbers -> LiveResults (new post at top, Not verified); Add a photo -> picker.
