# BOARDS-2 (folder C): screen list, shared strings, GAP table

Sources: scratchpad/voices-canvas/C/project/{more,admin}/*.dc.html; pictures shots/C/<stem>-v3.png (phone), <stem>.png (desktop); contract origin/v/contract docs/contract/openapi.yaml (143 routes). Skipped (V-10, week 2): Survey, SurveyDone, BrandPage (6 boards in C). Units in the contract are milli (12.5 units = 12500).

## Screens (22) and boards (43 of 43 non-V-10 boards in C)
| Screen | Route | Boards | Files |
|---|---|---|---|
| Weekly | /weekly, /weekly/[id] | 3 | Weekly-390, -390-2, -1440 |
| WeeklyArchive | /weekly/archive | 2 | -390, -1440 |
| Rules | /settings/legal/rules | 2 | -390, -1440 |
| Category | /c/[slug] | 2 | -390, -1440 |
| Discover | /discover | 3 | -390, -390-2, -1440 |
| Newsroom | /news | 2 | -390, -1440 |
| NewsPost | /news/[answerId] | 2 | -390, -1440 |
| Me | /profile | 2 | -390, -1440 |
| Person | /p/[handle] | 2 | -390, -1440 |
| EditProfile | /profile/edit | 2 | -390, -1440 |
| Settings | /settings | 3 | -390, -390-2, -1440 |
| Wallet | /wallet | 4 | -390, -390-2, -390-dark, -1440 |
| BuyUnits | /wallet/buy | 3 | -390, -390-2, -1440 |
| PaymentDone | /wallet/paid | 3 | -390, -390-2 (failure), -1440 |
| AdminToday | /admin | 1 | -1440 |
| AdminOverride | /admin/override | 1 | -1440 |
| AdminCalendar | /admin/calendar | 1 | -1440 |
| AdminNews | /admin/news | 1 | -1440 |
| AdminResults | /admin/results | 1 | -1440 |
| AdminAds | /admin/ads | 1 | -1440 |
| AdminWeekly | /admin/weekly | 1 | -1440 |
| AdminModeration | /admin/moderation | 1 | -1440 |
Total 22 screens, 43 boards (35 in more, 8 in admin). Check: all 43 file names appear in the screen files; none over 120 lines.

## Shell strings (used by the files above)
Phone top bar (TopBar): VOICES home (logo) | Nigeria (country button, label "Country: Nigeria. Change country") | Notifications (bell, dot). Main screens also show header title and, on Discover and Me, a Messages icon.
BottomNav (390): Home | Discover | Speak | Profile (Speak is the raised mic button). Hidden on full-screen tasks (EditProfile, BuyUnits, PaymentDone).
SideNav (1440): VOICES home (logo) | Home | Discover | Weekly report | Profile | Speak (button) | units chip "12.5 units · 7 free" (low: "Low"; zero: "Get Voice Units"). Top row: Search questions, voices and handles (shortcut "/") | Search VOICES | Nigeria | Messages | Notifications.
AnswerCard: More: report, block, copy link | Like, N likes | React (after reacting: the reaction name) | Reply, N replies | Share | Read transcript / Hide transcript | Transcript | N reactions | labels such as Most Relatable, Most Debated, Most Thought-Provoking.
NewsTag: Verified News (Confirmed by WAWU's editors against a named source. The source is linked.) | Unverified News (A news claim WAWU has not confirmed. Treat it with care.) | Gossip (Talk, rumour or opinion. Not presented as fact.)
Poll: Open poll | Live | Vote | One vote per account. Voting is free today: 3 of 3 votes left. | Confirm your vote | Back | Confirm vote | Explain your vote | N votes | Closes in X. VerifyMark: Verified | Not verified.
Admin shell (8 admin boards): VOICES logo | Admin | Today | Override the day | Topic calendar | News tags 6 | Posted results 14 | Adverts and surveys 3 | Weekly report 1 | Moderation 49 | Ngozi E. (avatar Ngozi Eze) | Editor and admin | date line.

## Design bugs found
None. No em-dash and no "Rant" in any of the 49 boards in folder C (grep of the board files). Items drawn that V-10 puts after launch, flagged in the screen files: Messages icon (Discover, Me, shell), Download PDF (Weekly, WeeklyArchive, AdminWeekly), Ad-free pass (Settings), AI Credits (Wallet), sponsored surveys (AdminToday, AdminAds), Reached 500 (Rules, AdminToday, AdminModeration), push wording (AdminOverride, Settings), bank-partner Offer (BuyUnits, V-9 says no bank wallet). Date notes: week 1 drawn as 16 Nov (V-14: 12 Nov).

## GAP table (item with no contract operation)
| # | Screen | Item | Why |
|---|---|---|---|
| 1 | Weekly, WeeklyArchive, AdminWeekly | Download PDF | no PDF route (V-10) |
| 2 | Weekly | Mood change vs last week (up 6, down 3) | sentiment is untyped, no delta field |
| 3 | All main screens | Country control | no route to change country after sign-up |
| 4 | Discover, Me, shell | Messages icon | Messages is V-10 |
| 5 | Rules, Settings | Terms, Privacy, Refunds, Help bodies and "Last updated" | no legal-page route (static) |
| 6 | Rules | Appeal a decision | APPEAL queue exists, no user route |
| 7 | Rules | "Report a problem" with no target | POST /reports needs a target |
| 8 | Category | Tab counts Open, Closed, Polls | CategoryDetail has questionCount only |
| 9 | Category | Two top voices | contract returns one topVoice |
| 10 | Category, EditProfile, Settings | Which categories I follow (read) | PUT /me/categories only, no read |
| 11 | Category | Share a category | ShareObjectType has no CATEGORY |
| 12 | Category, Discover, Person | Trending in a category; trending questions | /feed/trending returns answers, no category filter |
| 13 | Discover, Newsroom | Tag counts (24, 61, 133) and new count | TagInfo has no counts |
| 14 | Discover | Topic "10 questions" count | Topic has no question count |
| 15 | Discover | Two flash polls at once | /polls/current returns one |
| 16 | Discover | Categories "See all" target | no page defined |
| 17 | Newsroom | Category label above each post | Answer has no category |
| 18 | Newsroom | Verified News follow switch fixed on | contract lets it be turned off |
| 19 | NewsPost | Likes and replies counts on a reply | Reply has no counts |
| 20 | Me, EditProfile | Stats Reactions and Saved | no totals, no saved posts |
| 21 | Me | Saved tab and list | no save route |
| 22 | Person | Replies tab and Replies stat | no route for a person's replies |
| 23 | Person | Share a profile | ShareObjectType has no PROFILE |
| 24 | EditProfile | One "Where you are" field | contract has state and city |
| 25 | EditProfile | Remove photo control | not drawn (null allowed) |
| 26 | Settings | Ad-free pass | V-10, no route or price |
| 27 | Settings | Masked phone number in "Signed in as" | Me has no phone field |
| 28 | Wallet | AI Credits count and Get | V-10 |
| 29 | Wallet | Naira per unit in cost rows; daily free limits 20 and 3 | no field; only left-today counts |
| 30 | Wallet | History: naira amount, "free post, 7 left" | LedgerItem has neither |
| 31 | Wallet | Download statement | no route |
| 32 | BuyUnits, PaymentDone | Pay with Card, Transfer, USSD; pay by transfer or USSD | InitPaymentRequest has no method |
| 33 | BuyUnits | Per-unit price with or without bonus | effectiveKoboPerUnit meaning not stated |
| 34 | PaymentDone | Reference VU-... | txRef vs receiptNo not stated |
| 35 | PaymentDone | Held draft kept and posted after payment | no route stores or posts a draft |
| 36 | PaymentDone | Contact support | no route (static page) |
| 37 | AdminToday | "WhatsApp leads" share split | stats have totals only |
| 38 | AdminToday | "Needs you" schedule state; split counts in attention lines; nav Moderation 49 total | typed fields lack them |
| 39 | AdminOverride | Headline plus Message; Reason field | request has body only; reason required but not drawn |
| 40 | AdminCalendar | Totals, chip counts, search, status filter | not returned or not declared |
| 41 | AdminNews | Tab counts 4 and 2; editor notes; source name field; All changes log | not returned or not drawn |
| 42 | AdminResults | Thread chip counts 11 and 3; result note text | no waiting count per thread; no note field |
| 43 | AdminAds | Survey kind; two placements in one row; Live status; age bands; check results | AdKind and AdStatus lack them |
| 44 | AdminWeekly | Editor notes; Hold reason field; card title field | no notes field; reason not drawn |
| 45 | AdminModeration | Reached 500 tab; PRIORITY and APPEAL tabs; listens count; Warn alone | no such queue or action |
