# EditProfile (Edit profile)

## 1. Boards
- more/EditProfile-390.dc.html | shots/C/EditProfile-390-v3.png
- more/EditProfile-1440.dc.html | shots/C/EditProfile-1440.png

## 2. Route
`/profile/edit` (proposed). Full-screen task on phone (no bottom bar).

## 3. Regions
390: header (X "Cancel without saving", H1 "Edit profile") / photo (avatar, "Profile photo", Add photo, note) / Handle field / Voice Card (lead, player, Re-record, Delete) / Where you are field / "Topics you follow" (8 chips) / "Save changes" (full width, sticky end).
1440: SideNav (Profile active) + top row; header row with H1, "Cancel" and "Save changes" buttons; same sections in a form column (location field sits under the photo, above Handle); right aside "Preview": "How others see you" card.

## 4. Strings (verbatim)
Cancel without saving | Edit profile | Cancel (1440) | Save changes
Profile photo | Add photo | Optional. Without one, your initials show. Never used on share cards. | initials avatar "Ada Okafor"
Handle (prefix @, value ada.okafor) | hint: Letters, numbers, dots and underscores. People find you by it.
Your Voice Card | Your bio is your voice, up to 10 seconds. Say who you are and where you dey. | player 8 s | Re-record | Delete
Where you are (optional) (value Enugu) | hint: Shown under your handle. A state or city, never your street.
Topics you follow | We alert you when a new question lands in these. | Money (on) | Work and pay (on) | Power and light (on) | Love | Faith | Family | Roads and travel | Elections
1440 aside: How others see you | @ada.okafor | Enugu · Joined Nov 2026 | player 8 s | 48 voices · 1,240 reactions · 12 saved | Your units, free posts and referral code stay private. Only you see them.
Design bugs: none. Shell strings: see README-2 (1440 only).

## 5. States drawn
Filled form, signed-in, light. Validation errors (handle taken, bad characters), uploading photo, recording a Voice Card, saving, saved toast, discard-changes prompt not drawn. No empty Voice Card state drawn (Re-record and Delete shown with a clip present).

## 6. Numbers, lists, actions
- Save changes: PATCH /me/profile (UpdateProfileRequest: handle, displayName, bio, avatarFileId, voiceCardClipId, state, city, languages). Prefill: GET /me (Me.profile).
- Handle field and its rules: GET /me/handle-check (HandleCheck.available, reason); error HANDLE_TAKEN.
- Add photo: POST /uploads (kind AVATAR) then PUT to putUrl; avatarFileId on save. Remove photo: GAP (no control drawn; avatarFileId null allowed).
- Voice Card (re-record, delete): POST /voice-clips (purpose VOICE_CARD, durationMs up to 10 s), POST /voice-clips/{clipId}/complete, voiceCardClipId; delete DELETE /voice-clips/{clipId} (unpublished only) or set voiceCardClipId null.
- "Where you are": state or city in UpdateProfileRequest. Single free-text box: GAP (contract has two fields, state and city).
- Topics you follow (chips): PUT /me/categories (CategoryFollow: categoryId, alertsOn); options GET /categories. Current selection: GAP (no route returns followed categories).
- Preview card: client from the form; stats 48 / 1,240 / 12: voice count Profile.voiceCount; reactions and saved: GAP (see Me.md).
- Cancel: client.

## 7. Where each tap goes
X or Cancel: back to /profile (no save). Save changes: saves then /profile. Add photo: photo picker. Re-record: recorder. Delete: removes the card. Chips: toggle follow. Preview: display only.
