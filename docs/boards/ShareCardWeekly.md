# Share card image: weekly (ShareCardWeekly)

## 1. Boards
- Board files (1): project/entry/ShareCardWeekly.dc.html (folder A2)
- Pictures (0): shots/A2/none
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- No page route. The card is an image (story and square) served by GET /share/{code}/card; preview inside ShareSheet and Posted.
## 3. Regions
- One ShareCard component, kind=weekly, drawn alone at card scale (no phone frame).
- At 1440:
  - Not drawn at 1440 (same image).
## 4. Strings (verbatim)
- Week 1 report · AI-assisted · Human-reviewed
- How Nigerians felt in Week 1
- Most voices say they are coping, not fine.
- updated Monday 9:00
- Voice counts (voices prop) and the VOICES wordmark as drawn in the component
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Single state. Fallback card (cardFallback true, no image) not drawn.
## 6. Numbers, lists, actions -> contract
- Card content -> POST /share/links -> objectType WEEKLY_REPORT; ShareLink.storyImageUrl, squareImageUrl, previewText
- Card status -> ShareLink.cardStatus PENDING/READY/FAILED/FALLBACK
- Source figures -> GET /share/{code} -> SharePage (arguments, poll, featuredVoice, report)
- Weekly report content -> GAP: V-10 (weekly report is week 2); data would come from GET /weekly-reports/latest
## 7. Where each tap goes
- Not interactive; the image is attached to a share.
