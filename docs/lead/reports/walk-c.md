# Walk C: the team (moderator, editor, admin, ad manager). backend fc9e6a4, web e457dea. Stand-ins only (WAWU ID, Spaces, Gemini). Pictures: /tmp/voices-shots/walk-c/
VERDICT: PASS (no SERIOUS).
Role matrix: 53 admin routes x 7 identities (guest, no-role user, moderator, editor, ad manager, admin, editor+admin) = 371 calls, 0 mismatches (guest 401, wrong role 403).
Browser: 8 pages x 7 identities at 1440 (wrong role or no role = "We could not find that" in the admin frame; guest and no-role same as unknown page). 390 shows "Open the admin on a computer."
MEDIUM
M1 Moderation: a result sent to moderation from Posted results shows as a raw row "Result_review" / "text" (no numbers, no place) in the queue. Steps: editor, Posted results, Send to moderation; moderator opens Moderation. Expected readable row like the board's rows.
M2 Moderation "Suspend" leaves the reported post public and playable (share page 200, card 200, profile 200); only Remove/Ban hide it. By code design (V-28) but the Suspend choice does not say the post stays. Moderator picking Suspend for a threat leaves the threat up.
LOW
L1 Removed answer's share page returns HTTP 200 with "We could not find that" (noindex, no OG, cards 404: good). A real 404 would be cleaner.
L2 Curly apostrophes and quotes in admin copy (Today’s, week’s, speaker’s, “most voices”) against RULES.md.
L3 Ads: "working link" check ticks for an http:// link though the hint says https://.
L4 Calendar/Override date fields use the native format (12/03/2026) while the page shows "3 Dec".
L5 "Asking for Verified News" tab and count exist in the API but nothing sets VERIFIED_REQUESTED (board draws the tab).
L6 Results page empty state says "Open a thread" but no button; threads only by API.
L7 Weekly Instagram cover headline orphan word ("up"). Mood bar and themes absent only because test data had no reactions and fewer than 20 voices per group (not exercised).
L8 Adverts nav label is "Adverts" (board: "Adverts and surveys"); sponsored survey button not built.
PASSED: moderation (reports, remove, keep, suspend, appeals; the acting moderator is refused on their own appeal, an admin decides; posters get the reason); news tags (4 flags, change tag, keep, Verified needs a source); results (verify, not verify, 422 on votes over accredited); adverts (create, ask changes, reject, approve, betting words refused at approval); override go-live with confirm and replaced question; weekly draft (Gemini stand-in) edit, approve, auto publish, Instagram zip (3 carousel 1080x1350 + story 1080x1920, nothing posted); token corrections (idempotent replay, overdraw refused, self refused, moderator refused, audit and user history line); removed/suspended share pages.
NOT RUN: real UI sign-in as team (stand-in WAWU ID lacks CORS headers; sessions injected), calendar edit save, question day move, config and payments reverify screens (no web page), moderation voice transcript (Gemini stand-in returned a placeholder), Flutterwave.
Counts: 371 API role checks, ~80 browser page loads, 142 pictures.
