# AdminResults (Admin: Posted results)

## 1. Boards
- admin/AdminResults-1440.dc.html | shots/C/AdminResults-1440.png

## 2. Route
`/admin/results`.

## 3. Regions
Admin nav (README-2) / "Live results threads · 14 to check" / H1 + rule line / thread chips / queue list (4 rows + "10 more" link) / right "Check this result" panel: result card, photo line, "Your decision" segmented control, Reason field, preview line, 2 buttons.

## 4. Strings (verbatim)
Admin shell: see README-2. Live results threads · 14 to check | Posted results | People post the numbers they see. You mark each one Verified or Not verified. WAWU never publishes a count of its own.
Chips: Polling unit counts 11 | Petrol price watch 3
Rows: PU 014, Ward 3, Surulere, Lagos | @kemi.b · 6:42pm · photo attached | Not verified (selected)
PU 007, Ward 9, Yaba, Lagos | @tunde.a · 6:51pm · photo attached | Not verified
PU 022, Ward 1, Ikeja, Lagos | @funmi.o · 6:58pm · no photo | Not verified
PU 003, Ward 5, Mushin, Lagos | @hauwa.y · 6:20pm · checked by Ibrahim S. | Verified
10 more waiting in this thread
Check this result | card: @kemi.b | 6:42pm | PU 014, Ward 3, Surulere, Lagos | Accredited 412 | Votes cast 398 | Rejected 6 | Counted in front of everybody. Party agents signed. | Not checked yet. Treat with care. | Reply | Report wrong numbers
Photo of the result sheet, from @kemi.b
Your decision | Mark this result: Verified | Not verified (Verified selected)
Reason: Figures match the signed result sheet in the photo. (hint: Kept in the log. Not shown to the public.)
People will see: Checked by the WAWU team at 7:05pm
Save and next | Send to moderation
Design bugs: none. Notes: the "Petrol price watch" thread is a chip only; its figures are not drawn. Counts: chips 11 + 3 = 14.

## 5. States drawn
Queue with 3 unchecked and 1 checked row; first row open with Verified chosen. Not verified chosen, no-photo detail, empty queue, saved, loading, error not drawn. Photo is a link line only (no image shown).

## 6. Numbers, lists, actions
- Queue and "14 to check": GET /admin/results/posts (AdminResultPage: items, toCheck). Row: AdminResultPost (post: state, lga, ward, pollingUnit, accredited, votesCast, rejected, status, label, checkedAt, checkedLine, createdAt; photoUrl, hasPhoto, checkedBy). Thread filter and chip counts (11, 3): GAP (threads in GET /admin/results/threads give postCount and verifiedCount only; no waiting count; post filter by thread not declared).
- "PU 014, Ward 3, Surulere, Lagos": ResultPost.pollingUnit, ward, lga, state. "10 more waiting": client from toCheck.
- Handle and time: ResultPost.author, createdAt. "checked by Ibrahim S.": AdminResultPost.checkedBy.
- Figures: accredited 412, votesCast 398, rejected 6 (totals only, V-8).
- Result note "Counted in front of everybody. Party agents signed.": GAP (CreateResultPostRequest has no note field).
- Photo link: AdminResultPost.photoUrl (team only, V-8). Upload: POST /uploads (kind RESULT_PHOTO).
- Save and next: POST /admin/results/posts/{postId}/decision (ResultDecision: decision VERIFIED|NOT_VERIFIED, note). Reason field: note.
- "People will see: Checked by the WAWU team at 7:05pm": ResultPost.checkedLine and checkedAt.
- Send to moderation: ResultDecision SEND_TO_MODERATION.
- Reply, Report wrong numbers: public-side actions: POST /reports (targetType RESULT_POST); reply: GAP (no replies on result posts).
- Opening a thread: POST /admin/results/threads (not drawn here); GET /admin/results/threads.

## 7. Where each tap goes
Chip: filters by thread. Row: loads it in the panel. Photo line: opens photo. Save and next: saves, next unchecked row. Send to moderation: /admin/moderation. "10 more waiting": loads more rows. Nav: other admin pages.
