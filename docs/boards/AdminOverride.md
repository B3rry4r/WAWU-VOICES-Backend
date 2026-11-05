# AdminOverride (Admin: Override the day)

## 1. Boards
- admin/AdminOverride-1440.dc.html | shots/C/AdminOverride-1440.png

## 2. Route
`/admin/override`.

## 3. Regions
Admin nav (README-2) / date line / H1 + status pill / "Scheduled for today" card / "What goes up instead" form (content type tabs, Headline, Message, voice note, Link) / "When and how" (Starts, Ends, replaced question tabs, 3 switches) / "What happens next" 3-day preview / buttons (Go live now, Schedule instead, Cancel) / "Override log" table.

## 4. Strings (verbatim)
Admin shell: see README-2. Monday 30 Nov 2026 · Week 3 | Override the day | Normal flow running
Scheduled for today | Which campaign promise have you heard so many times that you can recite it from memory? | Live since 8:00am with 3,482 voices. If you override, it is not lost: it moves to the next free slot.
What goes up instead | Content type: Text | Voice | Image | Link | Headline (120 max) "Lagos floods: are you and your family safe?" | Message "Tell us where you are and what you see. If you are safe, say so, so your people can hear it." (hint: Shown under the headline on Home and on the share card.) | Editor voice note (optional) (player 14 s) | Link (optional) placeholder "https://" (hint: Opens from a button under the message.)
When and how | Starts "Mon 30 Nov, 10:30am" | Ends "Tue 1 Dec, 10:30am" (hint: 24 hours. You can change it.) | The question it replaces | Move to next slot | Drop it | The replaced question
Keep the weekly theme and poll: Campaign Season and its poll stay as they are (on) | Emergency: apply now: Skips the schedule and goes live at once (on) | Send a push notification: To everyone in Nigeria who allows alerts (on)
What happens next | Mon 30: Your override, 10:30am to 10:30am | Tue 1: Which campaign promise have you heard so many times that you can recite it from memory? | Wed 2: They can afford billboards, helicopters and rallies. Why can they not afford a working clinic in your area? | The rest of the week moves forward one day. The flow resumes by itself when the override ends. Every override is logged with who, what, when and what it replaced.
Go live now | Schedule instead | Cancel
Override log | When | What went up | It replaced | By | Result
25 Nov, 9:00am | Black Friday: post the fake discounts you see today | Week 2, question 3 (moved to 26 Nov) | Ngozi E. | Ran 24 hours
16 Nov, 7:30am | Welcome to VOICES (voice note from the editors) | Nothing, launch day | Ibrahim S. | Ended early at 8:00am
Design bugs: none. Notes: "push notification" wording; push is V-10 (alerts are in-app at launch). Preview line "10:30am to 10:30am" has no day. The log shows launch day as 16 Nov (V-14 launch is 12 Nov).

## 5. States drawn
Text override filled, Emergency on, normal flow running, two log rows. Voice, Image, Link tab bodies, Drop it chosen, scheduled (not emergency), override live, cancel early, validation, loading, error not drawn.

## 6. Numbers, lists, actions
- Status and scheduled question: GET /admin/today (flowState, todaysQuestion).
- Preview "What happens next": POST /admin/overrides/preview (OverridePreview.replaced, schedule). Same body as create.
- Go live now / Schedule instead: POST /admin/overrides (CreateOverrideRequest: contentKind, body, voiceClipId, imageFileId, linkUrl, startsAt, endsAt, emergency, notifyAlert, keepWeeklyTheme, dropReplaced, reason). Headline field: GAP (request has body only; headline and message are two fields on the board). "Go live now" = emergency true.
- Voice note: POST /voice-clips (purpose OVERRIDE_NOTE). Image: POST /uploads (kind OVERRIDE_IMAGE).
- Move to next slot / Drop it: dropReplaced. Keep theme: keepWeeklyTheme. Push: notifyAlert (in-app at launch). Reason field: GAP (reason required by the request; no field drawn).
- Log table: GET /admin/overrides (AdminOverride: startsAt, body, replaced, by, result, status). Cancel early: POST /admin/overrides/{overrideId}/cancel (reason).
- Cancel button: client (discard form).

## 7. Where each tap goes
Go live now: confirm then Today with override live. Schedule instead: saves a scheduled override then /admin. Cancel: back to /admin. Nav items: other admin pages. Log row: not linked.
