# AdminNews (Admin: News tag review)

## 1. Boards
- admin/AdminNews-1440.dc.html | shots/C/AdminNews-1440.png

## 2. Route
`/admin/news`.

## 3. Regions
Admin nav (README-2) / "Editorial · 6 waiting" / H1 + rule line / Tabs (Flagged as misleading 4, Asking for Verified News 2, All changes) / queue list (4 rows: tag, flag line, excerpt, handle line) / right "Decide the tag" panel: post card, "What the flags say", Tag segmented control, Source link field, Reason field, 3 buttons, "Change log".

## 4. Strings (verbatim)
Admin shell: see README-2. Editorial · 6 waiting | News tag review | Only editors can mark Verified News, and only with a named source. Every change is logged and the poster is told why. | News queues
Tabs: Flagged as misleading 4 | Asking for Verified News 2 | All changes
Row 1: Unverified News | Flagged as misleading 4 times | Fuel queues are back on Ikorodu Road this morning. Two stations closed, the one selling has a line to the bus stop. | @chidi.e · 3h · 412 likes (selected)
Row 2: Gossip | Flagged 2 times | They are saying the Super Eagles coach will go after Saturday. Na gist o, I no fit confirm am. | @sola.m · 2h · flags say it is labelled right
Row 3: Unverified News | Source sent for Verified News | Market levy notice pasted at Oyingbo market gate this morning. Traders say it starts Monday. | @blessing.u · 5h · source photo attached
Row 4: Unverified News | Flagged 3 times | My cousin works at the bank and says transfers will be free from next month. | @emeka.n · 6h · reads like rumour
Decide the tag | post card (@chidi.e Chidi Eze, 3h · Lagos, same text, 412 likes, 58 replies, compact) | What the flags say | "Old news, the queue cleared at 9am" (2) · "Not news, just complaining" (1) · "Wrong road" (1)
Tag | Choose the tag: Verified News | Unverified News | Gossip (Unverified selected)
Source link (needed for Verified News) placeholder "https://" hint: A named source WAWU checked. Shown on the post.
Reason (the poster sees this) value: A first-hand report of an event. The tag stays Unverified News until a source confirms it.
Keep Unverified News | Change tag | Send to moderation
Change log | 8:15am · @chidi.e chose Unverified News when posting | 10:02am · 4th flag, sent to this queue
Design bugs: none. Note: row 3 (a Verified News request) is listed under the "Flagged as misleading" tab.

## 5. States drawn
Queue with 4 rows, row 1 open, Keep chosen by default. Verified-request decision (approve or decline), All changes tab, empty queue, decision saved, loading, error not drawn.

## 6. Numbers, lists, actions
- Queue and "6 waiting": GET /admin/news/items (AdminNewsPage: items, waiting). Row: AdminNewsItem (answer, flagCount, flagReasons, verifiedRequested, sourceName, sourceUrl, evidenceUrl, changeLog, summary). Tab counts 4 and 2: GAP (only waiting total; split by filter not returned). Tab filter parameter: not declared (GAP).
- "Flagged 4 times": flagCount. "labelled right", "reads like rumour": GAP (editor notes; flagReasons only).
- "What the flags say" with counts: AdminNewsItem.flagReasons (strings; counts per reason not typed).
- "source photo attached": evidenceUrl.
- Post card: AdminNewsItem.answer. Change log: changeLog (AuditLine at, text, by).
- Keep / Change tag / Send to moderation: POST /admin/news/{answerId}/decision (NewsDecision: decision KEEP|CHANGE_TAG|SEND_TO_MODERATION, newTag, sourceName, sourceUrl, reason). Approve or decline Verified: APPROVE_VERIFIED, DECLINE_VERIFIED (no button drawn for them).
- Reason field: reason (shown to the poster; notification TAG_CHANGED). Source link: sourceUrl; source name field: GAP (sourceName not drawn; required by SOURCE_REQUIRED rule for Verified).
- "All changes" tab: GAP (no route for the cross-post change log; GET /admin/audit may serve).

## 7. Where each tap goes
Tab: filters queue. Row: loads it in the panel. Keep Unverified News / Change tag: saves decision, removes row, next row. Send to moderation: moves to /admin/moderation. Nav: other admin pages.
