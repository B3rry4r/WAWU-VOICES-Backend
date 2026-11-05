# Enter your code (Verify)

## 1. Boards
- Board files (2): project/entry/Verify-1440.dc.html, Verify-390.dc.html (folder A2)
- Pictures (1): shots/A2/Verify-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /sign-in/verify.
## 3. Regions
- Same preview behind as SignIn (Post voice button replaced by disabled Verify and post).
- Sheet "Enter your code": six digit boxes, Resend countdown, Change number link, Verify and post button (disabled until 6 digits), new-user note.
- At 1440:
  - Dialog over Home like SignIn.
## 4. Strings (verbatim)
- Enter your code
- We sent 6 digits by SMS to +234 803 214 7720.
- Verification code
- Digit 1 ... Digit 6 (aria; drawn 4, 1, 7, 2, empty, empty)
- Resend code in 0:42
- Change number
- Verify and post
- New here? Next you choose a handle and 3 topics. It takes a minute.
- Today's question
- Your voice · preview
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- 4 of 6 digits entered, Verify and post disabled. No wrong-code, expired or resend-ready state drawn.
## 6. Numbers, lists, actions -> contract
- Code check and resend 0:42 -> GAP: WAWU ID, not a VOICES operation
- New user detection ("New here?") -> GET /me -> Me.profileComplete (false sends to Topics); POST /me creates the profile
## 7. Where each tap goes
- Change number -> SignIn; Verify and post -> (new user) Topics, (returning) publishes the saved voice via POST /questions/{id}/answers; Back -> previous screen.
