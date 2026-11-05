# Public share page (SharePage)

## 1. Boards
- Board files (3): project/entry/SharePage-1440.dc.html, SharePage-390-2.dc.html, SharePage-390.dc.html (folder A2)
- Pictures (2): shots/A2/SharePage-390-2-v3.png, SharePage-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /s/[code] (public; getSharePage).
## 3. Regions
- Top bar: Logo, Open in app button.
- Topic eyebrow, question, voices and votes line; "Where it is heading" lean line and three bars with counts; AI summary footnote; "Featured voice" AnswerCard (Most Thought-Provoking).
- 390-2 (scrolled): "The poll so far" Poll in results state, "What Next? · 14 proposals" ProposalCard, Add your voice button and note.
- At 1440:
  - Logo, What is VOICES? ghost button, Sign in; two columns: left summary, right "What do you think?" panel with Add your voice; Featured voice below. Counts read "610 voices".
## 4. Strings (verbatim)
- Open in app
- Nigeria · Week 1: Are You Really Fine?
- As a Nigerian, are you really fine? You dey okay?
- 1,240 voices · 12,480 votes so far
- Where it is heading
- Most voices so far lean towards: "I'm fine" hides real problems.
- "I'm fine" hides problems nobody can help with 610
- Saying "I'm fine" is how we stay strong 520
- Honestly, I am fine 110
- Based on 1,240 voices · updated 12 min ago · AI summary, checked by an editor
- Featured voice
- The poll so far
- What would make you feel truly fine again? (closes in 2 days)
- What Next? · 14 proposals
- @ngozi.e 1d: Publish a weekly power schedule for every street, so people can plan work and school. (312 support, 41 challenge, 6 grouped)
- Add your voice
- Record here in your browser. Sign in only when you publish.
- What is VOICES?
- Sign in
- What do you think?
- Say it in 10 seconds, right here in your browser. You only sign in when you publish.
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Question share (this board), poll and What Next? parts at 390-2. Guest viewer. Card-fallback (cardFallback) not drawn.
## 6. Numbers, lists, actions -> contract
- Whole page -> GET /share/{code} -> SharePage (topicLine, countryAndTheme, arguments[], leanLine, poll, proposalCount, topProposal, basedOnVoices, summaryLabel, featuredVoice, ctaLabel, openGraph)
- Bars 610/520/110 -> SharePage.arguments[].text, voices
- Add your voice tap and link open -> POST /share/{code}/events -> kind add_voice_tap, link_open
- Add your voice (guest recording in browser) -> POST /voice-clips needs sign-in; GAP: record-before-sign-in storage is client side
- Open in app -> GAP: VOICES is a web app (V-1); button has no target in the contract
## 7. Where each tap goes
- Open in app / Sign in -> HomeGuest / SignIn; Add your voice -> Record-ready; What is VOICES? -> Landing (1440).
