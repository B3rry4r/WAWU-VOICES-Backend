# Country and language (Country)

## 1. Boards
- Board files (2): project/entry/Country-1440.dc.html, Country-390.dc.html (folder A2)
- Pictures (1): shots/A2/Country-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /join/country.
## 3. Regions
- App bar: Back arrow (to Onboarding), title "Set up".
- Heading, one radio row (Nigeria, Naira (₦)), globe note.
- Heading "Which languages do you speak?" with five chips, helper note.
- Continue button (block), footnote.
- At 1440:
  - Same content centred with Logo header; Continue button not block.
## 4. Strings (verbatim)
- Set up
- Where are you speaking from?
- Nigeria
- Naira (₦)
- VOICES starts in Nigeria. Your country sets your questions, prices and polls.
- Which languages do you speak?
- English | Pidgin | Hausa | Yorùbá | Igbo
- The app is in English. We use your languages to transcribe your voice and to find voices you understand.
- Continue
- You can change both later in Settings.
- Back (aria)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Nigeria selected; English and Pidgin selected; Hausa, Yorùbá, Igbo not. Light only.
## 6. Numbers, lists, actions -> contract
- Country selection Nigeria -> POST /me -> CreateMeRequest.countryCode (sent with the final sign-up)
- Languages chips -> POST /me -> CreateMeRequest.languages (list of codes)
- Change later in Settings -> PATCH /me/profile -> languages; PATCH /me/settings -> language
## 7. Where each tap goes
- Back -> Onboarding; Continue -> HomeGuest in the board (sign-up chain continues after sign-in; see SignIn, Topics).
