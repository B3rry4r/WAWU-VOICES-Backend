# AdminWeekly (Admin: Weekly report approval)

## 1. Boards
- admin/AdminWeekly-1440.dc.html | shots/C/AdminWeekly-1440.png

## 2. Route
`/admin/weekly` (proposed `/admin/weekly/[reportId]` for one draft).

## 3. Regions
Admin nav (README-2) / "Week 2 · drafted ..." line / H1 + status pill / "AI draft, edit before publishing" (the public WeeklyReportCard) / right "Checks" panel (5 passed checks, 1 warning, detail list, Editor notes, Publish at, 3 buttons).

## 4. Strings (verbatim)
Admin shell: see README-2. Week 2 · drafted Mon 30 Nov, 12:10am, after the poll closed | Weekly report approval | Draft · nothing is public yet
AI draft, edit before publishing | card strings as in Weekly.md (Week 2 · 23 to 29 Nov 2026 | What Nigerians said this week | AI-assisted · Human-reviewed | mood bars | Main arguments | 41% poll line | Based on 11,872 voices and 9,406 votes. Publishes 30 Nov, 6pm. People are split on some points; this is a summary, not a consensus. | Share | Download PDF)
Checks | No names, handles or phone numbers | Groups too small to stay anonymous left out | Leading view and the main opposing view both shown | Quotes: 2 of 2 with the speaker's consent | Languages read: English, Pidgin | "Everyone is angry" in the summary: say "most voices" instead (warning)
Based on: 11,872 voices and 9,406 votes | Poll closed: Sun 29 Nov, 11:59pm | Label: AI-assisted · Human-reviewed
Editor notes (kept in the log): Checked the quotes against consent records. Softened one line in the summary.
Publish at: Mon 30 Nov, 6:00pm (hint: Goes to the web, the app, the share card and the PDF at once.)
Approve and publish at 6pm | Edit draft | Hold
Design bugs: none. Notes: "the PDF" and the card's "Download PDF" are V-10 (weekly PDF after launch). Week 2 report dated 23 to 29 Nov and Week 3 running on 30 Nov agree with the Today board.

## 5. States drawn
Draft with one warning check. All checks passed, held, approved and scheduled, published, no draft yet, edit mode (fields), loading, error not drawn.

## 6. Numbers, lists, actions
- Draft and header line: GET /admin/weekly-reports (AdminWeeklyReportPage) and GET /admin/weekly-reports/{reportId} (AdminWeeklyReport: weekNumber, status DRAFT|HELD|APPROVED|PUBLISHED, draftedAt, pollClosedAt, publishAt, headline, mood, summary, themes, sentiment, pollSummary, quotes, basedOnVoices, basedOnVotes, languagesRead, checks).
- Card content: headline, mood, summary, themes, sentiment, pollSummary (same untyped fields as Weekly.md). Card title "What Nigerians said this week": GAP (headline vs title field).
- Checks (text, passed or warning): AdminWeeklyReport.checks (ReportCheck: text, ok). Quote consent: AdminQuote.consent.
- "Languages read": languagesRead. "Based on", "Poll closed": basedOnVoices, basedOnVotes, pollClosedAt. Label: fixed text.
- Edit draft: PATCH /admin/weekly-reports/{reportId} (headline, mood, summary, themes, quotes). Editor notes: GAP (no notes field on edit or approve).
- Publish at and Approve: POST /admin/weekly-reports/{reportId}/approve (publishAt).
- Hold: POST /admin/weekly-reports/{reportId}/hold (reason; no reason field drawn: GAP).
- "Goes to ... the PDF": GAP (V-10).

## 7. Where each tap goes
Approve and publish at 6pm: approves and schedules; status becomes Approved. Edit draft: edit mode on the card. Hold: holds with a reason. Nav: other admin pages.
