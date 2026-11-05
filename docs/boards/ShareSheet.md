# Share sheet (ShareSheet)

## 1. Boards
- Board files (2): project/entry/ShareSheet-1440.dc.html, ShareSheet-390.dc.html (folder A2)
- Pictures (1): shots/A2/ShareSheet-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Sheet over /q/[id] (voice share); dialog at 1440.
## 3. Regions
- Background: Question header (Back, "Money", Save, Share, StageBar Discuss) with one AnswerCard (tag unverified) and BottomNav.
- Sheet "Share this voice": ShareCard preview, 10 targets, footnote.
- At 1440:
  - Dialog over Question page with SideNav; same targets.
## 4. Strings (verbatim)
- Share this voice
- A card and a link go out. The audio file never does.
- Money
- Who is getting rich from this inflation while you count coins?
- They said fuel would come down after the new refinery. My transport money is still double what it was in January.
- A voice from @musa.d
- 2,400 voices
- updated 1h ago
- Share to: WhatsApp | Status | Stories | Facebook | X | TikTok | Telegram | SMS | Copy link | More
- Sharing is free. Your link carries your referral code.
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Sheet open (this board). Card loading and card fallback not drawn.
## 6. Numbers, lists, actions -> contract
- Create link and card -> POST /share/links -> objectType ANSWER, objectId; ShareLink.url, storyImageUrl, squareImageUrl, cardStatus
- Targets -> POST /share/{code}/events -> kind intent, target (WHATSAPP, WHATSAPP_STATUS, INSTAGRAM_STORIES, FACEBOOK, X, TIKTOK, TELEGRAM, SMS, COPY_LINK, SYSTEM_SHEET)
- Card image -> GET /share/{code}/card
- Referral code on the link -> Me.referralCode
## 7. Where each tap goes
- Each target opens that app or copies the link; sheet closes on dismiss.
