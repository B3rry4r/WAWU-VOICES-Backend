# Me (Profile, own)

## 1. Boards
- more/Me-390.dc.html | shots/C/Me-390-v3.png
- more/Me-1440.dc.html | shots/C/Me-1440.png

## 2. Route
`/profile`.

## 3. Regions
390: header (H1 "Profile", Messages icon, bell) / ProfileHeader (avatar, handle, place, joined, Voice Card player, 3 stats, units chip, referral code with copy, "Edit profile") / 3 link rows (Wallet, Settings, Community rules) / referral note / Tabs (My voices 48, Saved 12) / 2 post cards each with "On:" question link / BottomNav (Profile active).
1440: SideNav (Profile active) + top row; ProfileHeader and tabs and posts in the main column; the link rows move to right aside "Your account": Wallet panel (12.5, Voice Units, free posts, "Get Voice Units", "Open wallet"), "Your referral code" panel, links Settings, Edit profile, Community rules.

## 4. Strings (verbatim)
Profile | Messages | Notifications
Ada Okafor | @ada.okafor | Enugu · Joined Nov 2026 | Play Voice Card | Voice bio · 0:08 | Stats: 48 Voices | 1.2K Reactions | 12 Saved | 12.5 units · 7 free | ADA-7K2Q | Copy referral code | Edit profile
390 rows: Wallet: 12.5 units · 7 free posts left | Settings | Community rules | Your code ADA-7K2Q rides on every link you share, so friends who join from it are counted for you.
1440 aside: Wallet | 12.5 | Voice Units | 7 free posts left (FreePosts: dots of 10) | Get Voice Units | Open wallet | Your referral code | ADA-7K2Q | Copy referral code | It rides on every link you share, so friends who join from it are counted for you. | Settings | Edit profile | Community rules
Tabs (label "Your posts"): My voices 48 | Saved 12
On: As a Nigerian, are you really fine? You dey okay? | @ada.okafor Ada Okafor | 2d · Enugu | "I say I am fine because if I start talking, the bus will reach my stop before I finish." | 1,104 likes | 73 replies | reactions ❤️ 😂 💯 total 1,388 | label Most Relatable
On: When salary arrives, how many hours pass before it disappears? | 4h · Enugu | 10 s voice, transcript "Before lunch. Rent goes first, then my mother, then the tailor I owe since October." | 312 likes | 18 replies
Shell strings and AnswerCard actions: see README-2. Design bugs: none.

## 5. States drawn
Own profile, signed-in, light, My voices tab. Saved tab body, empty "no voices yet", loading, error, no Voice Card, low or zero units not drawn.

## 6. Numbers, lists, actions
- Handle, name, place, joined, voice count: GET /me (Me.profile: handle, displayName, city, state, joinedAt, voiceCount). Place shows "Enugu" (a state or city): Profile.city or state.
- Voice Card (8 s): Profile.voiceCard (untyped; clip id and duration). Play: GET /voice-clips/{clipId}/play.
- Stat Voices 48: Profile.voiceCount. Stats Reactions 1.2K and Saved 12: GAP (no reaction-received total, no saved posts).
- Units 12.5: Me.allowances.balanceMilli (12500 milli). Free posts 7: Allowances.freePostsRemaining. Wallet row detail: GET /wallet.
- Referral code: Me.referralCode. Copy: client.
- My voices list with "On:" question: GET /me/answers (Answer.questionText, questionId). Tab count 48: GAP separate count (use Profile.voiceCount).
- Saved tab and its list: GAP (no save or bookmark route).
- Edit profile: PATCH /me/profile (see EditProfile.md).
- Bell dot: Me.unreadNotifications. Messages icon: GAP (V-10).
- Get Voice Units: /wallet/buy (GET /units/tiers).

## 7. Where each tap goes
Play Voice Card: plays. Edit profile: /profile/edit. Copy: copies code. Wallet row or Open wallet: /wallet. Get Voice Units: /wallet/buy. Settings: /settings. Edit profile link (1440): /profile/edit. Community rules: /settings/legal/rules. "On:" link: /q/[id]. Tab: switches list. Messages: none at launch. BottomNav: Home, Discover, Speak, Profile.
