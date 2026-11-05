# AdminModeration (Admin: Moderation)

## 1. Boards
- admin/AdminModeration-1440.dc.html | shots/C/AdminModeration-1440.png

## 2. Route
`/admin/moderation`.

## 3. Regions
Admin nav (README-2) / "Safety · 49 open · oldest 3h" / H1 + rule line / Tabs (New 12, Reported 23, Reached 500 5, Sensitive topics 9) / queue list (4 rows) / right panel: author line, voice player, transcript, 3 screening notes, "Action" segmented control, Reason field, 2 buttons, "Audit trail".

## 4. Strings (verbatim)
Admin shell: see README-2. Safety · 49 open · oldest 3h | Moderation | Strong opinions and disagreement stay up. We remove threats, harassment, hate and private information. Every action needs a reason. | Moderation queues
Tabs: New 12 | Reported 23 | Reached 500 5 | Sensitive topics 9
Row 1: Threat | Reported 3 times · voice 0:14 · 220 listens | Voice reply on "Which campaign promise have you heard so many times that you can recite it from memory?" (selected)
Row 2: Private information | Screening found a phone number · text | Text answer on "You were debited, the transfer failed and nobody can tell you where your money is."
Row 3: Harassment | Reported 2 times · voice 0:09 | Voice reply to @funmi.o on "As a Nigerian, are you really fine?"
Row 4: This is about me | Priority · named person reported it | Text answer naming a landlord in Yaba on "Your landlord raised the rent again and the roof still leaks."
Panel: @dayo.k (Dayo Kalu) | Joined 18 Nov · 6 posts · no past strikes | Posted 1h ago | player 14 s | Transcript | Every four years the same road promise. If that councillor shows his face on our street again, he will not walk out the way he came in.
Screening: possible threat | Names a public official | Sensitive topic: politics
Action | Moderation action: Keep | Remove | Warn | Suspend (Remove selected)
Reason (the poster sees this and can appeal): Threat of violence against a named person. The criticism of broken promises is welcome; the threat is not.
Remove and warn | Keep it up
Audit trail | 9:41am · reported by 3 people (threat) | 9:42am · reach held at 220 while in review
Design bugs: none. Notes: "Reached 500" is reach-500 review (V-10); the tab counts 12 + 23 + 5 + 9 = 49. The "Reported 23" count equals "Open reports 23" on Today.

## 5. States drawn
Reported tab, threat voice reply open, Remove chosen. Text item (no player), Keep, Warn and Suspend chosen, empty queue, appeal item, saved, loading, error not drawn.

## 6. Numbers, lists, actions
- Queue, "49 open · oldest 3h", tab counts: GET /admin/moderation/items (ModerationPage: items, counts). ModerationItem: queue (REPORTED|SCREENED|SENSITIVE|PRIORITY|APPEAL), reasons, reportCount, priority, summary, status.
- Tab mapping: New to SCREENED, Reported to REPORTED, Sensitive topics to SENSITIVE; "Reached 500": GAP (no queue; V-10). PRIORITY ("This is about me") and APPEAL have no tab: GAP.
- Row text ("Reported 3 times · voice 0:14 · 220 listens"; the question quoted): ModerationItem.reportCount and summary; listens count: GAP (not in item).
- Panel: GET /admin/moderation/items/{itemId} (ModerationItemDetail: author (ModAuthor: handle, joinedAt, postCount, strikeCount), content, transcript, playUrl, screening, context, audit). Player: playUrl. Screening notes: screening (strings). "Names a public official": screening line.
- Audit trail: ModerationItemDetail.audit (AuditLine at, text, by).
- Action control, reason, buttons: POST /admin/moderation/items/{itemId}/action (ModerationDecision: action KEEP|REMOVE|REMOVE_AND_WARN|SUSPEND|BAN|RESTORE, reason). "Remove and warn" button: REMOVE_AND_WARN. "Keep it up": KEEP. Segmented "Warn" alone: GAP (only REMOVE_AND_WARN exists). Suspend length: SuspendRequest.until via POST /admin/users/{userId}/suspend (no field drawn).
- "the poster sees this and can appeal": GAP for the appeal route (see Rules.md).

## 7. Where each tap goes
Tab: filters queue. Row: loads it in the panel. Remove and warn / Keep it up: saves action with the reason, removes the row, next row. Nav: other admin pages.
