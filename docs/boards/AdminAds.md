# AdminAds (Admin: Adverts and surveys)

## 1. Boards
- admin/AdminAds-1440.dc.html | shots/C/AdminAds-1440.png

## 2. Route
`/admin/ads`.

## 3. Regions
Admin nav (README-2) / "Ad manager · 3 awaiting approval" / H1 with "New sponsored survey" and "New advert" / table (Brand, Type and placement, Audience, Dates, Views · taps · listens, Status; 5 rows) / "Preview, as people will see it" (audio ad + rules line) / "Approval checks" (4 checks, detail list, Note to the brand, 3 buttons).

## 4. Strings (verbatim)
Admin shell: see README-2. Ad manager · 3 awaiting approval | Adverts and surveys | New sponsored survey | New advert
Columns: Brand | Type and placement | Audience | Dates | Views · taps · listens | Status
Mama Nkechi's Kitchen | Ad · audio slot in the feed | Family, Money · Lagos, Ogun | 2 to 15 Dec | - | Awaiting approval
Zobo Fresh | Sponsored Survey · 3 questions | Power and light · Lagos | 1 to 7 Dec | - | Awaiting approval
Zobo Fresh | Ad · feed card and wallet banner | Money, Family · Lagos | 23 Nov to 6 Dec | 48,210 · 1,932 · - | Live
Kola Bank | Wallet offer · buy-units sheet | Everyone · Nigeria | 16 Nov to 31 Dec | 9,880 · 412 · - | Live
Lucky Stake | Ad · feed card | Sport · Nigeria | - | - | Rejected: betting
Preview, as people will see it | Mama Nkechi's Kitchen | Hear this week's soup of the day | 15 s audio | Visit page | Ad | Always labelled Ad. Plays only when tapped. Never inside a post, never in the first three items, never beside a sensitive topic.
Approval checks | Labelled Ad, with a working link | Not political, betting, tobacco or a health claim | Audio plays only on tap; transcript checked | Food claim "cures tiredness" in the audio: ask the brand to drop it
Targeting: Family, Money · Lagos, Ogun · consented age bands only | Kept away from: Politics, religion, health, sexual life | Frequency cap: 3 a day per person | Pricing: Flat fee per week, from the admin price list
Note to the brand: Please remove the line about curing tiredness. Everything else is fine. | Ask for changes | Approve | Reject
Design bugs: none. Notes: "Sponsored Survey" and "New sponsored survey" are V-10 (after launch). The word "Free" is not used.

## 5. States drawn
List with awaiting, live and rejected rows; first row open for review (one failed check). New advert form, new survey form, passed-all-checks, paused, reject reason field, empty list, loading, error not drawn.

## 6. Numbers, lists, actions
- List and "3 awaiting approval": GET /admin/ads (AdminAdPage: items, awaitingApproval). Row: AdminAd (brand, kind, status, categoryIds, states, startsOn, endsOn, views, taps, listens, rejectReason).
- Type and placement: AdminAd.kind (FEED_CARD, BANNER, AUDIO_SLOT, WALLET_OFFER). "Ad · feed card and wallet banner" (two placements in one row): GAP (one kind per advert). "Sponsored Survey · 3 questions": GAP (no survey kind; V-10).
- Audience (categories, states): categoryIds, states. "consented age bands only": GAP (no age-band field).
- Status badge: AdStatus (AWAITING_APPROVAL, APPROVED shown as Live: GAP, no LIVE status; dates decide), REJECTED with rejectReason.
- New advert: POST /admin/ads (UpsertAdRequest: brand, kind, headline, body, linkUrl, ctaLabel, imageFileId, audioClipId, categoryIds, states, startsOn, endsOn, frequencyCapPerDay, priceKobo). Edit: PATCH /admin/ads/{adId}.
- Preview: AdPlacement (headline, brand, audioClipId, ctaLabel; label Ad|Sponsored).
- Approval checks list (4 checks with pass or warning): GAP (no check results in AdminAd).
- Frequency cap 3 a day: frequencyCapPerDay. Pricing "flat fee per week": priceKobo; "admin price list": GET /admin/config.
- Kept away from: GAP (fixed rule, not a field).
- Ask for changes / Approve / Reject (and pause, resume): POST /admin/ads/{adId}/decision (AdDecision: ASK_FOR_CHANGES, APPROVE, REJECT, PAUSE, RESUME; reason). Note to the brand: reason.
- Views, taps, listens: AdminAd.views, taps, listens (counted by POST /ads/{adId}/events).

## 7. Where each tap goes
New advert: advert form. New sponsored survey: none at launch. Row: opens it in the review panel. Ask for changes, Approve, Reject: save the decision and update the status. Nav: other admin pages.
