# V-PEOPLE-ON-POSTS (api), branch v/people-on-posts, 14 Nov 2026

Commits: item 1 69bce22, item 2 3052e21, item 3 2091821 (all pushed; this report is a fourth commit).

## Item 1: picture wherever the name shows
One helper: `api/src/common/people.ts` (`avatarUrl(key)`, `personMarks(db, people)`). `me/views.ts` `Views.avatarUrl` now calls it; the copy in `feed/present.ts` (`fileUrl`, unused) is deleted. One query for the files per page, never one per item.
Fixed (each was `avatarUrl: null`, or a separate builder):
- talk/views.ts (answer writer, reply writer; posts.service now uses `views.replies`)
- feed/present.ts x2 (recent voices on question cards; answer author), feed.service.ts (search people row; faces now read status)
- vote/views.ts (voter, proposal and explain-vote author; proposal.service, poll.service)
- results/author.ts (had its own lookup; now the helper; results.service NO_AUTHOR stays null: a purged account)
- reach/share-subject.ts x2 (answer, proposal), admin/groups.service.ts, me/views.ts (profiles, saved-question faces), dm/dm.service.ts (field was missing: list, thread, with-person).
Not changed: invite friends list (no picture field in its contract shape).
Rules: picture only when the account status is ACTIVE (suspended, banned, deleting, deleted give null); file must be kind AVATAR and not purged. Nameless: answers return `author: null` (and the helper is not called for them, also on the share page). Replies have no `anonymous` flag in the schema or the API, so there is no nameless reply; the test covers the nameless answer. Blocks are untouched.
Upload path (read and run): POST /uploads (AVATAR) -> PUT -> /complete -> PATCH /me/profile {avatarFileId} confirms owner and kind, claims the file and writes User.avatarFileId -> /me builds the address from StoredFile.key. Works; new spec drives it end to end (/me returns the address). Nothing broken found. Cause of the report was only the hard-coded nulls.
Contract: AuthorRef, Profile, AvatarRef already had avatarUrl; DmPerson lacked it, added.

## Item 2: Admin mark
Every author shape gains `admin` (Profile, AuthorRef, AvatarRef, DmPerson in contract; additive, optional). Loaded in `personMarks` with one grouped `UserRoleGrant` query (role ADMIN, userId in page) beside the file query, run in parallel: +1 query per page, 0 per item. Read at request time, so removing the role turns it off at once (tested). Editor, moderator, member: false. Nameless post: author null, no field. Not gated on account status (role only).

## Item 3: 2,500
Default changed in units/units.defaults.ts, feed/public-config.ts, vote/vote-config.ts, talk/shared/config-reader.ts, admin/config-catalogue.ts (default only; the admin max stays 5000, so an admin may still choose more), docs/contract/PRICES.md (two rows), schemas.py (TextFixRequest). Not changed: DM 5,000 (own constant), proposal.max_chars 500, price rows that are 5000 milli.
Applies to: written answers, replies, edits and the AI text fix (all read `text.max_chars`). A stored longer post stays readable; its edit must fit: refusal "Keep it to 2500 characters." (tested, 3,000 stored, edit 3,000 refused 422, 2,500 accepted).
Public config field: already `costs.textMaxChars` (GET /config/public, and /me allowances); now 2500, tested. No new field.
Migration 20261114350000_text_max_2500 (+ rollback.down.sql): 5000 -> 2500 with ConfigChange "owner, 14 Nov 2026"; other values and no row untouched; rollback restores only 2500. Checked on a database built from the 23 origin/main migrations (5000 -> 2500 + 1 change row, other.x untouched, rollback 5000, 3000 stayed 3000) and by test/people/text-max-migration.spec.ts.

## Assertions changed (old -> new)
- talk.spec.ts:245 over-long body 5001 -> 2501 chars
- token-prices.spec.ts: 5,000 accepted / 5,001 refused, cost 166670 -> 2,500 / 2,501, cost 83330 (emoji likewise)
- text-fix.spec.ts: over 5,000 refused -> over 2,500; the 4,998-char fix that passed -> 2,498
- feed.spec.ts:570 public config textMaxChars 5000 -> 2500
No `avatarUrl: null` assertion existed.

## Commands
- tsc --noEmit clean; eslint on touched files: 0 errors (some warnings pre-existing style)
- Item 1 jest folders: 73 suites, 820 passed; item 2: 98 suites, 1068 passed
- Final: whole suite on a fresh database (PostgreSQL 16 port 55432, Redis 56379): 124 suites, 1381 passed, 1 skipped, 1 failed (feed.spec pinned 5000); fixed, rerun 25/25. Not re-run as a whole after that one-line change.
- Contract rebuilt; build to /tmp/o.yaml and cmp: identical.

## Unsure
- Admin max for text.max_chars left at 5000 (an admin-chosen 3000 stays valid).
- Feed pages cached for guests carry the picture/mark until the cache expires.
