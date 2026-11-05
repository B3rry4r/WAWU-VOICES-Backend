# Weekly (Weekly report)

## 1. Boards
- more/Weekly-390.dc.html (phone, top) | shots/C/Weekly-390-v3.png
- more/Weekly-390-2.dc.html (phone, scrolled to "The poll in full") | shots/C/Weekly-390-2-v3.png
- more/Weekly-1440.dc.html (desktop) | shots/C/Weekly-1440.png
(paths under scratchpad/voices-canvas/C/project and /shots/C)

## 2. Route
`/weekly` (latest) and `/weekly/[reportId]` (proposed). Reached from SideNav "Weekly report", Discover, archive rows.

## 3. Regions
390: header (Back, title "Weekly report", link "Past reports") / WeeklyReportCard (week, title, AI label, mood bars, main arguments, poll line, based-on line, Share and Download PDF buttons) / "The poll in full" (Poll, results state) / "In their own words" (2 quotes, 2nd has VoicePlayer) / "Share this week" (ShareCard weekly + "Share the card") / BottomNav (Discover active, no Speak action change).
1440: SideNav (Weekly report active, units chip) + top row (SearchField, country, Messages icon, bell) / H1 "Weekly report" + "Past reports" link / same card, poll, quotes in a column; consent note under quotes; ShareCard beside the "Share this week" text; extra button "Download PDF".

## 4. Strings (verbatim)
Header: Weekly report | Past reports | Back
Card: Week 2 · 23 to 29 Nov 2026 | What Nigerians said this week | AI-assisted · Human-reviewed | The mood | Angry about prices, still counting every naira. | Anger 44% up 6 | Anxiety 27% down 3 | Hope 17% up 1 | Sadness 12% down 4 | Main arguments | Prices rise faster than pay (3.2k voices) | Discounts that are not real (2.5k voices) | Fuel and transport eat the budget (1.9k voices) | 41% A stable naira led the vote on what to tackle first to bring prices down. | Based on 11,872 voices and 9,406 votes. Published 30 Nov, 6pm. People are split on some points; this is a summary, not a consensus. | Share | Download PDF
Poll: The poll in full | What should be tackled first to bring prices down? | A stable naira 3,856 | Cheaper fuel and transport 2,540 | Support for local producers 1,693 | Real action against price gouging 1,317
Quotes: In their own words | "I used to buy a carton of noodles. Now I buy them one by one, like I am in school again." | A voice from Lagos · shared with consent | "The Black Friday price is the old price with a red sticker. We are not fools." | A voice from Kaduna · shared with consent (10 s player)
1440 only: Quotes are shared only with the speaker's consent. No names, no handles, and no group too small to stay anonymous. | The card carries the mood, the poll and a link back to the full report. Journalists and brands can quote it with the label. | Download PDF (secondary)
Share: Share this week | Week 2 report | A stable naira led the vote. | 30 Nov | Share the card
Desktop top bar: Search questions, voices and handles | Search VOICES | Nigeria | Messages | Notifications. Prices, Black Friday and the Empty Wallet (page topic line, 1440 only).
Design bugs: none. Note: "Download PDF" is drawn but the weekly PDF is V-10 (after launch).

## 5. States drawn
Signed-in, published report, light only. No empty, loading, error, guest or dark state drawn. The poll is closed (results state, not live).

## 6. Numbers, lists, actions
- Week label, title, range, mood line, based-on counts, published time: GET /weekly-reports/latest (WeeklyReport: weekNumber, title, range, mood, basedOnVoices, basedOnVotes, publishedAt); other weeks GET /weekly-reports/{reportId}.
- AI label: WeeklyReport.label ("AI-assisted and human-reviewed").
- Mood rows (label, %, change vs last week): WeeklyReport.sentiment (untyped in contract). GAP-check: the delta field is not declared.
- Main arguments with voice counts: WeeklyReport.themes (untyped).
- Poll line (41% ...): WeeklyReport.pollSummary. Poll in full: GET /polls/{pollId}/results (options, percent, totalVotes); pollId from Topic.weeklyPollId (GET /topics/{topicId}).
- Quotes (excerpt, place, optional audio): WeeklyReport.quotes (excerpt, placeLabel, clipUrl). "shared with consent": AdminQuote.consent.
- Share and "Share the card": POST /share/links (objectType WEEKLY_REPORT, objectId) then POST /share/{code}/events; image GET /share/{code}/card.
- Download PDF: GAP (no PDF route; V-10).
- Past reports: GET /weekly-reports.
- Units chip, bell dot: GET /me (allowances.freePostsRemaining, balanceMilli, unreadNotifications). Country control: GAP (no country-change route; CreateMe/Profile hold countryCode only).
- Messages icon: GAP (V-10).

## 7. Where each tap goes
Back: previous screen. Past reports: /weekly/archive. Share / Share the card: share sheet. Download PDF: none at launch. Quote play: plays inline. BottomNav: Home, Discover, Speak, Profile. SideNav: Home, Discover, Weekly report, Profile, Speak.
