ROUTES = []
def R(group, line, op, summary, auth="user", req=None, res=None, q=None, errs=None, idem=False, status=200, desc=None, rl=None, ctype=None, raw=False):
    m, p = line.split(" ", 1)
    ROUTES.append(dict(group=group, method=m.lower(), path=p, op=op, summary=summary, auth=auth, req=req, res=res, q=q or [], errs=errs or [], idem=idem, status=status, desc=desc, rl=rl, ctype=ctype, raw=raw))

PAGE_Q = ["cursor:str:Opaque cursor from nextCursor", "limit:int:1 to 50, default 20"]
ADM = "role:ADMIN"
EDI = "role:EDITOR,ADMIN"
MOD = "role:MODERATOR,ADMIN"
ADS = "role:AD_MANAGER,ADMIN"

# ---------------- me / profile
G = "me-profile"
R(G, "POST /me", "createMe", "Create my VOICES profile after WAWU ID sign-in", "token", "CreateMeRequest", "Me", errs=[409, 422], status=201,
  desc="Idempotent. The bearer token is a WAWU ID RS256 token. Needs 18+ confirmation, terms and rules acceptance, a free handle and 3 or more categories. Creates the tokens balance, free allowance (5 posts) and settings. Records the referral if a code is sent.")
R(G, "GET /me", "getMe", "My account, roles, allowances and unread count", "token", None, "Me", desc="Before profile creation returns profileComplete false with handle null.")
R(G, "PATCH /me/profile", "updateProfile", "Edit my profile", "user", "UpdateProfileRequest", "Profile", errs=[409, 422])
R(G, "GET /me/handle-check", "checkHandle", "Is a handle free?", "token", None, "HandleCheck", q=["handle:str:3 to 20 of a-z 0-9 . _"])
R(G, "GET /me/allowance", "getAllowance", "What I can do now and what each action costs", "user", None, "Allowances", q=["action:str:Optional POST_TEXT, POST_VOICE, REACTION or VOTE, to get one quote"],
  desc="The recorder, composer and vote screens read this before any tap so there are no surprise charges.")
R(G, "GET /me/settings", "getSettings", "My settings", "user", None, "Settings")
R(G, "PATCH /me/settings", "updateSettings", "Change my settings", "user", "UpdateSettingsRequest", "Settings", errs=[422],
  desc="useMyStateForSurveys (default false): allow Sponsored Surveys aimed at states to be shown to me when my state is one of them.")
R(G, "GET /me/invite", "getMyInvite", "My personal invite link", "user", None, "MyInvite", errs=[403],
  desc="LCH-06: my one invite code, made the first time it is asked for and never changed, the link built from PUBLIC_WEB_BASE (url is PUBLIC_WEB_BASE/go/code), and how many friends have answered through it.")
R(G, "POST /me/invite/claim", "claimInvite", "Count me as the friend of the person whose link brought me", "user", "ClaimInviteRequest", None, status=204, errs=[403],
  desc="LCH-06: the web sends the code it kept for the visitor (30 days, first link wins) after the person has posted an answer. Always 204; it never says whether the code was valid. Ignored when the code is unknown or my own, when I already have an inviter, when my account is older than 30 days, when I have no published named (not anonymous) answer, or when either of us blocked the other. Limited to 10 a minute per signed-in person (429 with Retry-After), with a high per-address ceiling as an abuse guard.")
R(G, "GET /me/friends", "listMyFriends", "Friends who answered through my link", "user", None, "FriendsPage", q=["cursor:str:", "limit:int:"], errs=[400, 403],
  desc="LCH-06: the count and a cursor page of the people who came through my link and answered, newest first. A friend's word is returned only to me, only if the friend's Share my word is on at this moment (else word is null and wordShared is false); the friend still counts. A friend counts and shows only through a published, named (not anonymous) answer. Never in a public response.")
R(G, "GET /invites/{code}", "getInviter", "Who sent this invite link (handle only)", "none", None, "InviterHandle", rl=None,
  desc="LCH-A2: for the 'asked how you feel' line on /go. Returns the owner's handle and nothing else. A code with the wrong shape, an unknown code or an owner who is not an active account all answer handle null, so the page shows no line. Never cached. Limited to 60 a minute per network address (429).")
R(G, "PUT /me/categories", "setCategories", "Set the categories I follow and their alerts", "user", "SetCategoriesRequest", "SetCategoriesRequest", errs=[400, 422], desc="At least 3 categories, else 400 MIN_TOPICS.")
R(G, "GET /me/categories", "getCategories", "The categories I follow and their alert switches", "user", None, "CategoryFollowList")
R(G, "PUT /me/tag-follows", "setTagFollows", "Set the news tags I follow", "user", "SetTagFollowsRequest", "SetTagFollowsRequest", desc="Verified News is always followed: the server keeps it in the list.")
R(G, "GET /me/answers", "listMyAnswers", "My voices", "user", None, "AnswerPage", q=PAGE_Q)
R(G, "GET /me/saved", "listSaved", "My saved answers and questions", "user", None, "SavedPage", q=PAGE_Q + ["kind:str:ANSWER or QUESTION"], desc="Both kinds, newest saved first; each item has a kind. savedCount counts both.")
R(G, "GET /me/blocks", "listBlocks", "People I blocked", "user", None, "BlockedUserPage", q=PAGE_Q)
R(G, "PUT /me/blocks/{userId}", "blockUser", "Block a person", "user", None, None, status=204, errs=[404])
R(G, "DELETE /me/blocks/{userId}", "unblockUser", "Unblock a person", "user", None, None, status=204)
R(G, "GET /people/{userId}/replies", "listPersonReplies", "A person's replies", "optional", None, "ReplyPage", q=PAGE_Q, errs=[404], desc="Newest first. Replies on removed posts are left out.")
R(G, "GET /people/by-handle/{handle}", "getPersonByHandle", "A person's public profile and recent voices, by handle", "optional", None, "PublicProfile", q=PAGE_Q, errs=[404],
  desc="The same answer as GET /people/{userId}: blocks and the public-status rule apply the same way. The handle is matched without case.")
R(G, "GET /people/{userId}", "getPerson", "A person's public profile and recent voices", "optional", None, "PublicProfile", q=PAGE_Q, errs=[404])
R(G, "POST /me/export", "requestExport", "Ask for an export of my data", "user", None, "DataExport", status=202, errs=[429], desc="Posts, transcripts and tokens history. Built in the background; poll GET /me/export.")
R(G, "GET /me/export", "getExport", "My latest data export", "user", None, "DataExport", errs=[404])
R(G, "POST /me/deletion/cancel", "cancelDeletion", "Undo my pending account deletion", "token", None, "Me", errs=[409],
  desc="The only way a pending deletion is cancelled (lead ruling WF, fix round 1, RW9). Idempotent: with nothing pending it answers the same Me. 409 once the purge has run. Writes an audit line.")
R(G, "DELETE /me", "deleteAccount", "Delete my account", "user", "DeleteAccountRequest", None, status=202, errs=[422],
  desc="Starts a 14 day grace period (cancelled only by the person's own Undo, POST /me/deletion/cancel; signing in or a refreshed token never cancels it), then removes the profile, posts, clips and tokens balance. Unspent tokens are lost (they are never cashed out, V-9) and the delete screen says so plainly.")

# ---------------- verification (V-46)
G = "verification"
R(G, "GET /me/verification", "getMyVerification", "Where my verification stands", "user", None, "VerificationState",
  desc="V-46: state is NOT_SUBSCRIBED, READY, UNDER_REVIEW, VERIFIED, REJECTED (reason in request.reason, in plain words), EXPIRED (sent and never decided for 90 days: send again) or LAPSED. Verified means an admin approved the ID and utility bill and the subscription is running; verifiedUntil is the end of the plan (a renewal extends it).")
R(G, "PUT /me/verification/documents/{kind}", "putVerificationDocument", "Upload my ID (kind id) or my utility bill (kind bill)", "user", None, "VerificationState", raw=True, errs=[403, 409, 413, 415, 422], rl="verification-upload",
  desc="V-46: the body is the file itself (not JSON, not a form): jpeg, png, webp, heic or pdf, at most 10 MB. The type is read from the bytes, never from the name. Stored privately; no link to it is ever given to the person or the public. Sending again replaces that document. 403 subscription_required (message: Subscribe to get verified.) without a running subscription; 409 while the request is with the team or the person is already verified.")
R(G, "POST /me/verification/submit", "submitVerification", "Send both documents to the team", "user", None, "VerificationState", errs=[403, 409, 422],
  desc="V-46: needs both documents and a running subscription (403 subscription_required). Moves the request to UNDER_REVIEW. After a rejection the person uploads again and submits again.")
R(G, "GET /admin/verification", "adminListVerification", "The verification queue", ADM, None, "AdminVerificationPage", q=PAGE_Q + ["status:str:pending (default, oldest first) or decided (newest first)"],
  desc="V-46: each item has the person, the plan and its end date. The documents are not in the list: open one to get their links.")
R(G, "GET /admin/verification/{requestId}", "adminGetVerification", "One request (no documents, no links)", ADM, None, "AdminVerification", errs=[404],
  desc="V-46: who, the plan, the state, and whether each document is still there. Never cached (Cache-Control: no-store).")
R(G, "GET /admin/verification/{requestId}/documents/{kind}", "adminOpenVerificationDocument", "Open one document: a signed link", ADM, None, "VerificationDocumentLink", errs=[404],
  desc="V-46: kind is id or bill. The link stops working after 5 minutes (expiresAt), serves the stored type as an attachment, and is made only here. Each open is written to the audit log (who and which document, never the link). 404 once the files are deleted. Never cached.")
R(G, "POST /admin/verification/{requestId}/approve", "adminApproveVerification", "Approve a request", ADM, "ApproveVerificationRequest", "AdminVerificationDecision", errs=[403, 404, 409],
  desc="V-46: the person is verified until the end of their subscription. 409 if another admin decided first, or the person has no running subscription. An admin cannot decide their own request (403). Writes an audit row and sends the person a mail.")
R(G, "POST /admin/verification/{requestId}/reject", "adminRejectVerification", "Reject a request with a reason", ADM, "RejectVerificationRequest", "AdminVerificationDecision", errs=[403, 404, 409],
  desc="V-46: a reason code is required (OTHER needs a note). The person sees the words for the code, then the note, and can upload again. 409 if another admin decided first. Writes an audit row and sends the person a mail.")

# ---------------- topics and calendar
G = "topics-calendar"
R(G, "GET /topics/current", "getCurrentTopic", "Topic of the week", "optional", None, "Topic")
R(G, "GET /topics/{topicId}", "getTopic", "One topic", "optional", None, "Topic", errs=[404])
R(G, "GET /calendar", "listCalendar", "The public topic calendar", "optional", None, "CalendarPage", q=PAGE_Q + ["status:str:Filter by TopicStatus"])
R(G, "GET /config/public", "getPublicConfig", "Prices, costs and free posts for guests", "none", None, "PublicConfig", rl="read", desc="Landing, Onboarding and the token screens read this. Nothing is typed into a client.")
R(G, "GET /countries", "listCountries", "Launch countries: Nigeria live, others coming", "none", None, "CountryList", desc="Fills the Country board and the country pill. Changing country is PATCH /me/profile with countryCode.")
R(G, "GET /categories", "listCategories", "Categories with this week's voice counts", "optional", None, "CategoryList")
R(G, "GET /categories/{slug}", "getCategory", "A category: today's question, its questions, top voices, tab counts", "optional", None, "CategoryDetail", q=PAGE_Q + ["tab:str:open, closed or polls (default open)"], errs=[404])

# ---------------- questions and feed
G = "questions-feed"
R(G, "GET /home", "getHome", "Home: topic of the week, daily question, flash poll, trending, new", "optional", None, "Home", rl="read")
R(G, "GET /questions/today", "getTodaysQuestion", "Today's question (the override if one is live)", "optional", None, "Question")
R(G, "GET /questions/{questionId}", "getQuestion", "One question (conversation header)", "optional", None, "Question", errs=[404])
R(G, "GET /questions", "listQuestions", "Questions, newest or by category", "optional", None, "QuestionPage", q=PAGE_Q + ["categoryId:uuid:", "kind:str:QuestionKind", "status:str:LIVE or CLOSED"])
R(G, "GET /feed/trending", "getTrending", "Trending answers", "optional", None, "AnswerPage", q=PAGE_Q + ["categoryId:uuid:", "tag:str:NewsTag filter"],
  desc="Ranked by listen-through, replies, new points and helpful marks, with a fair chance for new answers. Reaction counts and angry reactions are never the only signal.")
R(G, "GET /feed/trending-questions", "getTrendingQuestions", "Trending questions, optionally in one category", "optional", None, "QuestionPage", q=PAGE_Q + ["categoryId:uuid:"])
R(G, "GET /feed/new", "getNewConversations", "New conversations", "optional", None, "QuestionPage", q=PAGE_Q)
R(G, "GET /questions/{questionId}/answers", "listAnswers", "Answers under a question", "optional", None, "AnswerPage", q=PAGE_Q + ["sort:str:TOP, NEW or DEBATED (default TOP)", "tag:str:Filter by NewsTag", "mood:str:LCH-02: only answers that carry this word (ANGRY, TIRED, PROUD or HOPEFUL); any other value is a 422"], errs=[404, 422],
  desc="Sponsored cards are inserted after every 8 to 10 organic items, never in the first 3, never on sensitive topics.")
R(G, "GET /questions/{questionId}/polls", "listQuestionPolls", "Polls that belong to this conversation", "optional", None, "PollList", errs=[404])

# ---------------- answers
G = "answers"
R(G, "POST /voice-clips", "createVoiceClip", "Start a voice upload: get a presigned PUT to Spaces", "user", "CreateVoiceClipRequest", "VoiceUpload", status=201, errs=[402, 413, 415, 422],
  desc="Checks the length against the person's limit (60 s; before V-36 a longer clip needed an extra voice token). Guests record and preview in the browser only; the upload starts after sign-in.", rl="voice-upload")
R(G, "POST /voice-clips/{clipId}/complete", "completeVoiceClip", "Tell the server the PUT is done", "user", None, "VoiceClip", status=202, errs=[404, 409, 422],
  desc="Verifies the object exists, then queues normalisation (one format for all browsers), waveform and transcription.")
R(G, "GET /voice-clips/{clipId}", "getVoiceClip", "Clip status, waveform and transcript", "optional", None, "VoiceClip", errs=[404])
R(G, "GET /voice-clips/{clipId}/play", "getPlayUrl", "A short-lived signed streaming URL", "optional", None, "PlayUrl", errs=[404, 409], rl="read",
  desc="Only READY clips of PUBLISHED posts. Raw audio is never offered for download. Guests may listen.")
R(G, "DELETE /voice-clips/{clipId}", "deleteVoiceClip", "Discard an unpublished clip", "user", None, None, status=204, errs=[404, 409])
R(G, "POST /uploads", "createUpload", "Presigned PUT for a photo (avatar, result sheet)", "user", "CreateUploadRequest", "FileUpload", status=201, errs=[413, 415, 422])
R(G, "POST /uploads/{fileId}/complete", "completeUpload", "Tell the server the photo PUT is done", "user", None, "UploadedFile", errs=[403, 404, 409, 422, 503],
  desc="Checks the object is there and the size that was signed, then confirms the file so it can be used (an avatar in PATCH /me/profile avatarFileId). 409 UPLOAD_NOT_RECEIVED if the PUT has not landed. Repeating it is safe.", rl="voice-upload")
R(G, "POST /questions/{questionId}/answers", "createAnswer", "Post a text or voice answer (or a news post)", "user", "CreateAnswerRequest", "PostReceipt", idem=True, status=201,
  errs=[402, 403, 404, 409, 422], rl="post",
  desc="Spends a free post or units atomically with the post; a failed post reverses the spend. 402 INSUFFICIENT_UNITS or FREE_POSTS_EXHAUSTED carries the cost and the cheapest pack so the client can show the buy sheet and keep the draft. Uses the free allowance of 10 for text and voice together.")
R(G, "GET /questions/{questionId}/moods", "getQuestionMoods", "Counts per mood word (How Nigeria feels so far)", "none", None, "MoodCounts", errs=[404],
  desc="LCH-02: valid answers per word, everyone, whole percents. Valid is one per person (their latest), published, not deleted, not by a suspended, banned or deleted person. Read from stored counts (Redis) that a background job refreshes, never counted per request. 404 for a question with no words or one that has not opened.")
R(G, "GET /answers/{answerId}/where-you-sit", "getWhereYouSit", "Where my word sits, in Nigeria and the World", "user", None, "WhereYouSit", errs=[404],
  desc="LCH-04: the share of valid answers with the same word, in Nigeria (people whose country is Nigeria) and in the World. A percentage only when the group holds at least 50 valid answers, else null and the line is You are one of the first. Counts are stored and refreshed in the background; the person's own new answer is added at once. 404 unless it is the signed-in person's own published mood answer.")
R(G, "PATCH /answers/{answerId}/card", "setAnswerCardName", "Show my name on the share card", "user", "CardNameRequest", "CardNameResult", errs=[403, 404, 422],
  desc="LCH-03: the author turns Show my name on the card on or off for a mood answer. Off by default. Call POST /share/links again after it so the card is drawn again.")
R(G, "GET /answers/{answerId}", "getAnswer", "One answer", "optional", None, "Answer", errs=[404])
R(G, "PATCH /answers/{answerId}", "editAnswer", "Edit my text answer (5 minutes)", "user", "EditAnswerRequest", "Answer", errs=[403, 404, 409, 422])
R(G, "DELETE /answers/{answerId}", "deleteAnswer", "Delete my answer (never returns the free post)", "user", None, None, status=204, errs=[403, 404])
R(G, "POST /answers/{answerId}/listen", "recordListen", "Count a listen, and keep how much of the clip a person played", "optional", "ListenRequest", None, status=204, rl="listen",
  desc="An old body (completed, positionMs) or an empty one counts as a start. A progress report adds secondsPlayed (the most reached) and finished (played to at least 90%). One record per person per answer; it is never shown to anyone and only counts feed the ranking. A request without a visitor id (signed out) records nothing. The server decides finished from the time it has seen: a finish needs the clip's own time to have passed since the first report, so the old body {completed: true} alone is never a finish. At most 120 reports a minute per visitor and 300 per network address.")
R(G, "PUT /answers/{answerId}/helpful", "markHelpful", "Mark an answer helpful", "user", None, None, status=204, errs=[404])
R(G, "DELETE /answers/{answerId}/helpful", "unmarkHelpful", "Remove my helpful mark", "user", None, None, status=204)
R(G, "PUT /questions/{questionId}/save", "saveQuestion", "Save a question (bookmark)", "user", None, None, status=204, errs=[404], desc="Idempotent.")
R(G, "DELETE /questions/{questionId}/save", "unsaveQuestion", "Remove a saved question", "user", None, None, status=204)
R(G, "PUT /answers/{answerId}/save", "saveAnswer", "Save an answer (bookmark)", "user", None, None, status=204, errs=[404], desc="Idempotent: saving twice is the same as once.")
R(G, "DELETE /answers/{answerId}/save", "unsaveAnswer", "Remove a saved answer", "user", None, None, status=204)

# ---------------- replies
R(G, "POST /answers/{answerId}/videos", "makeAnswerVideo", "Make a video of my own voice answer", "user", "MakeVideoRequest", "VoiceVideo", status=202, errs=[403, 404, 422, 429],
  desc="LCH-07: only when the person asks. Builds an MP4 in the background (9x16 is 1080x1920, 1x1 is 1080x1080, at most 15 seconds: discrete bars from the voice's own levels, the played part highlighted as it plays, a running clock, captions from the stored transcript, the question, the mood word on a mood question, the logo; no photos). Answers 202 with the video as QUEUED. Asking again for a shape that is queued, being made or ready returns that video. Only the answer's author can ask (403 for anyone else); a text answer is a 422; a removed or deleted answer is a 404. A person may ask for 5 videos a Lagos day, every build counted whatever its outcome, then 429 RATE_LIMITED with resetsAt and retryAfterSeconds (Lagos midnight). A failed build can be asked for again (a new build); an answer that was removed and restored can too, its old video stays deleted. Until it is READY the share uses the audio link. The person gets an in-app notice (type VIDEO_READY) when it is ready or could not be made.")
R(G, "GET /answers/{answerId}/videos", "listAnswerVideos", "My videos of my answer", "user", None, "VoiceVideoList", errs=[404],
  desc="LCH-07: the author's newest video of each shape with its state (QUEUED, MAKING, READY, FAILED). Empty once the answer is removed or deleted. Anyone else gets a 404.")
R(G, "GET /voice-videos/{videoId}/file", "getVoiceVideoFile", "The MP4 of my video", "user", None, None, errs=[404], ctype="video/mp4",
  desc="LCH-07: the video file, for its author only, while the answer is published. Never cached, never a public link. A removed or deleted answer's video, a video that is not READY and anyone else's video are a 404.")

G = "replies"
R(G, "GET /answers/{answerId}/replies", "listReplies", "Replies to an answer (one level deep)", "optional", None, "ReplyPage", q=PAGE_Q + ["stance:str:AGREE, DISAGREE or EXPERIENCE"], errs=[404])
R(G, "POST /answers/{answerId}/replies", "createReply", "Reply by voice or text, saying agree, disagree or my experience", "user", "CreateReplyRequest", "ReplyReceipt", idem=True, status=201, errs=[402, 403, 404, 409, 422], rl="post")
R(G, "DELETE /replies/{replyId}", "deleteReply", "Delete my reply", "user", None, None, status=204, errs=[403, 404])

# ---------------- likes
G = "likes"
R(G, "PUT /answers/{answerId}/like", "likeAnswer", "Like (heart). Free, guests allowed by X-Guest-Id", "optional", None, "LikeState", errs=[404], rl="like")
R(G, "DELETE /answers/{answerId}/like", "unlikeAnswer", "Remove my like", "optional", None, "LikeState", rl="like")

# ---------------- reactions
G = "reactions"
R(G, "GET /reactions", "listReactionKinds", "The 10 reactions with names and emoji", "none", None, "ReactionKindList")
R(G, "PUT /answers/{answerId}/reaction", "setReaction", "Set or change my one reaction", "user", "ReactionRequest", "ReactionState", idem=True, errs=[402, 404, 422], rl="reaction",
  desc="One per account per answer. The first set after the 20 free a day costs 0.1 unit. Changing it is never charged again. Removing it never refunds.")
R(G, "DELETE /answers/{answerId}/reaction", "removeReaction", "Remove my reaction", "user", None, "ReactionState")

# ---------------- reports and blocks
G = "reports-blocks"
R(G, "POST /reports", "createReport", "Report an answer, reply, proposal, result post or person", "user", "CreateReportRequest", "ReportReceipt", status=201, errs=[404, 409, 422],
  desc="Reason ABOUT_ME takes the priority route. MISLEADING_NEWS_TAG sends the post to the admin news review queue. alsoBlock blocks the author in the same call. The reported person is never told who reported.")
R(G, "POST /appeals", "createAppeal", "Appeal a moderation decision", "user", "AppealRequest", "AppealReceipt", status=201, errs=[404, 409], desc="Opens an item in the APPEAL queue; a different moderator looks again. Reachable by a suspended or banned person. The note is up to 500 characters. 409 when a decision is not there to appeal, or an appeal on this target already exists (lead ruling WF, 6 Nov, RW2).")
R(G, "POST /support/messages", "createSupportMessage", "Report a problem or contact support", "optional", "SupportMessageRequest", "SupportReceipt", status=201, errs=[422], rl="share", desc="No target needed. A payment reference may be attached.")
R(G, "POST /news/{answerId}/flag", "flagNewsTag", "Flag a news post's tag as misleading", "user", "FlagRequest", "ReportReceipt", status=201, errs=[404, 409])

# ---------------- polls and votes
G = "polls-votes"
R(G, "GET /polls/current", "getFlashPoll", "The open flash poll for Home", "optional", None, "Poll", desc="200 with a null body when no flash poll is open (lead ruling WF, 6 Nov, A-L1).")
R(G, "GET /polls/flash", "listFlashPolls", "All open flash polls", "optional", None, "PollList")
R(G, "GET /polls/{pollId}", "getPoll", "A poll with its options and my vote", "optional", None, "Poll", errs=[404])
R(G, "POST /polls/{pollId}/votes", "castVote", "Vote, once per account", "user", "VoteRequest", "VoteReceipt", idem=True, status=201, errs=[402, 404, 409, 422], rl="vote",
  desc="One vote per account and phone number. 3 free votes a day, then 0.2 unit; public-interest polls are always free. The cost is shown before confirming (GET /me/allowance?action=VOTE). A second vote returns 409 ALREADY_VOTED. The vote log is append-only.")
R(G, "GET /polls/{pollId}/results", "getPollResults", "Live results", "optional", None, "PollResults", errs=[404, 403], rl="read",
  desc="Counts and percentages come from the vote log, cached for a few seconds. Hidden until the person has voted or the poll closed, unless the poll shows live results.")
R(G, "GET /polls/{pollId}/results/stream", "streamPollResults", "Live results as server-sent events", "optional", None, None, errs=[404], ctype="text/event-stream",
  desc="Optional. Sends a PollResults JSON line when counts change. Clients may poll /results instead.")
R(G, "POST /polls/{pollId}/explanation", "explainMyVote", "Explain my vote by voice or in words", "user", "ExplainVoteRequest", "PostReceipt", idem=True, status=201, errs=[403, 404, 409, 422], rl="post",
  desc="Only the person who voted. Creates an answer under the poll's question. Free at launch (V-15): cost.explain_milli is 0 and it uses no free post, but it is rate limited. The person can also skip it and go back to the discussion.")

# ---------------- what next
G = "what-next"
R(G, "GET /questions/{questionId}/what-next", "getWhatNext", "What Next? summary, groups and proposals", "optional", None, "WhatNext", q=PAGE_Q + ["sort:str:SUPPORT or NEW"], errs=[404])
R(G, "GET /questions/{questionId}/proposals/similar", "similarProposals", "Up to 3 similar proposals before posting", "optional", None, "ProposalList", q=["text:str:The draft proposal text, 5 or more characters"], errs=[404, 422], desc="Trigram match on open proposals so the person can support one instead.")
R(G, "GET /questions/{questionId}/proposals", "listProposals", "Proposals, newest or most supported", "optional", None, "ProposalPage", q=PAGE_Q + ["sort:str:SUPPORT or NEW", "groupId:uuid:"], errs=[404])
R(G, "POST /questions/{questionId}/proposals", "createProposal", "Propose a next step", "user", "CreateProposalRequest", "ProposalReceipt", idem=True, status=201, errs=[403, 404, 409, 422], rl="post",
  desc="Free at launch (V-15): cost.proposal_milli is 0 and it uses no free post, but it is rate limited. The reply carries similar proposals so the person can support one instead.")
R(G, "PUT /proposals/{proposalId}/stance", "setProposalStance", "Support or challenge a proposal", "user", "StanceRequest", "Proposal", errs=[404, 422], desc="One stance per person per proposal, changeable. Free.")
R(G, "DELETE /proposals/{proposalId}/stance", "removeProposalStance", "Remove my stance", "user", None, "Proposal")
R(G, "DELETE /proposals/{proposalId}", "deleteProposal", "Delete my proposal", "user", None, None, status=204, errs=[403, 404])

# ---------------- results (V-7, V-8)
G = "result-posts"
R(G, "GET /result-threads", "listResultThreads", "Live results threads", "optional", None, "ResultThreadPage", q=PAGE_Q + ["status:str:OPEN or CLOSED"])
R(G, "GET /result-threads/{threadId}", "getResultThread", "One thread", "optional", None, "ResultThread", errs=[404])
R(G, "GET /result-threads/{threadId}/posts", "listResultPosts", "Posted numbers with their Verified or Not verified label", "optional", None, "ResultPostPage", q=PAGE_Q + ["status:str:VERIFIED or NOT_VERIFIED", "state:str:", "lga:str:", "after:str:Cursor of the newest result already seen; the page then reports newCount"], errs=[404],
  desc="WAWU adds nothing up and publishes no count of its own. The sheet photo is never returned.")
R(G, "POST /result-threads/{threadId}/posts", "createResultPost", "Post the numbers I see", "user", "CreateResultPostRequest", "ResultPost", idem=True, status=201, errs=[403, 404, 409, 422], rl="result-post",
  desc="Free: it does not use a free post or units. Totals only (accredited, votes cast, rejected). Starts as Not verified. The photo is optional and only the team sees it.")
R(G, "DELETE /result-posts/{postId}", "deleteResultPost", "Delete my result post", "user", None, None, status=204, errs=[403, 404])

# ---------------- news
G = "news"
R(G, "GET /news", "listNews", "The Newsroom: news posts by tag", "optional", None, "NewsPostPage", q=PAGE_Q + ["tag:str:VERIFIED_NEWS, UNVERIFIED_NEWS or GOSSIP", "categoryId:uuid:"])
R(G, "GET /news/tags", "listNewsTags", "The three tags, what they mean, and which I follow", "optional", None, "TagInfoList",
  desc="The plain-language disclaimer text for each tag. Counsel reviews this wording.")
R(G, "GET /news/{answerId}", "getNewsPost", "A news post with its tag, who chose it and when", "optional", None, "Answer", errs=[404])

# ---------------- weekly
G = "weekly-report"
R(G, "GET /weekly-reports", "listWeeklyReports", "The archive of published reports", "optional", None, "WeeklyArchive", q=PAGE_Q,
  desc="One report a week, AI-assisted and checked by a WAWU editor. Only approved and published reports appear. The PDF is after launch (V-10).")
R(G, "GET /weekly-reports/latest", "getLatestWeeklyReport", "The latest published report", "optional", None, "WeeklyReport", desc="200 with a null body when none is published yet (lead ruling WF, 6 Nov, A-L1).")
R(G, "GET /weekly-reports/{reportId}", "getWeeklyReport", "One published report", "optional", None, "WeeklyReport", errs=[404])

# ---------------- search
G = "search"
R(G, "GET /search", "search", "Search questions, answers (text and transcripts) and handles", "optional", None, "SearchResults", q=["q:str:2 or more characters", "type:str:questions, answers, people or topics (default all)", "tag:str:NewsTag"] + PAGE_Q, errs=[422], rl="search")

# ---------------- notifications
G = "notifications"
R(G, "GET /notifications", "listNotifications", "My in-app notifications", "user", None, "NotificationPage", q=PAGE_Q + ["unreadOnly:bool:", "type:str:replies, reactions, polls or all (default all)"],
  desc="Alerts are in-app at launch (V-10). Reactions on one answer fold into one row. Nothing sensitive in the text.")
R(G, "POST /notifications/read", "markNotificationsRead", "Mark some or all as read", "user", "MarkReadRequest", "UnreadCount", desc="Empty ids marks all.")
R(G, "GET /notifications/unread-count", "getUnreadCount", "Unread count for the bell", "user", None, "UnreadCount")

# ---------------- share
G = "share"
R(G, "POST /share/links", "createShareLink", "Make a short link and share card for a question, answer, poll result or weekly report", "optional", "CreateShareLinkRequest", "ShareLink", status=201, errs=[404, 422], rl="share",
  desc="The link carries the sharer's referral code. Card generation is queued; cardStatus tells when the images are ready (target under 5 seconds). Flagged posts fall back to the topic and the call to action.")
R(G, "GET /share/{code}", "getSharePage", "Public share page data", "none", None, "SharePage", errs=[404], rl="read",
  desc="Everything the no-account page and the card need: topic line, 2 or 3 arguments with voice counts, the poll so far, the tag, the transcript, the featured voice and the one call to action.")
R(G, "GET /share/{code}/card", "getShareCardImage", "The card image", "none", None, None, q=["size:str:ignored: this route always returns the 1200x630 card"], errs=[404, 202], ctype="image/png",
  desc="Text and brand only. 202 while it is being made.")
R(G, "GET /share/{code}/story", "getShareStoryImage", "The Instagram Stories card image", "none", None, None, errs=[404], ctype="image/png",
  desc="The 1080x1920 Stories card: same words and colours as the card, stacked for a tall frame. Text and brand only. Drawn on request, never stored. 404 for an unknown link, a deleted person's card or a failed card.")
R(G, "GET /share/{code}/square", "getShareSquareImage", "The square card image (mood card)", "none", None, None, errs=[404], ctype="image/png",
  desc="LCH-03: the 1080x1080 mood card for WhatsApp and feeds. Drawn on request and cached. Only a mood answer's link has one, any other link is a 404, and so is a deleted, removed or leaving person's card.")
R(G, "POST /share/{code}/events", "recordShareEvent", "Record a share intent, link open or Add your voice tap", "optional", "ShareEventRequest", None, status=204, errs=[404], rl="read")

# ---------------- units
G = "voice-units"
R(G, "GET /units/tiers", "listTiers", "Unit packs, costs and extra voice tokens", "optional", None, "TiersResponse", desc="Everything priced comes from config. The price is shown before any payment.")
R(G, "GET /subscription-plans", "listSubscriptionPlans", "The subscription plans and what each gives", "optional", None, "SubscriptionPlans", desc="V-45. Prices come from config. Auth: guest or signed in.")
R(G, "GET /subscriptions/me", "getMySubscriptions", "My plan, the one waiting to start and my finished plans", "user", None, "MySubscriptions")
R(G, "GET /wallet", "getWallet", "Balance, free posts, costs and my extra voice tokens", "user", None, "Wallet")
R(G, "GET /wallet/history/export", "exportLedger", "Download my tokens statement (CSV)", "user", None, None, ctype="text/csv", desc="Not a PDF (V-10).")
R(G, "GET /wallet/history", "listLedger", "My tokens history", "user", None, "LedgerPage", q=PAGE_Q)
R(G, "POST /payments", "initPayment", "Start a payment for a token pack or a subscription plan", "user", "InitPaymentRequest", "PaymentInit", idem=True, status=201, errs=[404, 409, 422], rl="payment",
  desc="The server fixes the amount from config and returns the Flutterwave checkout link. Nothing is credited until verification.")
R(G, "GET /payments/{paymentId}", "getPayment", "A payment and, once paid, what it gave", "user", None, "Payment", errs=[404])
R(G, "POST /payments/{paymentId}/verify", "verifyPayment", "Confirm a payment on return from checkout", "user", "VerifyPaymentRequest", "Payment", idem=True, errs=[404, 409, 422], rl="payment",
  desc="Calls Flutterwave's verify itself and checks reference, amount, currency and status, then credits exactly once. Safe to call twice; a replay returns the same result. A forged reference or amount mismatch credits nothing.")
R(G, "GET /payments/{paymentId}/receipt", "getReceipt", "A receipt for a succeeded payment", "user", None, "Receipt", errs=[404, 409])
R(G, "GET /extra-voice-tokens", "listExtraVoiceTokens", "My unused extra voice tokens", "user", None, "ExtraVoiceTokenList")
R(G, "POST /webhooks/flutterwave", "flutterwaveWebhook", "Flutterwave payment webhook", "webhook", "FlutterwaveWebhook", None, status=200, errs=[401],
  desc="Signature checked from the verif-hash header; the event only triggers the same verify call. Unsigned or wrong-signature calls get 401 and change nothing.")

# ---------------- ads
G = "ads"
R(G, "GET /ads/placement", "getAdPlacement", "The approved ad for a slot, labelled", "optional", None, "AdPlacementResponse", q=["kind:str:AdKind", "questionId:uuid:", "categoryId:uuid:"], rl="read",
  desc="Returns null where an ad must not show: first 3 items, sensitive topics, frequency cap reached. Organic ranking never reads this.")
R(G, "POST /ads/{adId}/events", "recordAdEvent", "Record a view, tap or listen", "optional", "AdEventRequest", None, status=204, errs=[404], rl="read")

# ---------------- system
R("system", "GET /health", "getHealth", "Health check", "none", None, "Health", errs=[503], desc="Served at /api/health, outside /api/v1. 503 with the one error shape when the database is down.")

# ---------------- analytics
G = "analytics"
R(G, "POST /events", "postEvents", "Send analytics events", "optional", "AnalyticsBatch", None, status=204, errs=[422], rl="read",
  desc="Names from section 12 of the v4.0 brief plus the share measures. No third-party trackers.")

# ---------------- admin
G = "admin"
R(G, "GET /admin/roles", "listRoles", "People with a role", ADM, None, "AdminRoleGrantPage", q=PAGE_Q + ["role:str:"])
R(G, "PUT /admin/users/{userId}/roles", "setRoles", "Set a person's roles", ADM, "SetRolesRequest", "AdminRoleGrant", errs=[404, 422], desc="Logged with who and why.")
R(G, "GET /admin/users", "adminListUsers", "Find people", ADM, None, "AdminUserPage", q=PAGE_Q + ["q:str:Optional. A part of a handle or display name, a phone number or phone hash, or one whole mail address. Leave it out to list everyone, newest first", "status:str:"],
  desc="Everyone who has registered, newest first, or the ones a search finds. Also returns total and counts.")
R(G, "POST /admin/users/{userId}/suspend", "suspendUser", "Suspend or ban", "role:MODERATOR,ADMIN", "SuspendRequest", "AdminUser", errs=[404, 422])
R(G, "POST /admin/users/{userId}/restore", "restoreUser", "Lift a suspension", "role:MODERATOR,ADMIN", "CancelRequest", "AdminUser", errs=[404])
R(G, "GET /admin/today", "adminToday", "Today dashboard", "role:EDITOR,MODERATOR,AD_MANAGER,ADMIN", None, "AdminToday")
R(G, "GET /admin/topics", "adminListTopics", "Topic calendar with status chip counts", EDI, None, "AdminTopicList", q=PAGE_Q + ["status:str:", "sensitive:bool:Only sensitive weeks", "q:str:Week number, topic title or question text"], desc="counts holds one number per chip (live, scheduled, inReview, draft, sensitive); totals holds weeks and questions.")
R(G, "POST /admin/topics", "adminCreateTopic", "Add a week", EDI, "UpsertTopicRequest", "AdminTopic", status=201, errs=[409, 422])
R(G, "GET /admin/topics/{topicId}", "adminGetTopic", "A week with its 7 questions, spare questions and poll", EDI, None, "AdminTopic", errs=[404])
R(G, "PATCH /admin/topics/{topicId}", "adminUpdateTopic", "Edit a week", EDI, "UpsertTopicRequest", "AdminTopic", errs=[404, 422])
R(G, "GET /admin/questions", "adminListQuestionPool", "The question pool (V-42): daily and flash questions with no week and no day", EDI, None, "AdminQuestionPool", q=["pool:str:Must be 1; only the pool is listed here"] + PAGE_Q, errs=[400, 422],
  desc="Newest first, cursor pages. A question is in the pool while it has no week, no day, is not closed and (for a flash question) has not been started as a flash poll. total is the whole pool, not the page.")
R(G, "POST /admin/questions/bulk", "adminBulkQuestions", "Add many pool questions at once (up to 50 lines)", EDI, "BulkQuestionsRequest", "BulkQuestionsResult", errs=[422],
  desc="V-42 (K2). Every line is made under the same rules as POST /admin/questions (3 to 400 characters, no control characters) with no week and no day. A refused line is named by its line number and the others are kept, so the answer is 200 with created and refused counts. Blank lines are skipped but still numbered.")
R(G, "POST /admin/questions", "adminCreateQuestion", "Create a question (daily, flash, follow-up)", EDI, "CreateQuestionRequest", "AdminQuestion", status=201, errs=[422], desc="kind is required here.")
R(G, "POST /admin/questions/{questionId}/move", "adminMoveQuestion", "Move a scheduled question to another day of its week; a taken day swaps the two", EDI, "MoveQuestionRequest", "MoveQuestionResult", errs=[404, 409, 422],
  desc="Lead ruling WF, 6 Nov (RW6). Outside the week is 422 'That day is outside the week.'; a question that has started cannot move (409). Held FLASH questions are opened as flash polls with POST /admin/polls (kind FLASH, questionId).")
R(G, "POST /admin/questions/{questionId}/schedule", "adminScheduleQuestion", "Put a pool question on a day; a taken day swaps and the old question goes to the pool", EDI, "ScheduleQuestionRequest", "MoveQuestionResult", errs=[404, 409, 422],
  desc="V-42 (K3). The question joins the week whose dates hold the day; no week there is 422 'There is no week on that day. Add the week in the calendar first.'. A free day takes it at once. A taken day is 409 with code DAY_TAKEN and the question there in details.question, until the request sends replace true; then the two swap and swappedWith is the question that went back to the pool. A day or question that has started is 409. Only a daily question can be put on a day.")
R(G, "PATCH /admin/questions/{questionId}", "adminUpdateQuestion", "Edit, schedule, feature, close a question", EDI, "UpsertQuestionRequest", "AdminQuestion", errs=[404, 422], desc="Leave kind out to keep the question's own kind.")
R(G, "POST /admin/polls", "adminCreatePoll", "Create a poll and link it to a topic or question", EDI, "UpsertPollRequest", "Poll", status=201, errs=[409, 422], desc="Only one flash poll may be open at a time: a second is 409 'A flash poll is already open.'. Opening a flash poll sends one FLASH_POLL notification to each active person who allows flash alerts (chunked, after the response, one per person per poll).")
R(G, "PATCH /admin/polls/{pollId}", "adminUpdatePoll", "Edit a poll before it opens", EDI, "UpsertPollRequest", "Poll", errs=[404, 409, 422])
R(G, "PUT /admin/topics/{topicId}/summary", "adminSaveSummary", "Edit and approve the What Next? editorial summary", EDI, "SummaryEditRequest", "EditorialSummary", errs=[404, 422])
R(G, "POST /admin/proposal-groups", "adminConfirmGroup", "Confirm a group of similar proposals", MOD, "ConfirmGroupRequest", "ProposalGroup", status=201, errs=[404, 422])
R(G, "GET /admin/overrides", "adminListOverrides", "Override log", EDI, None, "AdminOverridePage", q=PAGE_Q)
R(G, "POST /admin/overrides/preview", "adminPreviewOverride", "Preview what the week looks like after an override", EDI, "CreateOverrideRequest", "OverridePreview", errs=[422])
R(G, "POST /admin/overrides", "adminCreateOverride", "Override the day (now or scheduled)", EDI, "CreateOverrideRequest", "AdminOverride", status=201, errs=[409, 422],
  desc="Runs 24 hours (start and end editable). The replaced question moves to the next free slot and the week shifts a day, or is dropped. Weekly theme and poll are kept unless the request says otherwise. Emergency applies at once; notifyAlert sends an in-app alert. Logged with who, what, when and what it replaced.")
R(G, "POST /admin/overrides/{overrideId}/cancel", "adminCancelOverride", "Cancel an override early; the schedule returns to normal", EDI, "CancelRequest", "AdminOverride", errs=[404, 409])
R(G, "GET /admin/moderation/items", "adminListModeration", "Moderation queues", MOD, None, "ModerationPage", q=PAGE_Q + ["queue:str:ModerationQueue", "status:str:OPEN or RESOLVED"])
R(G, "GET /admin/moderation/items/{itemId}", "adminGetModerationItem", "One item with transcript, screening and audit trail", MOD, None, "ModerationItemDetail", errs=[404])
R(G, "POST /admin/moderation/items/{itemId}/action", "adminModerationAction", "Keep, remove, warn, suspend (a reason is required)", MOD, "ModerationDecision", "ModerationItemDetail", errs=[404, 409, 422])
R(G, "GET /admin/news/items", "adminListNews", "News tag review queue", EDI, None, "AdminNewsPage", q=PAGE_Q + ["tab:str:flagged, asking-verified or all-changes (default flagged)"], desc="counts holds the number in each tab.")
R(G, "POST /admin/news/{answerId}/decision", "adminNewsDecision", "Keep, change the tag, send to moderation, or approve Verified News", EDI, "NewsDecision", "AdminNewsItem", errs=[404, 422],
  desc="Verified News needs an editor or admin and a named source. Every change is logged (who, when, why) and the poster is notified.")
R(G, "GET /admin/results/threads", "adminListResultThreads", "Result threads", EDI, None, "ResultThreadPage", q=PAGE_Q)
R(G, "POST /admin/results/threads", "adminCreateResultThread", "Open a live results thread", EDI, "CreateResultThreadRequest", "ResultThread", status=201, errs=[422])
R(G, "GET /admin/results/posts", "adminListResultPosts", "Posted results waiting to be checked", EDI, None, "AdminResultPage", q=PAGE_Q + ["threadId:uuid:", "status:str:NOT_VERIFIED or VERIFIED"])
R(G, "POST /admin/results/posts/{postId}/decision", "adminResultDecision", "Mark a result Verified or Not verified", EDI, "ResultDecision", "AdminResultPost", errs=[404, 422])
R(G, "GET /admin/weekly-reports", "adminListWeekly", "Weekly report drafts and approvals", EDI, None, "AdminWeeklyReportPage", q=PAGE_Q + ["status:str:WeeklyReportStatus"])
R(G, "GET /admin/weekly-reports/{reportId}", "adminGetWeekly", "One draft with its checks", EDI, None, "AdminWeeklyReport", errs=[404])
R(G, "PATCH /admin/weekly-reports/{reportId}", "adminEditWeekly", "Edit the draft", EDI, "EditWeeklyReportRequest", "AdminWeeklyReport", errs=[404, 409, 422])
R(G, "POST /admin/weekly-reports/{reportId}/approve", "adminApproveWeekly", "Approve and set the publish time", EDI, "ApproveWeeklyRequest", "AdminWeeklyReport", errs=[404, 409, 422], desc="Nothing is published unreviewed. A quote without the speaker's consent blocks approval.")
R(G, "GET /admin/weekly-reports/{reportId}/instagram", "adminWeeklyInstagramZip", "Instagram pictures of a published report, as a zip", EDI, None, None, errs=[404, 409], ctype="application/zip",
  desc="LCH-13: the carousel (1080x1350) and the Story (1080x1920) drawn from the approved text of a PUBLISHED report. Nothing is posted anywhere; a draft, held or approved report is a 409.")
R(G, "GET /admin/weekly-reports/{reportId}/instagram/{file}", "adminWeeklyInstagramPicture", "One Instagram picture", EDI, None, None, errs=[404, 409], ctype="image/png",
  desc="LCH-13: one picture of the set, a PNG: carousel-1.png and so on, or story.png.")
R(G, "POST /admin/weekly-reports/{reportId}/hold", "adminHoldWeekly", "Hold a draft", EDI, "HoldRequest", "AdminWeeklyReport", errs=[404, 409])
R(G, "GET /admin/ads", "adminListAds", "Adverts and the approval queue", ADS, None, "AdminAdPage", q=PAGE_Q + ["status:str:AdStatus"])
R(G, "POST /admin/ads", "adminCreateAd", "Create an advert", ADS, "UpsertAdRequest", "AdminAd", status=201, errs=[422])
R(G, "PATCH /admin/ads/{adId}", "adminUpdateAd", "Edit an advert", ADS, "UpsertAdRequest", "AdminAd", errs=[404, 409, 422])
R(G, "POST /admin/ads/{adId}/decision", "adminAdDecision", "Approve, reject, ask for changes, pause, resume", ADS, "AdDecision", "AdminAd", errs=[404, 409, 422],
  desc="APPROVE is 422 while any of the advert's checks fails; the message names the failing check (lead ruling WF, 6 Nov, C-M8).")
R(G, "GET /admin/surveys", "adminListSurveys", "Sponsored surveys and the approval queue", ADS, None, "AdminSurveyPage", q=PAGE_Q + ["status:str:AdStatus"],
  desc="V-SURVEYS: same roles as adverts (AD_MANAGER, ADMIN). A moderator is 403.")
R(G, "POST /admin/surveys", "adminCreateSurvey", "Create a sponsored survey (a draft)", ADS, "UpsertSurveyRequest", "AdminSurvey", status=201, errs=[422],
  desc="1 to 5 questions: a single-choice poll (2 to 6 different choices), a short text answer or a short voice answer. priceKobo falls back to the admin price list (surveys.price.flat_kobo), never a fixed number; it stays null when neither is set.")
R(G, "GET /admin/surveys/{surveyId}", "adminGetSurvey", "One sponsored survey", ADS, None, "AdminSurvey", errs=[404])
R(G, "PATCH /admin/surveys/{surveyId}", "adminUpdateSurvey", "Edit a sponsored survey", ADS, "UpsertSurveyRequest", "AdminSurvey", errs=[404, 409, 422],
  desc="Any subset of the fields. 409 for an approved or rejected survey, for a survey whose results are fixed, and for new questions once anyone has answered. Changing the words of a paused survey sends it back to the approval queue.")
R(G, "POST /admin/surveys/{surveyId}/submit", "adminSubmitSurvey", "Send a draft for approval (email F01 to the brand contact)", ADS, None, "AdminSurvey", errs=[404, 409, 422])
R(G, "POST /admin/surveys/{surveyId}/decision", "adminSurveyDecision", "Approve, reject, ask for changes, pause, resume", ADS, "SurveyDecision", "AdminSurvey", errs=[404, 409, 422],
  desc="APPROVE is 422 while a check fails (wording, kept-away categories, dates, price) and sends email F02. ASK_FOR_CHANGES needs a reason and sends email F03. REJECT needs a reason. Every decision writes an audit row.")
R(G, "GET /admin/surveys/{surveyId}/report", "adminSurveyReport", "The brand's results, combined and anonymous (once released)", ADS, None, "SurveyReport", errs=[404],
  desc="Nothing is worked out while the survey runs: stage RUNNING (or NOT_LIVE), ready false, only answeredSoFar. When the survey is over (end date passed or response target reached) its results are fixed once and no answer is accepted after that; until staff release them the report is stage REVIEW, ready true, released false, answeredSoFar only. After POST /admin/surveys/{surveyId}/release it is stage RELEASED, released true, and every read returns the same stored report. No name, handle, photo or id is ever returned. Free answers and transcripts are scrubbed and any staff hid are left out. State and age band appear only for people who agreed to share them. No group smaller than weekly.min_group_size is shown, and no hidden group can be worked out by subtraction: a hidden total that is under TWICE the minimum pulls the next smallest group in (repeating), and hidden groups are shown together as other only when their sum is at least the minimum. The answered of a question is null (and its options, other, texts and voices are left out) when the number of responses without an answer to it is above 0 and under the minimum, because that small difference could be worked out from it. For a written or voice question answered is the number of items in the list the brand gets (hidden, empty and scrubbed-to-nothing answers are in neither), and the list is left out when it is under the minimum or that difference is small. A breakdown (byState, byAgeBand) is shown only when its shared total equals, or differs by at least the minimum from, the total and every other shown breakdown; otherwise it is left out whole. Every read writes an audit row (who, when, which survey). The web builds the CSV from a released body only.")
R(G, "GET /admin/surveys/{surveyId}/free-answers", "adminSurveyFreeAnswers", "Every free answer and transcript, for staff to read before release, a page at a time", ADS, None, "SurveyFreeAnswers", q=["cursor:str:Opaque, signed page link from nextCursor. Pages can only be walked in order; a link that is not valid is 422", "limit:int:1 to 50, default 50"], errs=[404, 409, 422],
  desc="409 while the survey is still running. Scrubbed (NFKC first; emails also spelt chidi(at)gmail(dot)com, 'chidi @ gmail . com', 'chidi at gmail.com'; links with any scheme, www, label.label/path, a list of endings, 'word dot ending', IPv4; phone numbers of 10 or more digits with any non-letter separators, mixed with number words, O and I between digits; @handles and handles after a platform word with ':' or '@' or a token holding a digit, '_' or '.'). A name or address typed in plain words is not found by pattern: read each one. Listed alphabetically inside a question, never in the order people answered. Each item's id is a review handle (an HMAC of the answer id), never the answer's own id and not ordered by time. When the LAST page is served (nextCursor null) reviewedAt and reviewedById are stored; POST release needs them when the survey has any written or voice answer. Audited.")
R(G, "PATCH /admin/surveys/{surveyId}/free-answers/{handle}", "adminHideSurveyFreeAnswer", "Hide one free answer from the brand (or show it again)", ADS, "HideFreeAnswerRequest", "HideFreeAnswerResult", errs=[404, 409, 422],
  desc="One call per answer. {handle} is the item's id from the review list (32 hex characters), not an answer id: anything else is 404. 409 before the survey is over and after release. Hiding or showing clears nothing, including the read that release needs. Audited (the handle, never its words).")
R(G, "POST /admin/surveys/{surveyId}/release", "adminReleaseSurvey", "Staff have read the free answers: release the results to the brand", ADS, None, "SurveyReleaseResult", errs=[404, 409],
  desc="409 'Read the written answers before releasing the results.' while the survey has written or voice answers and the whole review list (every page of GET free-answers) has not been served since the results were fixed; a survey with none releases as before. Once only (409 after). Builds and stores the brand's report from the fixed results and the free answers left in, writes an audit row (who, when, how many hidden), then sends email F04 to the brand contact. mailed is false when the mail could not go yet: it is tried again every ten minutes and never sent twice. F04 is never sent before release.")
R(G, "GET /admin/brands", "adminListBrands", "Brands", ADS, None, "AdminBrandList")
R(G, "POST /admin/brands", "adminCreateBrand", "Set up a brand page", ADS, "BrandInput", "AdminBrand", status=201, errs=[409, 422],
  desc="409 when another brand has the same name ignoring case and spaces.")
R(G, "PATCH /admin/brands/{brandId}", "adminUpdateBrand", "Edit a brand", ADS, "BrandInput", "AdminBrand", errs=[404, 409, 422],
  desc="409 when the new name matches another brand ignoring case and spaces.")
R(G, "GET /surveys/placement", "getSurveyPlacement", "The sponsored survey for the feed slot, labelled", "optional", None, "SurveyPlacementResponse", q=["questionId:uuid:", "categoryId:uuid:"], rl="read",
  desc="V-SURVEYS: the slot where adverts go. { survey: null } for a guest and wherever a survey must not show: a sensitive question, topic or category, outside the survey's targeting or dates, past its frequency cap or response target, already answered, or skipped twice.")
R(G, "GET /surveys/{surveyId}", "getSurvey", "A sponsored survey to answer", "user", None, "Survey", errs=[404],
  desc="404 unless the survey is live, not skipped twice, and, when it is aimed at states, the person turned on useMyStateForSurveys (PATCH /me/settings) and their state is one of them. myStatus ANSWERED returns no questions.")
R(G, "POST /surveys/{surveyId}/events", "recordSurveyEvent", "A survey card was seen, started or skipped", "user", "SurveyEventRequest", None, status=204, errs=[404, 422],
  desc="Counts toward the frequency cap (VIEW). A SKIP is stored once per person per survey per Lagos day however often it is sent, and never closes the survey to the person. Ignored once the person has answered.")
R(G, "POST /surveys/{surveyId}/responses", "answerSurvey", "Answer a sponsored survey", "user", "SurveyResponseRequest", "SurveyResponseResult", status=201, errs=[404, 409, 422],
  desc="One answer per person per survey (409 after). Free: it never touches tokens, free posts or the daily posting limit, and is never a public post. A voice answer uses a clip made with POST /voice-clips purpose SURVEY_ANSWER and is at most surveys.voice_max_seconds. anonymous: true keeps nothing about the person; state and age band are kept only with shareState and ageBand. 409 'This survey has closed.' when the survey ended or reached its target (404 when it is not live for this person). One recording answers one question: using it twice in one request is 422. A control character (NUL and the like) in a written answer is 422.")
R(G, "GET /brands/{slug}", "getBrandPage", "A brand's public page", "none", None, "BrandPage", errs=[404],
  desc="V-SURVEYS: name, logo, one line, its live Sponsored Surveys and the live adverts the ad manager tied to this brand (Ad.brandId; a matching name alone adds nothing), labelled as a brand. Never a contact address. A slug that is not 1 to 60 of a-z, 0-9 and - answers 404.")
R(G, "GET /admin/config", "adminListConfig", "Prices, costs, allowances and limits", ADM, None, "ConfigList")
R(G, "PUT /admin/config/{key}", "adminUpdateConfig", "Change a config value (effective at once, logged)", ADM, "UpdateConfigRequest", "ConfigEntry", errs=[404, 422])
R(G, "GET /admin/config/changes", "adminConfigChanges", "Config change log", ADM, None, "ConfigChangePage", q=PAGE_Q + ["key:str:"])
R(G, "POST /admin/config/changes/{changeId}/rollback", "adminRollbackConfig", "Roll a change back", ADM, "CancelRequest", "ConfigEntry", errs=[404, 409])
R(G, "GET /admin/wallets/{userId}", "adminGetWallet", "A person's wallet, ledger and payments", ADM, None, "AdminWallet", q=PAGE_Q, errs=[404])
R(G, "POST /admin/wallets/{userId}/adjust", "adminAdjustWallet", "Adjust a wallet (a reason is required)", ADM, "AdjustWalletRequest", "AdminWallet", idem=True, status=201, errs=[404, 409, 422],
  desc="Writes an ADJUSTMENT ledger transaction and an audit entry. Cannot take a balance below zero. The answer carries `adjustment` with the audit id and the ledger transaction id.")
R(G, "GET /admin/payments", "adminListPayments", "Payments and their reconcile state", ADM, None, "AdminPaymentPage", q=PAGE_Q + ["status:str:PaymentStatus", "kind:str:PaymentKind"],
  desc="V-ADMIN-MONEY: newest first, each with the person and the payment's own price, VAT, charge and total.")
R(G, "POST /admin/payments/{paymentId}/reverify", "adminReverifyPayment", "Re-run the provider verify for a stuck payment", ADM, None, "AdminPayment", idem=True, errs=[404, 409])
R(G, "GET /admin/money/overview", "adminMoneyOverview", "Money received, payments and tokens for today, 7 and 30 days", ADM, None, "MoneyOverview",
  desc="V-ADMIN-MONEY: received money split into token packs and subscriptions, with VAT and the payment charge apart from WAWU's own revenue (price), payment counts, new paying people, and tokens sold against spent. Days are Lagos days; the last 7 and 30 days include today.")
R(G, "GET /admin/subscriptions", "adminListSubscriptions", "Current and ended subscription plans", ADM, None, "AdminSubscriptionPage", q=PAGE_Q + ["status:str:SubscriptionStatus"],
  desc="V-ADMIN-MONEY: read only. Newest first, with the next credit day of a plan still running.")
R(G, "GET /admin/audit", "adminAudit", "Audit log", ADM, None, "AuditPage", q=PAGE_Q + ["action:str:", "targetType:str:", "targetId:str:"])

# ---------------- text fix (LCH-12, V-37)
G = "text-fix"
R(G, "POST /text/fix", "fixText", "Fix the spelling, typos and grammar of my text (5 tokens)", "user", "TextFixRequest", "TextFixResult", idem=True, rl="text-fix", errs=[402, 422, 429, 502, 503],
  desc="Only spelling, typos and grammar are corrected, never what the text means: the server checks every change and refuses a fix that changes more. Costs 5 tokens (config textfix.cost_milli), charged once per Idempotency-Key and only when a fix comes back: an AI failure (502 TEXT_FIX_FAILED), a refused fix and a text with nothing to fix cost nothing. The text is sent to the AI provider to be corrected and used for nothing else. The person sees the changes and chooses to use the fix or keep their own text.")

# ---------------- V-DM: direct messages
G = "direct-messages"
R(G, "POST /dm/messages", "sendDm", "Send a direct message (text or voice) to one member", "user", "SendDmRequest", "DmSendReceipt", idem=True, status=201, errs=[402, 403, 404, 409, 422], rl="dm",
  desc="V-DM. Only a verified sender (for now: a member with a running subscription), else 403 verification_required. A person who blocked you (or whom you blocked), who turned messages off, or who is suspended, banned or leaving is one and the same 403 `dm_unavailable` (\"This person is not taking messages.\"), so nobody can tell which; an unknown or deleted person is 404. The price comes from config (dm.text_price_milli per 150 characters in proportion, dm.voice_price_milli per voice message; both 0 by default, so messages are free); text is at most 5,000 characters and voice at most dm.voice_max_seconds (60). Free posts do not apply. A direct message has its own cap, dm.messages_per_day (100 by default, 429 DAILY_LIMIT_REACHED), and does not count toward the 20 posts a day. Charged only when the message is stored: a refused or failed send costs nothing, and a repeat with the same Idempotency-Key returns the first result and charges once.")
R(G, "GET /dm/limits", "getDmLimits", "What a direct message costs and how many I have left today", "user", None, "DmLimits")
R(G, "PUT /dm/conversations/{conversationId}/mute", "muteDm", "Mute a chat", "user", None, None, status=204, errs=[404],
  desc="A muted chat does not raise the unread number or dot. The other person is not told. Idempotent.")
R(G, "DELETE /dm/conversations/{conversationId}/mute", "unmuteDm", "Unmute a chat", "user", None, None, status=204, errs=[404])
R(G, "GET /dm/conversations", "listDmConversations", "My conversations, latest first", "user", None, "DmConversationPage", q=PAGE_Q,
  desc="Newest message first. Each has the last message preview and my unread count. People who blocked me, or whom I blocked, are left out.")
R(G, "GET /dm/conversations/{conversationId}/messages", "listDmMessages", "The messages of one conversation, newest first", "user", None, "DmMessagePage", q=PAGE_Q, errs=[404],
  desc="404 for a conversation I am not in, and for one with a person who blocked me or whom I blocked.")
R(G, "POST /dm/conversations/{conversationId}/read", "markDmRead", "Mark everything sent to me in a conversation as read", "user", None, None, status=204, errs=[404])
R(G, "GET /dm/unread", "getDmUnread", "How many direct messages I have not read", "user", None, "UnreadCount",
  desc="The number on the messages icon. The web polls it every 30 seconds while the page is open.")
R(G, "GET /dm/with/{userId}", "getDmWith", "The person, my conversation with them and whether they take messages", "user", None, "DmWith", errs=[404],
  desc="For the Message button on a profile and the new-message screen. 404 for myself, a banned or a deleted account.")
