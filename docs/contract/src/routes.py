ROUTES = []
def R(group, line, op, summary, auth="user", req=None, res=None, q=None, errs=None, idem=False, status=200, desc=None, rl=None, ctype=None):
    m, p = line.split(" ", 1)
    ROUTES.append(dict(group=group, method=m.lower(), path=p, op=op, summary=summary, auth=auth, req=req, res=res, q=q or [], errs=errs or [], idem=idem, status=status, desc=desc, rl=rl, ctype=ctype))

PAGE_Q = ["cursor:str:Opaque cursor from nextCursor", "limit:int:1 to 50, default 20"]
ADM = "role:ADMIN"
EDI = "role:EDITOR,ADMIN"
MOD = "role:MODERATOR,ADMIN"
ADS = "role:AD_MANAGER,ADMIN"

# ---------------- me / profile
G = "me-profile"
R(G, "POST /me", "createMe", "Create my VOICES profile after WAWU ID sign-in", "token", "CreateMeRequest", "Me", errs=[409, 422], status=201,
  desc="Idempotent. The bearer token is a WAWU ID RS256 token. Needs 18+ confirmation, terms and rules acceptance, a free handle and 3 or more categories. Creates the Voice Units balance, free allowance (10 posts) and settings. Records the referral if a code is sent.")
R(G, "GET /me", "getMe", "My account, roles, allowances and unread count", "token", None, "Me", desc="Before profile creation returns profileComplete false with handle null.")
R(G, "PATCH /me/profile", "updateProfile", "Edit my profile", "user", "UpdateProfileRequest", "Profile", errs=[409, 422])
R(G, "GET /me/handle-check", "checkHandle", "Is a handle free?", "token", None, "HandleCheck", q=["handle:str:3 to 20 of a-z 0-9 . _"])
R(G, "GET /me/allowance", "getAllowance", "What I can do now and what each action costs", "user", None, "Allowances", q=["action:str:Optional POST_TEXT, POST_VOICE, REACTION or VOTE, to get one quote"],
  desc="The recorder, composer and vote screens read this before any tap so there are no surprise charges.")
R(G, "GET /me/settings", "getSettings", "My settings", "user", None, "Settings")
R(G, "PATCH /me/settings", "updateSettings", "Change my settings", "user", "UpdateSettingsRequest", "Settings", errs=[422])
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
R(G, "POST /me/export", "requestExport", "Ask for an export of my data", "user", None, "DataExport", status=202, errs=[429], desc="Posts, transcripts and Voice Units history. Built in the background; poll GET /me/export.")
R(G, "GET /me/export", "getExport", "My latest data export", "user", None, "DataExport", errs=[404])
R(G, "DELETE /me", "deleteAccount", "Delete my account", "user", "DeleteAccountRequest", None, status=202, errs=[422],
  desc="Starts a 14 day grace period (cancel by signing in again), then removes the profile, posts, clips and Voice Units balance. Unspent Voice Units are lost (they are never cashed out, V-9) and the delete screen says so plainly.")

# ---------------- topics and calendar
G = "topics-calendar"
R(G, "GET /topics/current", "getCurrentTopic", "Topic of the week", "optional", None, "Topic")
R(G, "GET /topics/{topicId}", "getTopic", "One topic", "optional", None, "Topic", errs=[404])
R(G, "GET /calendar", "listCalendar", "The public topic calendar", "optional", None, "CalendarPage", q=PAGE_Q + ["status:str:Filter by TopicStatus"])
R(G, "GET /config/public", "getPublicConfig", "Prices, costs and free posts for guests", "none", None, "PublicConfig", rl="read", desc="Landing, Onboarding and the Voice Units screens read this. Nothing is typed into a client.")
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
R(G, "GET /questions/{questionId}/answers", "listAnswers", "Answers under a question", "optional", None, "AnswerPage", q=PAGE_Q + ["sort:str:TOP, NEW or DEBATED (default TOP)", "tag:str:Filter by NewsTag"], errs=[404],
  desc="Sponsored cards are inserted after every 8 to 10 organic items, never in the first 3, never on sensitive topics.")
R(G, "GET /questions/{questionId}/polls", "listQuestionPolls", "Polls that belong to this conversation", "optional", None, "PollList", errs=[404])

# ---------------- answers
G = "answers"
R(G, "POST /voice-clips", "createVoiceClip", "Start a voice upload: get a presigned PUT to Spaces", "user", "CreateVoiceClipRequest", "VoiceUpload", status=201, errs=[402, 413, 415, 422],
  desc="Checks the length against the person's limit (10 s, or 30 or 60 s with an extra voice token). Guests record and preview in the browser only; the upload starts after sign-in.", rl="voice-upload")
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
R(G, "GET /answers/{answerId}", "getAnswer", "One answer", "optional", None, "Answer", errs=[404])
R(G, "PATCH /answers/{answerId}", "editAnswer", "Edit my text answer (5 minutes)", "user", "EditAnswerRequest", "Answer", errs=[403, 404, 409, 422])
R(G, "DELETE /answers/{answerId}", "deleteAnswer", "Delete my answer (never returns the free post)", "user", None, None, status=204, errs=[403, 404])
R(G, "POST /answers/{answerId}/listen", "recordListen", "Count a listen or a listen-through", "optional", "ListenRequest", None, status=204, rl="read")
R(G, "PUT /answers/{answerId}/helpful", "markHelpful", "Mark an answer helpful", "user", None, None, status=204, errs=[404])
R(G, "DELETE /answers/{answerId}/helpful", "unmarkHelpful", "Remove my helpful mark", "user", None, None, status=204)
R(G, "PUT /questions/{questionId}/save", "saveQuestion", "Save a question (bookmark)", "user", None, None, status=204, errs=[404], desc="Idempotent.")
R(G, "DELETE /questions/{questionId}/save", "unsaveQuestion", "Remove a saved question", "user", None, None, status=204)
R(G, "PUT /answers/{answerId}/save", "saveAnswer", "Save an answer (bookmark)", "user", None, None, status=204, errs=[404], desc="Idempotent: saving twice is the same as once.")
R(G, "DELETE /answers/{answerId}/save", "unsaveAnswer", "Remove a saved answer", "user", None, None, status=204)

# ---------------- replies
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
R(G, "POST /appeals", "createAppeal", "Appeal a moderation decision", "user", "AppealRequest", "AppealReceipt", status=201, errs=[404, 409], desc="Opens an item in the APPEAL queue; a different moderator looks again.")
R(G, "POST /support/messages", "createSupportMessage", "Report a problem or contact support", "optional", "SupportMessageRequest", "SupportReceipt", status=201, errs=[422], rl="share", desc="No target needed. A payment reference may be attached.")
R(G, "POST /news/{answerId}/flag", "flagNewsTag", "Flag a news post's tag as misleading", "user", "FlagRequest", "ReportReceipt", status=201, errs=[404, 409])

# ---------------- polls and votes
G = "polls-votes"
R(G, "GET /polls/current", "getFlashPoll", "The open flash poll for Home", "optional", None, "Poll", errs=[404])
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
R(G, "GET /weekly-reports/latest", "getLatestWeeklyReport", "The latest published report", "optional", None, "WeeklyReport", errs=[404])
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
R(G, "POST /share/{code}/events", "recordShareEvent", "Record a share intent, link open or Add your voice tap", "optional", "ShareEventRequest", None, status=204, errs=[404], rl="read")

# ---------------- units
G = "voice-units"
R(G, "GET /units/tiers", "listTiers", "Unit packs, costs and extra voice tokens", "optional", None, "TiersResponse", desc="Everything priced comes from config. The price is shown before any payment.")
R(G, "GET /wallet", "getWallet", "Balance, free posts, costs and my extra voice tokens", "user", None, "Wallet")
R(G, "GET /wallet/history/export", "exportLedger", "Download my Voice Units statement (CSV)", "user", None, None, ctype="text/csv", desc="Not a PDF (V-10).")
R(G, "GET /wallet/history", "listLedger", "My Voice Units history", "user", None, "LedgerPage", q=PAGE_Q)
R(G, "POST /payments", "initPayment", "Start a payment for a unit pack or an extra voice token", "user", "InitPaymentRequest", "PaymentInit", idem=True, status=201, errs=[404, 409, 422], rl="payment",
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
R(G, "GET /admin/users", "adminListUsers", "Find people", ADM, None, "AdminUserPage", q=PAGE_Q + ["q:str:handle or phone hash", "status:str:"])
R(G, "POST /admin/users/{userId}/suspend", "suspendUser", "Suspend or ban", "role:MODERATOR,ADMIN", "SuspendRequest", "AdminUser", errs=[404, 422])
R(G, "POST /admin/users/{userId}/restore", "restoreUser", "Lift a suspension", "role:MODERATOR,ADMIN", "CancelRequest", "AdminUser", errs=[404])
R(G, "GET /admin/today", "adminToday", "Today dashboard", "role:EDITOR,MODERATOR,AD_MANAGER,ADMIN", None, "AdminToday")
R(G, "GET /admin/topics", "adminListTopics", "Topic calendar with status chip counts", EDI, None, "AdminTopicList", q=PAGE_Q + ["status:str:", "sensitive:bool:Only sensitive weeks", "q:str:Week number, topic title or question text"], desc="counts holds one number per chip (live, scheduled, inReview, draft, sensitive); totals holds weeks and questions.")
R(G, "POST /admin/topics", "adminCreateTopic", "Add a week", EDI, "UpsertTopicRequest", "AdminTopic", status=201, errs=[409, 422])
R(G, "GET /admin/topics/{topicId}", "adminGetTopic", "A week with its 7 questions, spare questions and poll", EDI, None, "AdminTopic", errs=[404])
R(G, "PATCH /admin/topics/{topicId}", "adminUpdateTopic", "Edit a week", EDI, "UpsertTopicRequest", "AdminTopic", errs=[404, 422])
R(G, "POST /admin/questions", "adminCreateQuestion", "Create a question (daily, flash, follow-up)", EDI, "CreateQuestionRequest", "AdminQuestion", status=201, errs=[422], desc="kind is required here.")
R(G, "PATCH /admin/questions/{questionId}", "adminUpdateQuestion", "Edit, schedule, feature, close a question", EDI, "UpsertQuestionRequest", "AdminQuestion", errs=[404, 422], desc="Leave kind out to keep the question's own kind.")
R(G, "POST /admin/polls", "adminCreatePoll", "Create a poll and link it to a topic or question", EDI, "UpsertPollRequest", "Poll", status=201, errs=[422])
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
R(G, "POST /admin/weekly-reports/{reportId}/hold", "adminHoldWeekly", "Hold a draft", EDI, "HoldRequest", "AdminWeeklyReport", errs=[404, 409])
R(G, "GET /admin/ads", "adminListAds", "Adverts and the approval queue", ADS, None, "AdminAdPage", q=PAGE_Q + ["status:str:AdStatus"])
R(G, "POST /admin/ads", "adminCreateAd", "Create an advert", ADS, "UpsertAdRequest", "AdminAd", status=201, errs=[422])
R(G, "PATCH /admin/ads/{adId}", "adminUpdateAd", "Edit an advert", ADS, "UpsertAdRequest", "AdminAd", errs=[404, 409, 422])
R(G, "POST /admin/ads/{adId}/decision", "adminAdDecision", "Approve, reject, ask for changes, pause, resume", ADS, "AdDecision", "AdminAd", errs=[404, 409, 422])
R(G, "GET /admin/config", "adminListConfig", "Prices, costs, allowances and limits", ADM, None, "ConfigList")
R(G, "PUT /admin/config/{key}", "adminUpdateConfig", "Change a config value (effective at once, logged)", ADM, "UpdateConfigRequest", "ConfigEntry", errs=[404, 422])
R(G, "GET /admin/config/changes", "adminConfigChanges", "Config change log", ADM, None, "ConfigChangePage", q=PAGE_Q + ["key:str:"])
R(G, "POST /admin/config/changes/{changeId}/rollback", "adminRollbackConfig", "Roll a change back", ADM, "CancelRequest", "ConfigEntry", errs=[404, 409])
R(G, "GET /admin/wallets/{userId}", "adminGetWallet", "A person's wallet, ledger and payments", ADM, None, "AdminWallet", q=PAGE_Q, errs=[404])
R(G, "POST /admin/wallets/{userId}/adjust", "adminAdjustWallet", "Adjust a wallet (a reason is required)", ADM, "AdjustWalletRequest", "AdminWallet", idem=True, status=201, errs=[404, 409, 422],
  desc="Writes an ADJUSTMENT ledger transaction and an audit entry. Cannot take a balance below zero.")
R(G, "GET /admin/payments", "adminListPayments", "Payments and their reconcile state", ADM, None, "AdminPaymentPage", q=PAGE_Q + ["status:str:PaymentStatus"])
R(G, "POST /admin/payments/{paymentId}/reverify", "adminReverifyPayment", "Re-run the provider verify for a stuck payment", ADM, None, "Payment", idem=True, errs=[404, 409])
R(G, "GET /admin/audit", "adminAudit", "Audit log", ADM, None, "AuditPage", q=PAGE_Q + ["action:str:", "targetType:str:", "targetId:str:"])
