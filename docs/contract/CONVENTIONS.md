# VOICES API conventions

Applies to every route in `openapi.yaml`. Rulings V-1 to V-13 in `DECISIONS.md` outrank this file.
`openapi.yaml` is generated: edit `src/schemas.py` and `src/routes.py`, then run `python3 src/build.py docs/contract/openapi.yaml`
(needs python3 with PyYAML). Never hand-edit the YAML.

## Base, versioning, transport
- Base URL `https://usevoices.com/api/v1`. Versioned REST, JSON, UTF-8. A breaking change is a new `/v2`; adding a field or a route is not breaking.
- Every request and response is HTTPS. Request bodies are capped at 64 KB (audio and photos never go through the API: they go to Spaces by presigned PUT).
- Every response carries `X-Request-Id`; the same id is in the error body.

## Ids, times, numbers
- Ids are UUIDv7 strings. Never parse them.
- Times are ISO 8601 UTC with `Z` (`2026-11-30T07:00:00Z`). Dates with no time (`startsOn`, `scheduledFor`) are `YYYY-MM-DD` in the Africa/Lagos calendar. "Today" for daily allowances and the daily question is the Lagos day.
- Never send floats for money or units.
- Integers are 32-bit (V-17). Every kobo and milli field has `minimum` and `maximum` in `openapi.yaml`; a balance is 0 to 2,000,000,000 milli (CHECK in the database); one admin adjustment is at most 1,000,000 milli (1,000 units) either way.
- **Naira is integer kobo.** ₦138 is `13800`. Field names end in `Kobo`.
- **Tokens are integer milli-tokens, 1 token = 1000** (V-36). 1 token = ₦1. A text of 500 characters costs 16.67 tokens, which is `16670`. Field names end in `Milli`. The UI divides by 1000 and shows up to 2 decimals (`16.67 tokens`, `78 tokens`). WAWU Credits and any other currency do not exist here.
- The balance is the ledger's balance. A client never adds up history and calls it a balance.

## Auth and who can do what
- `Authorization: Bearer <WAWU ID access token>` (RS256, issuer `https://id.wawuafrica.com`, keys at `https://id.wawuafrica.com/.well-known/jwks.json`). The API verifies signature, expiry, issuer and audience, and maps `sub` to a VOICES user. Roles are VOICES roles stored here, never WAWU Hub roles (V-12).
- **Sign-in sends no SMS from VOICES (V-17).** The "Verify" board is WAWU ID's own sign-up step. `User.phoneHash` is the SHA-256 of the WAWU ID token's `phone` claim (the live claim set is `sub`, `email`, `phone`, `firstName`, `lastName`, `country`, `verificationTier`, `status`); one account per phone number. The token's `country` claim fills `countryCode`; languages are chosen in VOICES (`languages` on `POST /me`, `PATCH /me/profile`, as is `countryCode`).
- `POST /me` creates the VOICES profile on first sign-in; until then `GET /me` returns `profileComplete: false` and everything that needs a user returns 403 `FORBIDDEN` with `details.reason = "PROFILE_REQUIRED"`.
- Roles: `MODERATOR`, `EDITOR`, `AD_MANAGER`, `ADMIN` (admin includes all). A route lists the roles it needs (`x-wawu-roles`). Missing role is 403 `ROLE_REQUIRED`.
- `GET /api/health` is the one route outside `/api/v1`. It returns `{"status":"ok","db":"up"}`, or 503 in the one error shape when the database is down.
- A suspended or banned account can read, but every write is 403 `ACCOUNT_SUSPENDED` with `details.until`.

| Route marker in openapi | Who | Meaning |
|---|---|---|
| Auth: none | anyone | public, no token |
| Auth: guest or signed in | anyone | works without a token; a token adds `myReaction`, `iLiked`, `isMine` and so on |
| Auth: WAWU ID token | token, no profile needed | sign-in bootstrap only |
| Auth: signed in with a finished profile | user | everything that posts, reacts, votes, pays |
| Auth: signed in with role X | staff | admin console |

Guest rules (brief 4.1, addendum 7.7): a guest can read, listen, like, share, open share pages and look at polls. A guest can record and preview in the browser with no server call (the audio stays on the device); the upload starts after sign-in, at the moment of publishing. Posting, reacting, voting, paying and reporting need sign-in. Guest likes (V-15) and ad frequency use `X-Guest-Id`, rate limited per IP and guest id, (a client-made UUID kept in local storage); at sign-in the client calls `PUT /answers/{id}/like` again, so likes move to the account. Guest ids are never trusted for money.

## Errors: one shape
Every non-2xx response is:

```json
{ "error": { "code": "INSUFFICIENT_UNITS", "message": "You need 0.5 unit to post this.", "requestId": "01J...", "details": { "costMilli": 500, "balanceMilli": 0, "minPackKobo": 13800 } } }
```

`message` is plain English a person can read (no em-dashes, never the word "Rant"); clients show their own copy keyed on `code`. `details` is optional and typed per code. 429 adds `retryAfterSeconds` and a `Retry-After` header.

| HTTP | Codes |
|---|---|
| 400 | `BAD_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `MIN_TOPICS` (fewer than 3 categories) |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 402 | `INSUFFICIENT_UNITS`, `FREE_POSTS_EXHAUSTED`, `EXTRA_VOICE_REQUIRED` (details: `costMilli`, `balanceMilli`, `minPackKobo`, `needSeconds`) |
| 403 | `FORBIDDEN`, `ROLE_REQUIRED`, `ACCOUNT_SUSPENDED`, `VERIFIED_NEWS_FORBIDDEN`, `BLOCKED_BY_USER`, `CONTENT_REMOVED`, `AGE_CONFIRMATION_REQUIRED` |
| 404 | `NOT_FOUND`, `CLIP_NOT_FOUND` |
| 409 | `CONFLICT`, `ALREADY_VOTED`, `QUESTION_CLOSED`, `POLL_CLOSED`, `POLL_NOT_STARTED`, `EDIT_WINDOW_PASSED`, `HANDLE_TAKEN`, `CLIP_NOT_READY`, `UPLOAD_NOT_RECEIVED`, `PAYMENT_NOT_VERIFIED`, `PAYMENT_EXPIRED`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `VALIDATION_FAILED` (details: `fields: [{path, message}]`), `VOICE_TOO_LONG`, `TAG_REQUIRED`, `SOURCE_REQUIRED`, `PAYMENT_AMOUNT_MISMATCH` |
| 429 | `RATE_LIMITED`, `DAILY_LIMIT_REACHED` (20 outgoing messages a Lagos day; details: `limit`, `resetsAt`) |
| 502 | `TEXT_FIX_FAILED` (the AI text fix could not be made; nothing is charged) |
| 500, 503 | `INTERNAL`, `UNAVAILABLE` |

The exact enum is `ErrorCode` in `openapi.yaml`. A client treats an unknown code by its HTTP status.

## Idempotency-Key
- **Required on every POST that can move money or spend a free allowance**, and on admin wallet adjustments. In `openapi.yaml` these show the `Idempotency-Key` header: `POST /payments`, `POST /payments/{id}/verify`, `POST /admin/payments/{id}/reverify`, `POST /admin/wallets/{userId}/adjust`, and every post that may charge or is rate limited: answers, replies, proposals, votes, explain my vote, result posts, and `PUT /answers/{id}/reaction`, and `POST /text/fix`.
- Missing key: 400 `IDEMPOTENCY_KEY_REQUIRED`.
- Same key, same actor, same method and path, same body hash, inside 24 hours: the server returns the first response (same status, same body) with `Idempotent-Replay: true`. Same key with a different body: 409 `IDEMPOTENCY_KEY_REUSED`. Same key still running: 409 `REQUEST_IN_PROGRESS` (retry after a second).
- A client makes one UUID per user intent (one tap on Post, one tap on Pay) and reuses it for every retry, including after a reload or an offline queue flush. Offline recordings queue with their key.
- Payment idempotency is also enforced by unique keys in the database: `Payment(userId, idempotencyKey)`, `Payment.txRef`, `Payment.providerTxId`, `LedgerTransaction.idempotencyKey` (`payment:<id>`, `charge:<id>`). A second credit for one payment is impossible even if the HTTP layer is bypassed.

## Cursor pages
Every list returns `{ "items": [...], "nextCursor": "opaque" | null }`. Query: `cursor`, `limit` (1 to 50, default 20). Cursors are opaque, stable under inserts (keyset on `(sortKey, id)`), and expire after 24 hours. Order is fixed per route and documented in its description. Counts that are cheap come with the page (`unread`, `waiting`), never a total row count.

## Rate limits
Per account when signed in, else per IP plus guest id. Headers on every response: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. Over the limit is 429 `RATE_LIMITED`.

| Bucket | Limit |
|---|---|
| read (default) | 300 per minute |
| post (answers, replies, proposals, explain vote) | 20 per 10 minutes |
| reaction | 60 per minute |
| like | 120 per minute |
| vote | 30 per minute (and one vote per poll by constraint) |
| payment | 10 per 10 minutes |
| voice upload | 20 per 10 minutes |
| result post | 30 per 10 minutes |
| search | 60 per minute |
| share | 60 per minute |
| admin writes | 120 per minute |

Limits are config keys (`ratelimit.*` in PRICES.md) so an events mode can tighten them without a deploy.

## Posting, free posts and charging
- Every account has 10 free posts for life (text and voice together); a post is an answer or a reply. A What Next? proposal and an explain-my-vote post are free at launch (V-15: `cost.proposal_milli` and `cost.explain_milli` are 0, no free post used) but are rate limited. Deleting a post never returns it. Removing a reaction is free (V-15). Liking, sharing, reading, listening, support or challenge on a proposal, helpful marks, reports and **result posts** are free and use no free post (V-8).
- After the free posts a text post costs 0.5 unit and a voice post (up to 10 seconds) costs 1 unit. A reaction after 20 free per day costs 0.1 unit; a vote after 3 free per day costs 0.2 unit; public-interest polls are always free. Values: PRICES.md.
- The cost is knowable before the tap: `GET /me/allowance` returns the allowances and the costs, and `?action=` returns one quote. The post route repeats it in the 402 body.
- A charge is created and committed in the same database transaction as the thing it pays for. If the post fails or is rejected, the transaction rolls back; if a charge was already committed (voice processing failed later), a `REVERSAL` ledger transaction restores it. A balance never goes below zero (`CHECK`), and spending takes a row lock on the wallet.
- On 402 the client keeps the draft (text in memory and local storage; a recording on the device) and opens the buy sheet; after the units arrive it resends with the **same** Idempotency-Key.
- Voice length: free 10 s. A longer clip needs an **extra voice token** (₦150 up to 30 s, ₦200 up to 1 min, V-8): one token, one message, paid in naira, never in units, no renewal, no expiry by default. `POST /voice-clips` with `extraVoiceTokenId` raises that clip's limit and reserves the token; publishing uses it; discarding or a failed post releases it. A clip over its limit is 422 `VOICE_TOO_LONG`; asking for more time without a token is 402 `EXTRA_VOICE_REQUIRED`. Buying the token is available at the moment the person hits the limit while recording (`POST /payments` with `kind: EXTRA_VOICE`).

## Payments (V-11)
1. `POST /payments` (Idempotency-Key): the server reads the price from config and stores it on the `Payment` row; returns a Flutterwave hosted-checkout link and our `txRef`. The client never sends an amount.
2. The person pays on Flutterwave and returns to the app.
3. `POST /payments/{id}/verify` and `POST /webhooks/flutterwave` both run the same server routine: call Flutterwave's verify endpoint with the `txRef`, then check status `successful`, currency `NGN`, `amount` equal to the stored price, and `tx_ref` equal to ours. Only then, in one transaction: mark the payment `SUCCEEDED`, write a `PURCHASE` ledger transaction (units plus bonus into the wallet) or create the extra voice token, write a receipt number, and create a notification. A forged reference, a wrong amount or a replay credits nothing (409 `PAYMENT_NOT_VERIFIED` or the same success again).
4. A reconcile job runs every 10 minutes for `INITIATED` and `PENDING` payments younger than 24 hours and daily for all of yesterday, comparing our payments with Flutterwave's transactions list. The ledger total for purchases must equal the provider's succeeded total; a mismatch raises an admin flag.
5. Receipts: `GET /payments/{id}/receipt` returns the data; the web renders the printable page. Refunds are an admin action (`REFUND` ledger transaction or a provider refund); there is no self-serve refund route at launch.
- Units are never cashed out and never sent to another person (V-9): there is no route for either.

## Voice
- Record in the browser only; no file upload. `POST /voice-clips` (mime, size, duration) returns a presigned PUT to the VOICES Spaces bucket (V-3). `PUT` the bytes, then `POST /voice-clips/{id}/complete`. The server verifies the object, normalises to one mono format every browser plays (about 32 kbps), builds waveform peaks, and transcribes (screening the transcript). Statuses: `PENDING_UPLOAD`, `UPLOADED`, `PROCESSING`, `READY`, `FAILED`.
- A post that carries a clip is created with `clipId` of a `READY` clip (409 `CLIP_NOT_READY` otherwise); the client polls `GET /voice-clips/{id}` (or waits for 202 and retries). Nothing publishes without the person's Send.
- Playback: `GET /voice-clips/{id}/play` returns a short-lived signed URL for the normalised file only. Raw files are private and never signed for anyone but the team's moderation player. No download button, no raw link in any share.
- Every voice has a transcript (accessibility, search, moderation).

## News tags (addendum 1)
- A news post is an answer with `isNews: true` and exactly one tag: `VERIFIED_NEWS`, `UNVERIFIED_NEWS`, `GOSSIP`. No tag, no publish (422 `TAG_REQUIRED`). A normal user choosing `VERIFIED_NEWS` is 403 `VERIFIED_NEWS_FORBIDDEN`. Verified needs a named source (`newsSourceName`, plus `newsSourceUrl` where there is one; 422 `SOURCE_REQUIRED`) and an editor or admin.
- Every response that carries a post carries `news` (tag, who chose it, when). The tag shows in the feed, search, the Newsroom and on share cards and share pages.
- Changing a tag is an admin or editor action with a reason; it writes an append-only `TagChange` row and notifies the poster (`TAG_CHANGED`). Four or more flags, or any flag with reason `MISLEADING_NEWS_TAG` reaching the threshold in config, put the post in the news review queue.
- Whether a second approver is needed for Verified News is an open question for the owner; the contract has one approver and an audit trail.

## Ranking
`rankScore` and `debateScore` are written by a job, never by a client. Inputs: unique participants, listen-through, replies that add a point or an experience, helpful marks, different viewpoints, recency, a fair first-reader group for every new answer, manipulation score. Reaction counts and angry reactions are never the only signal and disagreement alone never buries an answer. Follower count is not an input. Sort `TOP`, `NEW`, `DEBATED`. Paid placements are a separate system: `AnswerPage.items` marks them `type: sponsored`, they are labelled, never first 3, never in sensitive topics, and never change organic order.

## Caching and live results
Public GETs (`/home`, `/questions/*`, `/calendar`, `/share/{code}`, poll results) send `Cache-Control: public, max-age=5` (results) or `max-age=30` and an `ETag`; signed-in views add `Vary: Authorization`. Poll results are cached in Redis for 2 to 5 seconds and served from the vote log's counters; `GET /polls/{id}/results/stream` is optional server-sent events.

## Share
`POST /share/links` makes a 7-character short link (with the sharer's referral code) and queues the card (1080 x 1920 and 1080 x 1080, text and brand only, four kinds: question, single voice, poll result, weekly summary). `GET /share/{code}` is the public page data (topic line, country and theme, 2 or 3 arguments with voice counts, "so far" lean, tag, transcript, featured voice, one call to action "Add your voice", "Based on N voices", last updated). Wording never claims agreement. Flagged posts fall back to topic plus call to action. Every share records an intent event; the measures are `link_open`, `add_voice_tap`, `recording_started`, `published_from_link`.

## Public config, countries, polling
`GET /config/public` (no sign-in) returns free posts, every cost in milli-units, the naira value of a unit (`unitBaseKobo`), the packs with naira prices and the extra voice token prices: clients never type a price. `GET /countries` lists Nigeria as `live` and others as `coming`; a person changes country with `PATCH /me/profile` (`countryCode`). Live results do not stream: a page polls `GET /result-threads/{id}/posts?after=<newestCursor>` and shows "N new results" from `newCount`. Payments take an optional `method` (`card`, `banktransfer`, `ussd`) sent to Flutterwave as `payment_options`.

## Account deletion (V-16)
`DELETE /me` starts a 14-day grace period (only the person's own Undo, `POST /me/deletion/cancel`, cancels it; signing in again does not). After that the profile, posts, clips and tokens balance are removed. Unspent tokens are lost, because they are never cashed out (V-9); the delete screen says so plainly. The owner may change this.

## Saved items and profile counters
`PUT/DELETE /answers/{id}/save` and `/questions/{id}/save` bookmark an answer or a question (private, one per person per item; two tables, `Save` and `SavedQuestion`); `GET /me/saved` lists both kinds (each item has `kind`); `savedCount` counts both. `Me` and `Profile` carry stored counters `savedCount` (Me only), `replyCount`, `reactionsReceived` and `voiceCount`, updated as posts and reactions change, never counted per request. `GET /people/{id}/replies` lists a person's replies.

## Admin
All under `/admin`, role-gated, every write needs a `reason` where the routes say so and writes an `AuditLog` row (who, what, when, before, after). Prices and limits are `ConfigEntry` rows, changed through `PUT /admin/config/{key}` with a reason; the change takes effect at once, is logged in `ConfigChange`, and can be rolled back. Moderator actions need a reason and are logged. The admin console is part of the web app at `/admin` (V-12) and does not touch the WAWU dashboard or the Hub.

## Language and copy
No em-dashes in any string a user reads, and never the word "Rant", in messages, notification text, share cards, seeds or errors (V-13). Strings that a user reads come from the client's copy files keyed on codes; the API sends names and numbers, not marketing text, except tag and report wording.

## Not in this contract (V-10, after launch)
Messages, AI prompts and AI Credits, phone push alerts, the weekly report PDF, reach-500 review, vote-ring detection, the ad-free pass, other languages. Their tables are deliberately not in `schema.prisma`. (Sponsored surveys and brand pages were built in V-SURVEYS and are in the contract.)
