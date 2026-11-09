# Landing (guest welcome) (Landing)

## 1. Boards
- Board files (3): project/entry/Landing-1440.dc.html, Landing-390-2.dc.html, Landing-390.dc.html (folder A2)
- Pictures (2): shots/A2/Landing-390-2-v3.png, Landing-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /welcome (public; signed-out visitors).
## 3. Regions
- Top bar: Logo (alt "VOICES home"), Country button (aria "Country: Nigeria. Change country").
- Hero: headline, intro line, Add your voice / Listen as a guest buttons, adult line; QuestionHero for today; one AnswerCard (Most Relatable).
- Section "Every topic, four steps. Join at any one." with Speak, Discuss, Vote, What Next? rows.
- Fair from the first tap card (image, free-posts line, price line).
- Sticky bottom actions: Sign in (secondary), Join VOICES; accept line with Community rules and Terms links.
- 390-2 board is the same screen scrolled to the lower half (no hero).
- At 1440:
  - Header nav (Logo, How it works, Weekly report, Rules, Sign in, Add your voice); two-column hero; four steps in a row; a trust list; footer with Logo, copyright and four links. No country button, no sticky actions.
## 4. Strings (verbatim)
- Nigeria
- Nigeria's national conversation
- Finally, a place to say it. And be heard.
- One question a day about life in Nigeria. Say your answer in 10 seconds, or type it. Hear people who agree and people who don’t. Vote. Then back the ideas that could actually help.
- Add your voice
- Listen as a guest
- Free to read, listen, like and share. Adults only (18+).
- When salary arrives, how many hours pass before it disappears?
- Add your voice (speak label on QuestionHero)
- 12,480 voices
- closes in 9h
- Every topic, four steps. Join at any one.
- Speak: Record up to 10 seconds or write up to 500 characters. (1440 adds: Hear it back before you post.)
- Discuss: Reply, and say if you agree, disagree or have lived it too. (1440: Reply by voice or text. Say if you agree, disagree or have lived it too.)
- Vote: One vote per account. Nobody can buy extra votes. (1440: One vote per account in open polls. Nobody can buy extra votes.)
- What Next?: Suggest what should change. Every idea is labelled Proposed. (1440 adds: until it is proven.)
- Fair from the first tap
- Your first 10 posts are free.
- After that, posting uses Voice Units from ₦138. Every price shows before you tap. Ads are always labelled, and your raw audio is never downloadable.
- 1440 trust list: Reading, listening, liking and sharing are always free | Every ad and sponsored post is labelled | Your raw audio is never downloadable
- Sign in
- Join VOICES
- When you join you accept the Community rules and Terms.
- 1440 nav: How it works | Weekly report | Rules | Sign in | Add your voice
- Footer: VOICES by WAWU · © 2026 | Community rules | Terms | Privacy | Support
- Example card: Tunde Adewale, @tunde.a, 2h, Ibadan, 9 s voice, 1284 likes, 86 replies, label Most Relatable
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Signed-out only; light theme. 390 (top), 390-2 (scrolled), 1440. No empty, loading or error state drawn.
## 6. Numbers, lists, actions -> contract
- Voice count 12,480 and closes in 9h -> GET /questions/today -> Question.voiceCount, endsAt
- Today's question text -> GET /questions/today -> Question.text
- Example AnswerCard (likes, replies, label, voice) -> GET /feed/trending -> Answer (likeCount, replyCount, labels, clip)
- Price "from ₦138" -> GET /units/tiers -> minPackKobo (13800)
- Free posts "10" -> GET /me/allowance -> costs; the 10 is a config value, no public field for guests (GAP: guest-readable free-post count)
- Country button (Change country) -> GAP: no operation lists countries; only Nigeria at launch
- Weekly report link (1440 nav) -> GAP: V-10 (weekly report is week 2); /weekly-reports/latest exists but is not launch scope
## 7. Where each tap goes
- Listen as a guest / Add your voice (hero) -> HomeGuest (390 and 1440); Add your voice at 1440 header -> HomeGuest.
- Sign in -> SignIn; Join VOICES -> Onboarding (390).
- Community rules, Terms, Privacy -> Rules; Support -> Settings.
- Weekly report -> Weekly; How it works -> #how anchor.
