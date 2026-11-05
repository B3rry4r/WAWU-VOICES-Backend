# Settings

## 1. Boards
- more/Settings-390.dc.html (top) | shots/C/Settings-390-v3.png
- more/Settings-390-2.dc.html (scrolled to Ads and privacy, down) | shots/C/Settings-390-2-v3.png
- more/Settings-1440.dc.html | shots/C/Settings-1440.png

## 2. Route
`/settings`.

## 3. Regions
390: header (Back to profile, H1 "Settings") / "Notifications" (5 switches, 2 link rows, note) / "App" (Country, Language, Data saver switch, Appearance segmented tabs) / "Ads and privacy" (2 rows) / "Help and legal" (5 rows) / "Your data" (2 rows) / Sign out button / signed-in line / BottomNav (Profile active).
1440: SideNav (Profile active) + top row; H1 with "Signed in as" line and "Sign out" button at the top; same sections in one column; no bottom bar.

## 4. Strings (verbatim)
Back to profile | Settings
Notifications | Today's question: Every morning at 8am (on) | Replies to you (on) | Reactions on your voices: Grouped, never one by one (on) | Poll results (on) | Flash polls (off) | Category alerts: Money, Work and pay, Power and light | Quiet hours: 10pm to 7am | Lock-screen alerts never show what someone said.
App | Country: Nigeria | Language: English | Data saver: Voices play only when you tap, in lighter quality (on) | Appearance | Light | Dark | System (System selected)
Ads and privacy | Ad-free pass: Hide sponsored cards and banners for 7 days. Price shown before you buy. | Blocked accounts: 2
Help and legal | Community rules | Terms of use | Privacy notice | Units, refunds and expiry | Help and contact
Your data | Export my data: Your posts, transcripts and wallet history | Delete account
Sign out | Signed in as @ada.okafor · +234 803 *** 4412
Shell strings: see README-2. Design bugs: none. Notes: "Ad-free pass" is V-10 (after launch). Alerts here are in-app at launch (V-10 push); the "Lock-screen alerts" note and Quiet hours speak of phone alerts.

## 5. States drawn
Signed-in, light, switches mostly on (Flash polls off). No dark, empty, loading, saving, error, confirm-delete, export-ready or guest state drawn. Several switches are drawn read-only.

## 6. Numbers, lists, actions
- All switches and values: GET /me/settings, PATCH /me/settings (notifyDailyQuestion, notifyReplies, notifyReactions, notifyPollResults, notifyFlashPolls, dataSaver, theme light|dark|system, language, timezone).
- "Every morning at 8am": Settings.dailyQuestionMinute.
- Quiet hours "10pm to 7am": quietHoursStart, quietHoursEnd.
- Category alerts row (names): PUT /me/categories (alertsOn); reading the followed list: GAP.
- Country: GAP (no country setting after sign-up; Profile.countryCode set in POST /me).
- Language "English": Settings.language.
- Appearance: Settings.theme.
- Ad-free pass: GAP (V-10; no route, no price).
- Blocked accounts "2": GET /me/blocks (items count); unblock DELETE /me/blocks/{userId}.
- Legal rows (Terms, Privacy, Units refunds and expiry, Help and contact): GAP (no routes; static pages).
- Export my data: POST /me/export, GET /me/export (DataExport: status, downloadUrl).
- Delete account: DELETE /me (confirmHandle, understandUnitsForfeited).
- Sign out and "Signed in as @handle · +234 ...": client with the WAWU ID session; handle Me.handle; the masked phone number: GAP (Me has no phone field).

## 7. Where each tap goes
Back: /profile. Switches: save on toggle. Category alerts: category picker. Quiet hours: time picker. Country, Language: pickers. Appearance: applies at once. Ad-free pass: none at launch. Blocked accounts: blocked list. Community rules: /settings/legal/rules. Terms, Privacy, Units refunds and expiry, Help and contact: static pages (links "#" in the board). Export my data: starts export. Delete account: confirm flow. Sign out: ends session. BottomNav: Home, Discover, Speak, Profile.
