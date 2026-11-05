# VOICES rulings

The owner's rulings for VOICES. A ruling outranks a brief, a code comment and anything an agent infers. Ids are V-n.
Product sources, newest first: the owner's words, then the addendum ("Five New Requirements", 24 Oct 2026), then the
v4.0 brief (17 Oct 2026), then the Beta brief (12 Oct 2026, design intent only).

| Id | Ruling | Who, when |
|---|---|---|
| V-1 | VOICES is a responsive WEB APP, phone first, built with React (Next.js). Not React Native, not Expo. | Owner, 4 Nov 2026 |
| V-2 | VOICES runs on its OWN DigitalOcean droplet (web app, API and database), separate from the WAWU Hub droplet. Everything stays on DigitalOcean. Sign-in is the shared WAWU ID. | Owner, 5 Nov 2026 |
| V-3 | Stored files (voice recordings, photos, share-card images) live on DigitalOcean Spaces, in a VOICES bucket of their own. | Owner, 5 Nov 2026 |
| V-4 | The design system (https://claude.ai/artifact/3fsnrkamRdPPB2NqSVZfy3) and the screens canvas (https://claude.ai/artifact/VgC2xwJ9ubB9qnbG1CbX2v) are approved and are the authority for the UI. | Owner, 4 and 5 Nov 2026 |
| V-5 | Mobile first. Every phone screen is a real phone screen (390 x 844) with an app top bar and a bottom tab bar (Home, Discover, Speak, Profile) on every main screen; the bar hides only on full-screen tasks (sign-up, recording, writing, paying, reporting, a chat). The Speak / Discuss / Vote / What Next? stage bar stays on topic screens. | Owner, 5 Nov 2026 |
| V-6 | Launch Thursday 12 Nov 2026. As many builders as the machine allows. The Fable workflow. VOICES keeps its own workflow, records and status page, apart from WHO MADE THIS?. | Owner, 5 Nov 2026 |
| V-7 | Results: WAWU uploads no results of its own. People post the numbers they see as comments in real time; each post is Verified (checked by the WAWU team) or Not verified. | Owner's boss via owner, 1 Nov 2026 |
| V-8 | As drawn (owner approved the designs, 5 Nov): result posts carry totals only (accredited, votes cast, rejected); the result-sheet photo is seen by the team only; posting a result is free and uses no free post; extra recording time is a one-off token (N150 for up to 30 s, N200 for up to 1 min, one message each, paid in naira); after the 10 free posts there is no daily free post. | Owner, 5 Nov 2026 |
| V-9 | Voice Units are an in-app count bought with naira: never cashed out, never sent to another person. No bank wallet, no identity check. The screen is called "Voice Units". | Lead default, 5 Nov 2026; owner may override |
| V-10 | After launch (week 2), not at launch: Messages, AI prompts and AI Credits, sponsored surveys and brand pages, phone push alerts (alerts are in-app at launch), the weekly report PDF, reach-500 review and vote-ring detection, the ad-free pass, other languages. | Lead default with the plan, 5 Nov 2026; owner may override |
| V-11 | Payments for units and tokens go through Flutterwave on live keys; VOICES confirms each payment with Flutterwave's verify call on return and by a reconcile job, never by trusting the browser. | Lead default, 5 Nov 2026; owner may override |
| V-12 | The VOICES admin console lives inside the VOICES app (/admin, desktop), with VOICES roles on WAWU ID accounts. It does not touch the WAWU dashboard or the Hub. | Lead default, 5 Nov 2026; owner may override |
| V-13 | No em-dashes in anything a user reads. The word "Rant" never appears anywhere in the product. | Owner (WAWU rule) and addendum 7.1 |
| V-14 | The question bank runs from launch day: week 1 starts Thursday 12 Nov 2026 (the sheet says Mon 16 Nov) and each later week shifts with it. The admin calendar can move any week. | Lead default, 5 Nov 2026; owner may override |
