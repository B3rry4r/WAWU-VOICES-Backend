# Share card image: voice (ShareCardVoice)

## 1. Boards
- Board files (1): project/entry/ShareCardVoice.dc.html (folder A2)
- Pictures (0): shots/A2/none
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- No page route. The card is an image (story and square) served by GET /share/{code}/card; preview inside ShareSheet and Posted.
## 3. Regions
- One ShareCard component, kind=voice, drawn alone at card scale (no phone frame).
- At 1440:
  - Not drawn at 1440 (same image).
## 4. Strings (verbatim)
- Money
- Who is getting rich from this inflation while you count coins?
- They said fuel would come down after the new refinery. My transport money is still double what it was in January.
- A voice from @musa.d
- updated 1h ago
- tag unverified
- Voice counts (voices prop) and the VOICES wordmark as drawn in the component
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Single state. Fallback card (cardFallback true, no image) not drawn.
## 6. Numbers, lists, actions -> contract
- Card content -> POST /share/links -> objectType ANSWER; ShareLink.storyImageUrl, squareImageUrl, previewText
- Card status -> ShareLink.cardStatus PENDING/READY/FAILED/FALLBACK
- Source figures -> GET /share/{code} -> SharePage (arguments, poll, featuredVoice, report)
## 7. Where each tap goes
- Not interactive; the image is attached to a share.
