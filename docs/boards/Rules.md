# Rules (Help and legal: Community rules)

## 1. Boards
- more/Rules-390.dc.html | shots/C/Rules-390-v3.png
- more/Rules-1440.dc.html | shots/C/Rules-1440.png

## 2. Route
`/settings/legal/rules` (proposed); sibling tabs `/settings/legal/terms`, `/privacy`, `/refunds`.

## 3. Regions
390: header (Back to settings, "Help and legal") / Tabs (Rules, Terms, Privacy, Refunds; Rules selected) / H1, date, lead line / 6 numbered rules (icon, title, line) / "When a post breaks a rule" 4 steps / Banner "Named in a post?" / "Report a problem" button (full width) / BottomNav (Profile active).
1440: SideNav (Profile active) + top row; no "Help and legal" header; same tabs, H1, rules and steps in the main column; right aside "Help": Banner, "Always free" block, "Report a problem".

## 4. Strings (verbatim)
Back to settings | Help and legal | Rules | Terms | Privacy | Refunds | Legal pages (tab label)
Community rules | Last updated 16 Nov 2026 | VOICES is for strong opinions and real disagreement. We step in for harm, never for a point of view.
1 Speak your mind, disagree hard: Go after the idea, not the person.
2 No threats, harassment or hate: That includes attacks on someone's tribe, faith, gender or disability.
3 Keep private details private: No phone numbers, home addresses or account numbers, yours or anyone's.
4 News carries a tag: Sharing news? Pick Unverified News or Gossip. Only WAWU editors mark Verified News.
5 One person, one vote: Nobody can buy votes. We remove coordinated voting and scams.
6 Adults only: You must be 18 or older to use VOICES.
When a post breaks a rule
1 Someone reports it, or it reaches 500 people and a moderator checks it before it spreads further.
2 A moderator listens, reads the transcript and decides. Every decision is logged with a reason.
3 The post is removed, or the account is warned or suspended. You are told why.
4 Think we got it wrong? Appeal from the notice. A different moderator looks again.
Named in a post? | Use Report on the post and choose "This is about me". It goes to the front of the queue. | Report a problem
1440 only: Always free | Reading, listening, liking and sharing never cost anything. Paid posts always show their price first.
Shell strings: see README-2. Design bugs: none. Note: step 1 "reaches 500 people ... checks" is reach-500 review, listed V-10 (after launch).

## 5. States drawn
Rules tab, signed-in, light. Terms, Privacy and Refunds tab bodies are not drawn.

## 6. Numbers, lists, actions
- Rules, steps, banner, "Always free": static copy (no route).
- "Last updated 16 Nov 2026": GAP (no route or field for legal page dates; static).
- Terms, Privacy, Refunds body text: GAP (not drawn, no route; static pages).
- Report a problem: POST /reports (targetType, reason, note). The button here has no target: GAP for a general problem report (contract reports a target only).
- "This is about me" reason: ReportReason ABOUT_ME (priority queue: ModerationItem.priority).
- Appeal from the notice: ModerationQueue APPEAL exists; GAP for a user route to file an appeal.
- Age 18 rule: CreateMeRequest.ageConfirmed.

## 7. Where each tap goes
Back: /settings. Tabs: the four legal pages. Report a problem: a report form (target not defined). BottomNav: Home, Discover, Speak, Profile.
