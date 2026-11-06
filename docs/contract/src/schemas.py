# Compact schema DSL -> OpenAPI 3.1 component schemas.
# field spec: "?" optional (not required), "~" nullable. Types: uuid str int bool num time date kobo milli json
# "$Name" ref, "[T]" array, "enum:A|B"
ENUMS = {
 "Role": "MODERATOR EDITOR AD_MANAGER ADMIN",
 "NewsTag": "VERIFIED_NEWS UNVERIFIED_NEWS GOSSIP",
 "ReactionKind": "POWERFUL WILD RELATABLE FUNNY SURPRISING SAD WELL_SAID THOUGHT_PROVOKING EXACTLY DISAGREE",
 "ReplyStance": "AGREE DISAGREE EXPERIENCE",
 "PostKind": "TEXT VOICE",
 "QuestionKind": "DAILY FLASH FOLLOW_UP OVERRIDE",
 "QuestionStatus": "DRAFT SCHEDULED LIVE CLOSED",
 "TopicStatus": "DRAFT IN_REVIEW SCHEDULED LIVE CLOSED",
 "PollStatus": "SCHEDULED OPEN CLOSED",
 "PollKind": "WEEKLY FLASH QUESTION",
 "ContentStatus": "PUBLISHED HELD REMOVED DELETED_BY_AUTHOR",
 "ReportTargetType": "ANSWER REPLY PROPOSAL RESULT_POST USER",
 "ReportReason": "HATE_OR_HARASSMENT THREAT_OR_VIOLENCE SCAM_OR_SPAM PERSONAL_DETAILS MISLEADING_NEWS_TAG ABOUT_ME OTHER",
 "ModerationQueue": "REPORTED SCREENED SENSITIVE PRIORITY APPEAL",
 "ModerationActionKind": "KEEP REMOVE WARN REMOVE_AND_WARN SUSPEND BAN RESTORE",
 "ShareObjectType": "QUESTION ANSWER POLL_RESULT WEEKLY_REPORT PROFILE CATEGORY RESULT_THREAD WHAT_NEXT_SUMMARY",
 "ShareTarget": "WHATSAPP WHATSAPP_STATUS INSTAGRAM_STORIES FACEBOOK X TIKTOK TELEGRAM SMS COPY_LINK SYSTEM_SHEET",
 "PaymentKind": "UNITS EXTRA_VOICE",
 "PaymentStatus": "INITIATED PENDING SUCCEEDED FAILED EXPIRED REFUNDED",
 "ExtraVoiceTokenKind": "SECONDS_30 SECONDS_60",
 "ExtraVoiceTokenStatus": "AVAILABLE RESERVED USED REFUNDED",
 "NotificationType": "DAILY_QUESTION REPLY REACTIONS POLL_CLOSED FLASH_POLL CATEGORY_ALERT TAG_FOLLOW TAG_CHANGED UNITS_ADDED EXTRA_VOICE_ADDED RESULT_CHECKED WEEKLY_REPORT OVERRIDE_ALERT MODERATION_NOTICE",
 "AdKind": "FEED_CARD BANNER AUDIO_SLOT WALLET_OFFER",
 "AdStatus": "DRAFT AWAITING_APPROVAL APPROVED REJECTED PAUSED",
 "AdEventKind": "IMPRESSION TAP LISTEN",
 "OverrideContentKind": "TEXT VOICE IMAGE LINK",
 "OverrideStatus": "SCHEDULED LIVE ENDED CANCELLED",
 "WeeklyReportStatus": "DRAFT HELD APPROVED PUBLISHED",
 "ResultPostStatus": "NOT_VERIFIED VERIFIED REMOVED",
 "ResultThreadStatus": "SCHEDULED OPEN CLOSED",
 "VoiceClipPurpose": "ANSWER REPLY PROPOSAL VOTE_EXPLANATION VOICE_CARD OVERRIDE_NOTE AD_AUDIO",
 "VoiceClipStatus": "PENDING_UPLOAD UPLOADED PROCESSING READY FAILED REMOVED",
 "FileKind": "AVATAR RESULT_PHOTO OVERRIDE_IMAGE AD_CREATIVE",
 "LedgerTxnKind": "PURCHASE SPEND_POST SPEND_REACTION SPEND_VOTE REVERSAL ADJUSTMENT REFUND",
 "ChargeAction": "POST_TEXT POST_VOICE REACTION VOTE",
 "AccountStatus": "ACTIVE SUSPENDED BANNED DELETION_PENDING DELETED",
 "ProposalStanceKind": "SUPPORT CHALLENGE",
 "FeedSort": "TOP NEW DEBATED",
 "ErrorCode": "BAD_REQUEST MIN_TOPICS VALIDATION_FAILED UNAUTHENTICATED TOKEN_EXPIRED FORBIDDEN ROLE_REQUIRED ACCOUNT_SUSPENDED NOT_FOUND CONFLICT IDEMPOTENCY_KEY_REQUIRED IDEMPOTENCY_KEY_REUSED REQUEST_IN_PROGRESS INSUFFICIENT_UNITS FREE_POSTS_EXHAUSTED VOICE_TOO_LONG EXTRA_VOICE_REQUIRED QUESTION_CLOSED POLL_CLOSED POLL_NOT_STARTED ALREADY_VOTED EDIT_WINDOW_PASSED HANDLE_TAKEN AGE_CONFIRMATION_REQUIRED TAG_REQUIRED VERIFIED_NEWS_FORBIDDEN SOURCE_REQUIRED CLIP_NOT_READY CLIP_NOT_FOUND UPLOAD_NOT_RECEIVED PAYMENT_NOT_VERIFIED PAYMENT_AMOUNT_MISMATCH PAYMENT_EXPIRED CONTENT_REMOVED BLOCKED_BY_USER RATE_LIMITED PAYLOAD_TOO_LARGE UNSUPPORTED_MEDIA_TYPE UNAVAILABLE INTERNAL",
}

S = {}
def obj(name, fields, desc=None):
    S[name] = {"_fields": fields, "_desc": desc}

obj("Error", {"error": "$ErrorBody"}, "The one error shape. Every non-2xx response is this.")
obj("ErrorBody", {"code": "$ErrorCode", "message": "str", "requestId": "str", "?details": "json", "?retryAfterSeconds": "int"})
obj("Page", {"nextCursor": "~str"}, "Cursor pages: every list is {items, nextCursor}. Cursors are opaque.")

# ---- me / profile
obj("AllowanceQuote", {"action": "enum:POST_TEXT|POST_VOICE|REACTION|VOTE", "costMilli": "milli", "freeLeft": "int", "balanceMilli": "milli"},
  "One quote: what this action costs this person now (0 while a free one is left). Returned by GET /me/allowance?action=.")
obj("Allowances", {"freePostsRemaining": "int", "balanceMilli": "milli", "maxVoiceSeconds": "int",
  "freeReactionsLeftToday": "int", "freeVotesLeftToday": "int",
  "costs": "$ActionCosts", "extraVoiceTokens": "[$ExtraVoiceToken]"},
  "What the person can do right now and what it costs. The screens show this before any tap.")
obj("ActionCosts", {"freeReactionsPerDay": "int", "freeVotesPerDay": "int", "baseKoboPerUnit": "kobo", "textPostMilli": "milli", "voicePostMilli": "milli", "reactionAfterFreeMilli": "milli", "voteAfterFreeMilli": "milli",
  "minPackKobo": "kobo", "extraVoice30Kobo": "kobo", "extraVoice60Kobo": "kobo", "textMaxChars": "int", "freeVoiceSeconds": "int"})
obj("Me", {"phoneMasked": "~str", "id": "uuid", "wawuId": "str", "handle": "~str", "profileComplete": "bool", "savedCount": "int", "replyCount": "int", "reactionsReceived": "int", "roles": "[$Role]", "profile": "~$Profile",
  "allowances": "$Allowances", "unreadNotifications": "int", "settings": "$Settings", "referralCode": "str", "status": "$AccountStatus"})
obj("Profile", {"id": "uuid", "handle": "str", "?displayName": "~str", "?bio": "~str", "?avatarUrl": "~str", "?voiceCard": "~$VoiceClip",
  "countryCode": "str", "?state": "~str", "?city": "~str", "languages": "[str]", "joinedAt": "time", "voiceCount": "int", "replyCount": "int", "reactionsReceived": "int"}, "voiceCount, replyCount and reactionsReceived are stored counters kept in step by the service, never counted per request.")
obj("PublicProfile", {"profile": "$Profile", "isBlockedByMe": "bool", "recentAnswers": "[$Answer]", "nextCursor": "~str"})
obj("CreateMeRequest", {"handle": "str", "ageConfirmed": "bool", "termsAccepted": "bool", "rulesAccepted": "bool",
  "countryCode": "str", "languages": "[str]", "categoryIds": "[uuid]", "?referralCode": "str"},
  "First call after WAWU ID sign-in. Idempotent: a second call with the same body returns the same Me.")
obj("UpdateProfileRequest", {"?displayName": "~str", "?bio": "~str", "?avatarFileId": "~uuid", "?voiceCardClipId": "~uuid",
  "?state": "~str", "?city": "~str", "?languages": "[str]", "?countryCode": "str", "?handle": "str"})
obj("Settings", {"language": "str", "dataSaver": "bool", "theme": "enum:system|light|dark", "timezone": "str",
  "quietHoursStart": "~int", "quietHoursEnd": "~int", "notifyDailyQuestion": "bool", "notifyReplies": "bool", "notifyReactions": "bool",
  "notifyPollResults": "bool", "notifyFlashPolls": "bool", "notifyCategoryAlerts": "bool", "dailyQuestionMinute": "int"})
obj("UpdateSettingsRequest", {"?language": "str", "?dataSaver": "bool", "?theme": "enum:system|light|dark", "?timezone": "str",
  "?quietHoursStart": "~int", "?quietHoursEnd": "~int", "?notifyDailyQuestion": "bool", "?notifyReplies": "bool", "?notifyReactions": "bool",
  "?notifyPollResults": "bool", "?notifyFlashPolls": "bool", "?notifyCategoryAlerts": "bool", "?dailyQuestionMinute": "int"})
obj("CategoryFollow", {"categoryId": "uuid", "alertsOn": "bool"})
obj("SetCategoriesRequest", {"categories": "[$CategoryFollow]"})
obj("TagFollow", {"tag": "$NewsTag"})
obj("SetTagFollowsRequest", {"tags": "[$NewsTag]"})
obj("BlockedUser", {"user": "$Profile", "blockedAt": "time"})
obj("DataExport", {"id": "uuid", "status": "enum:PENDING|READY|EXPIRED", "?downloadUrl": "~str", "requestedAt": "time", "?expiresAt": "~time"})
obj("DeleteAccountRequest", {"confirmHandle": "str", "understandUnitsForfeited": "bool"})

# ---- topics, questions
obj("Category", {"id": "uuid", "slug": "str", "name": "str", "?blurb": "~str", "voicesThisWeek": "int", "questionCount": "int"})
obj("Topic", {"questionCount": "int", "id": "uuid", "weekNumber": "int", "title": "str", "?blurb": "~str", "countryCode": "str", "startsOn": "date", "endsOn": "date",
  "status": "$TopicStatus", "sensitive": "bool", "?whatNextPrompt": "~str", "voiceCount": "int", "?weeklyPollId": "~uuid", "?reportId": "~uuid"})
obj("CalendarWeek", {"weekNumber": "int", "topicId": "uuid", "title": "str", "startsOn": "date", "status": "$TopicStatus"})
obj("Question", {"iSaved": "bool", "recentVoices": "[$AvatarRef]", "id": "uuid", "kind": "$QuestionKind", "status": "$QuestionStatus", "text": "str", "?hint": "~str", "?category": "~$Category",
  "?topicId": "~uuid", "?topicTitle": "~str", "?weekNumber": "~int", "scheduledFor": "~date", "startsAt": "~time", "endsAt": "~time", "pinned": "bool", "sensitive": "bool",
  "voiceCount": "int", "answerCount": "int", "hasOpenPoll": "bool", "proposalCount": "int",
  "?override": "~$OverrideContent"})
obj("OverrideContent", {"contentKind": "$OverrideContentKind", "?body": "~str", "?audioUrl": "~str", "?imageUrl": "~str", "?linkUrl": "~str", "endsAt": "time"})
obj("QuestionPage", {"items": "[$Question]", "nextCursor": "~str"})
obj("Home", {"topicOfWeek": "$Topic", "dailyQuestion": "~$Question", "flashPoll": "~$Poll", "trending": "[$Answer]", "newConversations": "[$Question]", "?sponsored": "~$AdPlacement", "greetingName": "~str"})
obj("CategoryDetail", {"counts": "$CategoryCounts", "topVoices": "[$Answer]", "category": "$Category", "todaysQuestion": "~$Question", "questions": "[$Question]", "topVoice": "~$Answer", "nextCursor": "~str"})

# ---- answers
obj("VoiceClip", {"id": "uuid", "status": "$VoiceClipStatus", "durationMs": "~int", "maxDurationMs": "int", "peaks": "~[int]", "?transcript": "~$Transcript"})
obj("Transcript", {"status": "enum:PENDING|READY|FAILED", "language": "~str", "text": "~str"})
obj("AuthorRef", {"id": "uuid", "handle": "str", "?displayName": "~str", "?state": "~str", "?avatarUrl": "~str"}, "Anonymous posts carry author null.")
obj("NewsLabel", {"tag": "$NewsTag", "?sourceName": "~str", "?sourceUrl": "~str", "chosenBy": "str", "chosenAt": "time"}, "Always shown with the post, in the feed, in search and on share cards.")
obj("Answer", {"?categoryName": "~str", "id": "uuid", "questionId": "uuid", "author": "~$AuthorRef", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip",
  "createdAt": "time", "editedAt": "~time", "status": "$ContentStatus", "news": "~$NewsLabel",
  "likeCount": "int", "replyCount": "int", "agreeCount": "int", "disagreeCount": "int", "reactionCount": "int",
  "reactionBreakdown": "[$ReactionCount]", "myReaction": "~$ReactionKind", "iLiked": "bool", "iSaved": "bool", "isMine": "bool",
  "labels": "[enum:TRENDING|MOST_RELATABLE|MOST_THOUGHT_PROVOKING|MOST_DEBATED|MOST_SUPPORTED|MOST_SURPRISING]",
  "?questionText": "~str", "?explainsVote": "bool"})
obj("PublicConfig", {"currency": "enum:NGN", "freePosts": "int", "unitBaseKobo": "kobo", "costs": "$ActionCosts", "tiers": "[$UnitTier]", "extraVoice": "[$ExtraVoiceOffer]", "voiceFreeSeconds": "int"}, "Guest-readable prices and limits for Landing, Onboarding and the Voice Units screens. Same values as config, never typed into a client.")
obj("Country", {"code": "str", "name": "str", "currency": "str", "status": "enum:live|coming"})
obj("CountryList", {"items": "[$Country]"})
obj("CategoryFollowList", {"categories": "[$CategoryFollow]"})
obj("SavedItem", {"kind": "enum:ANSWER|QUESTION", "savedAt": "time", "?answer": "~$Answer", "?question": "~$Question"})
obj("SavedPage", {"items": "[$SavedItem]", "nextCursor": "~str"})
obj("ProposalList", {"items": "[$Proposal]"})
obj("AppealRequest", {"targetType": "$ReportTargetType", "targetId": "uuid", "note": "str"})
obj("AppealReceipt", {"id": "uuid", "status": "enum:OPEN|DECIDED"})
obj("SupportMessageRequest", {"topic": "enum:PAYMENT|ACCOUNT|CONTENT|OTHER", "message": "str", "?paymentId": "uuid", "?contactEmail": "str"})
obj("SupportReceipt", {"id": "uuid"})
obj("Emotion", {"name": "str", "share": "num", "change": "num"}, "share is the percent of voices; change is the move in percentage points since last week.")
obj("CategoryCounts", {"open": "int", "closed": "int", "polls": "int"})
obj("Health", {"status": "enum:ok", "db": "enum:up"})
obj("AvatarRef", {"id": "uuid", "handle": "str", "?avatarUrl": "~str"})
obj("ReactionCount", {"kind": "$ReactionKind", "count": "int"})
obj("AnswerPage", {"items": "[$AnswerOrAd]", "nextCursor": "~str"})
obj("AnswerOrAd", {"type": "enum:answer|sponsored", "?answer": "$Answer", "?ad": "$AdPlacement"}, "A sponsored card never sits in the first 3 items and is never mixed into ranking.")
obj("CreateAnswerRequest", {"kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid",
  "?isNews": "bool", "?newsTag": "$NewsTag", "?newsSourceName": "str", "?newsSourceUrl": "str", "?anonymous": "bool"},
  "Text answers carry body. Voice answers carry clipId of a READY clip. A clip over the free length also needs an extra voice token. isNews requires newsTag; VERIFIED_NEWS needs an editor or admin role and a source.")
obj("EditAnswerRequest", {"body": "str"}, "Text only, within 5 minutes of posting.")
obj("PostReceipt", {"answer": "$Answer", "charge": "$ChargeSummary", "allowances": "$Allowances"})
obj("ChargeSummary", {"costMilli": "milli", "usedFreePost": "bool", "usedFreeDaily": "bool", "balanceMilli": "milli"})
obj("Reply", {"helpfulCount": "int", "id": "uuid", "answerId": "uuid", "author": "$AuthorRef", "stance": "$ReplyStance", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip",
  "createdAt": "time", "status": "$ContentStatus", "isMine": "bool"})
obj("ReplyPage", {"items": "[$Reply]", "nextCursor": "~str", "?counts": "$StanceCounts"}, "counts (agree, disagree, experience) come with the replies of one answer.")
obj("StanceCounts", {"agree": "int", "disagree": "int", "experience": "int"})
obj("CreateReplyRequest", {"stance": "$ReplyStance", "kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid"})
obj("ReplyReceipt", {"reply": "$Reply", "charge": "$ChargeSummary", "allowances": "$Allowances"})
obj("LikeState", {"answerId": "uuid", "iLiked": "bool", "likeCount": "int"})
obj("ReactionRequest", {"kind": "$ReactionKind"})
obj("ReactionState", {"answerId": "uuid", "myReaction": "~$ReactionKind", "reactionCount": "int", "reactionBreakdown": "[$ReactionCount]", "?charge": "$ChargeSummary"})

# ---- voice
obj("CreateVoiceClipRequest", {"purpose": "$VoiceClipPurpose", "mime": "enum:audio/webm|audio/mp4|audio/ogg|audio/mpeg|audio/aac",
  "sizeBytes": "int", "durationMs": "int", "?extraVoiceTokenId": "uuid"})
obj("VoiceUpload", {"clip": "$VoiceClip", "putUrl": "str", "putHeaders": "json", "expiresAt": "time"},
  "PUT the file bytes to putUrl with putHeaders, then call complete. The URL is signed for this one object.")
obj("PlayUrl", {"url": "str", "expiresAt": "time", "mime": "str"}, "Short-lived signed streaming URL. Raw files are never offered for download.")
obj("CreateUploadRequest", {"kind": "$FileKind", "mime": "enum:image/jpeg|image/png|image/webp", "sizeBytes": "int"})
obj("FileUpload", {"fileId": "uuid", "putUrl": "str", "putHeaders": "json", "expiresAt": "time"})
obj("UploadedFile", {"fileId": "uuid", "kind": "$FileKind", "confirmedAt": "time"})

# ---- polls
obj("PollOption", {"id": "uuid", "label": "str", "?votes": "int", "?percent": "num"}, "votes and percent appear once the person has voted, or the poll is closed, or results are live.")
obj("Poll", {"id": "uuid", "kind": "$PollKind", "title": "str", "choiceMode": "enum:SINGLE|MULTIPLE", "status": "$PollStatus", "publicInterest": "bool",
  "startsAt": "time", "endsAt": "time", "questionId": "~uuid", "topicId": "~uuid", "totalVotes": "int", "options": "[$PollOption]",
  "myVote": "~[uuid]", "costToVoteMilli": "milli", "?label": "str"}, "label is always 'Open poll': an open poll is never called a national survey.")
obj("PollResults", {"pollId": "uuid", "status": "$PollStatus", "totalVotes": "int", "options": "[$PollOption]", "leadingOptionId": "~uuid", "asOf": "time", "myVote": "~[uuid]"})
obj("VoteRequest", {"optionIds": "[uuid]"})
obj("VoteReceipt", {"vote": "$MyVote", "results": "$PollResults", "charge": "$ChargeSummary"})
obj("MyVote", {"id": "uuid", "pollId": "uuid", "optionIds": "[uuid]", "createdAt": "time"})
obj("ExplainVoteRequest", {"kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid"})

# ---- what next
obj("Proposal", {"id": "uuid", "questionId": "uuid", "author": "$AuthorRef", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip", "label": "enum:PROPOSED",
  "supportCount": "int", "challengeCount": "int", "improveCount": "int", "groupId": "~uuid", "improvesId": "~uuid", "myStance": "~$ProposalStanceKind", "createdAt": "time", "isMine": "bool"},
  "label is always PROPOSED. A proposal is never shown as accepted.")
obj("ProposalGroup", {"id": "uuid", "title": "str", "confirmed": "bool", "proposalCount": "int", "supportCount": "int", "challengeCount": "int", "topProposal": "~$Proposal"})
obj("EditorialSummary", {"topicId": "uuid", "mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str",
  "basedOnVoices": "int", "basedOnVotes": "int", "updatedAt": "time", "reviewedByEditor": "bool"}, "Shown only after an editor reviews it. Wording is 'lean towards' or 'split', never 'everyone agrees'.")
obj("WhatNext", {"question": "$Question", "summary": "~$EditorialSummary", "proposalTotal": "int", "groupTotal": "int", "groups": "[$ProposalGroup]", "proposals": "[$Proposal]", "nextCursor": "~str"})
obj("CreateProposalRequest", {"kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid", "?improvesId": "uuid"})
obj("ProposalReceipt", {"proposal": "$Proposal", "charge": "$ChargeSummary", "similar": "[$Proposal]"})
obj("StanceRequest", {"kind": "$ProposalStanceKind"})
obj("ProposalPage", {"items": "[$Proposal]", "nextCursor": "~str"})

# ---- results
obj("ResultThread", {"id": "uuid", "title": "str", "?subtitle": "~str", "heldOn": "date", "status": "$ResultThreadStatus", "postCount": "int", "verifiedCount": "int", "toCheck": "int"})
obj("ResultPost", {"id": "uuid", "threadId": "uuid", "author": "$AuthorRef", "state": "str", "lga": "str", "ward": "str", "pollingUnit": "str",
  "accredited": "int", "votesCast": "int", "rejected": "int", "status": "$ResultPostStatus", "label": "enum:Verified|Not verified",
  "checkedAt": "~time", "checkedLine": "~str", "createdAt": "time", "isMine": "bool"},
  "Totals only. The sheet photo is never returned here: only the WAWU team sees it.")
obj("ResultPostPage", {"items": "[$ResultPost]", "nextCursor": "~str", "newCount": "int", "newestCursor": "~str"}, "Pass newestCursor back as `after` to learn how many results are new (no stream).")
obj("CreateResultPostRequest", {"state": "str", "lga": "str", "ward": "str", "pollingUnit": "str", "accredited": "int", "votesCast": "int", "rejected": "int", "?photoFileId": "uuid"})

# ---- news
obj("NewsPostPage", {"items": "[$Answer]", "nextCursor": "~str"})
obj("FlagRequest", {"?note": "str"})
obj("TagInfo", {"count": "int", "newCount": "int", "tag": "$NewsTag", "label": "str", "meaning": "str", "followed": "bool"})

# ---- reports, blocks
obj("CreateReportRequest", {"targetType": "$ReportTargetType", "targetId": "uuid", "reason": "$ReportReason", "?note": "str", "?alsoBlock": "bool"})
obj("ReportReceipt", {"id": "uuid", "status": "enum:OPEN|ACTIONED|DISMISSED", "blocked": "bool"})

# ---- weekly
obj("WeeklyQuote", {"excerpt": "str", "placeLabel": "str", "?clipUrl": "~str"})
obj("WeeklyReport", {"emotions": "[$Emotion]", "id": "uuid", "topicId": "uuid", "weekNumber": "int", "title": "str", "range": "str", "mood": "~str", "summary": "str",
  "themes": "json", "sentiment": "json", "pollSummary": "json", "quotes": "[$WeeklyQuote]", "basedOnVoices": "int", "basedOnVotes": "int",
  "label": "enum:AI-assisted and human-reviewed", "publishedAt": "time"})
obj("WeeklyReportCard", {"id": "uuid", "weekNumber": "int", "title": "str", "range": "str", "mood": "~str", "basedOnVoices": "int", "basedOnVotes": "int", "publishedAt": "time"})
obj("WeeklyArchive", {"latest": "~$WeeklyReportCard", "items": "[$WeeklyReportCard]", "nextCursor": "~str", "nextPublishAt": "~time"})

# ---- search, notifications
obj("SearchResults", {"questions": "[$Question]", "answers": "[$Answer]", "people": "[$Profile]", "topics": "[$Topic]", "totals": "$SearchTotals", "nextCursor": "~str"})
obj("SearchTotals", {"questions": "int", "voices": "int", "people": "int", "topics": "int"})
obj("Notification", {"id": "uuid", "type": "$NotificationType", "title": "str", "body": "~str", "targetType": "~str", "targetId": "~uuid", "actorCount": "int", "read": "bool", "createdAt": "time"})
obj("NotificationPage", {"items": "[$Notification]", "nextCursor": "~str", "unread": "int"})

# ---- share
obj("CreateShareLinkRequest", {"objectType": "$ShareObjectType", "objectId": "uuid", "?language": "str"})
obj("ShareLink", {"code": "str", "url": "str", "cardStatus": "enum:PENDING|READY|FAILED|FALLBACK", "?storyImageUrl": "~str", "?squareImageUrl": "~str", "?imageUrl": "~str", "previewText": "str"}, "imageUrl is the one 1200x630 card (V-22), null while PENDING or FAILED. storyImageUrl is the 1080x1920 Stories card (GET /share/{code}/story), null only where that route would 404. squareImageUrl is not drawn: null at launch.")
obj("ShareEventRequest", {"kind": "enum:intent|link_open|add_voice_tap|recording_started|published_from_link", "?target": "$ShareTarget"})
obj("SharePage", {"code": "str", "objectType": "$ShareObjectType", "topicLine": "str", "countryAndTheme": "str", "arguments": "[$ShareArgument]", "leanLine": "~str",
  "poll": "~$PollResults", "proposalCount": "~int", "topProposal": "~$Proposal", "news": "~$NewsLabel", "basedOnVoices": "int", "summaryUpdatedAt": "time",
  "summaryLabel": "str", "featuredVoice": "~$Answer", "transcript": "~str", "question": "~$Question", "report": "~$WeeklyReportCard", "cardFallback": "bool",
  "ctaLabel": "str", "openGraph": "$OpenGraph"}, "Public. No account, no app. 'Add your voice' is the one call to action.")
obj("ShareArgument", {"text": "str", "voices": "int"})
obj("OpenGraph", {"title": "str", "description": "str", "imageUrl": "str", "url": "str"})

# ---- units
obj("UnitTier", {"id": "uuid", "slug": "str", "name": "str", "priceKobo": "kobo", "unitsMilli": "milli", "bonusMilli": "milli", "effectiveKoboPerUnit": "int", "baseKoboPerUnit": "int"}, "effectiveKoboPerUnit is price divided by all units including the bonus; baseKoboPerUnit is price divided by units without the bonus.")
obj("TiersResponse", {"tiers": "[$UnitTier]", "minPackKobo": "kobo", "costs": "$ActionCosts", "extraVoice": "[$ExtraVoiceOffer]", "?walletOffer": "~$AdPlacement"})
obj("ExtraVoiceOffer", {"kind": "$ExtraVoiceTokenKind", "maxSeconds": "int", "priceKobo": "kobo", "label": "str"})
obj("ExtraVoiceToken", {"id": "uuid", "kind": "$ExtraVoiceTokenKind", "maxSeconds": "int", "status": "$ExtraVoiceTokenStatus", "createdAt": "time"})
obj("Wallet", {"balanceMilli": "milli", "freePostsRemaining": "int", "freePostsUsed": "int", "allowances": "$Allowances", "costs": "$ActionCosts", "tokens": "[$ExtraVoiceToken]"})
obj("LedgerItem", {"amountKobo": "~kobo", "freePostsLeft": "~int", "id": "uuid", "kind": "$LedgerTxnKind", "title": "str", "deltaMilli": "milli", "balanceAfterMilli": "~milli", "free": "bool", "paymentId": "~uuid", "hasReceipt": "bool", "createdAt": "time", "note": "~str"},
  "Extra voice purchases appear with deltaMilli 0 and a receipt: they are naira, not units.")
obj("LedgerPage", {"items": "[$LedgerItem]", "nextCursor": "~str"})
obj("InitPaymentRequest", {"?method": "enum:card|banktransfer|ussd", "kind": "$PaymentKind", "?tierId": "uuid", "?tokenKind": "$ExtraVoiceTokenKind", "?returnPath": "str"})
obj("PaymentInit", {"paymentId": "uuid", "txRef": "str", "amountKobo": "kobo", "currency": "enum:NGN", "unitsMilli": "~milli", "checkoutUrl": "str", "expiresAt": "time"},
  "Send the person to checkoutUrl (Flutterwave hosted payment). The amount is fixed here, by us.")
obj("Payment", {"id": "uuid", "kind": "$PaymentKind", "status": "$PaymentStatus", "amountKobo": "kobo", "txRef": "str", "title": "str", "unitsMilli": "~milli", "bonusMilli": "~milli",
  "method": "~str", "cardLast4": "~str", "receiptNo": "~str", "failureReason": "~str", "balanceMilli": "~milli", "createdAt": "time", "verifiedAt": "~time", "token": "~$ExtraVoiceToken"})
obj("VerifyPaymentRequest", {"?providerTxId": "str"}, "The server never trusts this value alone: it calls Flutterwave's verify itself and compares reference, amount and currency.")
obj("Receipt", {"receiptNo": "str", "txRef": "str", "title": "str", "amountKobo": "kobo", "unitsMilli": "~milli", "method": "~str", "cardLast4": "~str", "paidAt": "time", "buyerHandle": "str"})
obj("FlutterwaveWebhook", {"event": "str", "data": "json"}, "Flutterwave's own payload. Verified by the verif-hash header, then re-verified with the verify call.")

# ---- ads
obj("AdPlacement", {"id": "uuid", "kind": "$AdKind", "brand": "str", "label": "enum:Ad|Sponsored", "headline": "str", "?body": "~str", "?imageUrl": "~str",
  "?audioClipId": "~uuid", "?linkUrl": "~str", "?ctaLabel": "~str"}, "Always labelled. Audio plays only when tapped.")
obj("AdEventRequest", {"kind": "$AdEventKind"})

# ---- analytics
obj("AnalyticsBatch", {"events": "[$AnalyticsEventIn]"})
obj("AnalyticsEventIn", {"name": "str", "at": "time", "?props": "json", "?sessionId": "str"})

# ---- admin
obj("AdminRoleGrant", {"user": "$Profile", "roles": "[$Role]"})
obj("SetRolesRequest", {"roles": "[$Role]", "reason": "str"})
obj("AdminToday", {"date": "date", "weekNumber": "int", "topic": "$Topic", "flowState": "enum:NORMAL|OVERRIDE_LIVE", "todaysQuestion": "$Question",
  "stats": "$TodayStats", "schedule": "[$ScheduleItem]", "nextQuestion": "~$Question",
  "needsAttention": "$AttentionCounts"})
obj("TodayStats", {"sharesByTarget": "[$ShareTargetCount]", "voicesToday": "int", "voicePercent": "int", "pollVotes": "int", "shares": "int", "openReports": "int", "oldestReportMinutes": "~int"})
obj("ShareTargetCount", {"target": "$ShareTarget", "count": "int"})
obj("ScheduleItem", {"at": "time", "title": "str", "state": "enum:DONE|SCHEDULED|NEEDS_YOU"})
obj("AttentionCounts", {"newsFlagged": "int", "newsAskingVerified": "int", "adsAwaiting": "int", "moderationOpen": "int", "newsTags": "int", "resultPosts": "int", "ads": "int", "weeklyReports": "int", "moderation": "int", "sensitive": "int"})
obj("AdminTopicList", {"items": "[$CalendarWeek]", "nextCursor": "~str", "counts": "$TopicChipCounts", "totals": "$TopicTotals"})
obj("TopicChipCounts", {"live": "int", "scheduled": "int", "inReview": "int", "draft": "int", "sensitive": "int"})
obj("TopicTotals", {"weeks": "int", "questions": "int"})
obj("AdminTopic", {"topic": "$Topic", "questions": "[$AdminQuestion]", "spare": "[$AdminQuestion]", "poll": "~$Poll"})
obj("AdminQuestion", {"id": "uuid", "kind": "$QuestionKind", "slotIndex": "~int", "day": "~date", "text": "str", "hint": "~str", "status": "$QuestionStatus", "pinned": "bool", "isSpare": "bool", "categoryId": "~uuid", "voiceCount": "int"})
obj("UpsertTopicRequest", {"weekNumber": "int", "title": "str", "?blurb": "str", "startsOn": "date", "?sensitive": "bool", "?whatNextPrompt": "str", "?status": "$TopicStatus"})
obj("CreateQuestionRequest", {"?topicId": "uuid", "?categoryId": "uuid", "kind": "$QuestionKind", "text": "str", "?hint": "str", "?scheduledFor": "date", "?slotIndex": "int", "?isSpare": "bool", "?pinned": "bool", "?featured": "bool", "?sensitive": "bool", "?startsAt": "time", "?endsAt": "time", "?status": "$QuestionStatus"})
obj("UpsertQuestionRequest", {"?topicId": "uuid", "?categoryId": "uuid", "?kind": "$QuestionKind", "text": "str", "?hint": "str", "?scheduledFor": "date", "?slotIndex": "int", "?isSpare": "bool", "?pinned": "bool", "?featured": "bool", "?sensitive": "bool", "?startsAt": "time", "?endsAt": "time", "?status": "$QuestionStatus"})
obj("UpsertPollRequest", {"?topicId": "uuid", "?questionId": "uuid", "kind": "$PollKind", "title": "str", "choiceMode": "enum:SINGLE|MULTIPLE", "options": "[str]", "startsAt": "time", "endsAt": "time", "?publicInterest": "bool", "?showLiveResults": "bool"})
obj("AdminOverride", {"headline": "~str", "id": "uuid", "status": "$OverrideStatus", "contentKind": "$OverrideContentKind", "?body": "~str", "?linkUrl": "~str", "?imageUrl": "~str", "?audioUrl": "~str",
  "startsAt": "time", "endsAt": "time", "emergency": "bool", "notifyAlert": "bool", "keepWeeklyTheme": "bool", "dropReplaced": "bool",
  "replaced": "~$Question", "questionId": "uuid", "by": "str", "createdAt": "time", "result": "~str"})
obj("CreateOverrideRequest", {"?headline": "str", "contentKind": "$OverrideContentKind", "?body": "str", "?voiceClipId": "uuid", "?imageFileId": "uuid", "?linkUrl": "str",
  "startsAt": "time", "endsAt": "time", "?emergency": "bool", "?notifyAlert": "bool", "?keepWeeklyTheme": "bool", "?dropReplaced": "bool", "?reason": "str"})
obj("OverridePreview", {"replaced": "~$Question", "schedule": "[$AdminQuestion]"}, "What the week looks like after the override: the replaced question moves to the next free slot, the rest shift one day.")
obj("CancelRequest", {"reason": "str"})
obj("ModerationItem", {"id": "uuid", "queue": "$ModerationQueue", "targetType": "$ReportTargetType", "targetId": "uuid", "reasons": "[str]", "reportCount": "int", "priority": "bool",
  "summary": "str", "createdAt": "time", "status": "enum:OPEN|RESOLVED", "questionText": "~str", "listenCount": "int", "postKind": "~enum:VOICE|TEXT|REPLY_VOICE|REPLY_TEXT"})
obj("ModerationItemDetail", {"listenCount": "int", "item": "$ModerationItem", "author": "~$ModAuthor", "content": "json", "transcript": "~str", "playUrl": "~str", "screening": "[str]", "context": "~$Question", "audit": "[$AuditLine]"})
obj("ModAuthor", {"id": "uuid", "handle": "str", "joinedAt": "time", "postCount": "int", "strikeCount": "int"})
obj("AuditLine", {"at": "time", "text": "str", "by": "~str"})
obj("ModerationPage", {"items": "[$ModerationItem]", "nextCursor": "~str", "counts": "json"})
obj("ModerationDecision", {"action": "$ModerationActionKind", "reason": "str"})
obj("AdminNewsItem", {"answer": "$Answer", "flagCount": "int", "flagReasons": "[str]", "verifiedRequested": "bool", "sourceName": "~str", "sourceUrl": "~str", "evidenceUrl": "~str", "changeLog": "[$AuditLine]", "summary": "str"})
obj("AdminNewsPage", {"items": "[$AdminNewsItem]", "nextCursor": "~str", "waiting": "int", "counts": "$NewsTabCounts"})
obj("NewsTabCounts", {"flagged": "int", "askingVerified": "int", "allChanges": "int"})
obj("NewsDecision", {"decision": "enum:KEEP|CHANGE_TAG|SEND_TO_MODERATION|APPROVE_VERIFIED|DECLINE_VERIFIED", "?newTag": "$NewsTag", "?sourceName": "str", "?sourceUrl": "str", "reason": "str"})
obj("AdminResultPost", {"post": "$ResultPost", "photoUrl": "~str", "hasPhoto": "bool", "checkedBy": "~str"})
obj("AdminResultPage", {"items": "[$AdminResultPost]", "nextCursor": "~str", "toCheck": "int"})
obj("ResultDecision", {"decision": "enum:VERIFIED|NOT_VERIFIED|SEND_TO_MODERATION", "?note": "str"})
obj("CreateResultThreadRequest", {"title": "str", "?subtitle": "str", "heldOn": "date", "?status": "$ResultThreadStatus", "?topicId": "uuid"})
obj("AdminWeeklyReport", {"emotions": "[$Emotion]", "cardTitle": "~str", "editorNote": "~str", "id": "uuid", "topicId": "uuid", "weekNumber": "int", "status": "$WeeklyReportStatus", "draftedAt": "time", "pollClosedAt": "~time", "publishAt": "~time", "headline": "~str", "mood": "~str", "summary": "~str", "themes": "json", "sentiment": "json", "pollSummary": "json",
  "quotes": "[$AdminQuote]", "basedOnVoices": "int", "basedOnVotes": "int", "languagesRead": "[str]", "checks": "[$ReportCheck]"})
obj("AdminQuote", {"answerId": "uuid", "excerpt": "str", "placeLabel": "str", "consent": "bool"})
obj("ReportCheck", {"text": "str", "ok": "bool"})
obj("EditWeeklyReportRequest", {"?cardTitle": "str", "?editorNote": "str", "?emotions": "[$Emotion]", "?headline": "str", "?mood": "str", "?summary": "str", "?themes": "json", "?quotes": "[$AdminQuote]"})
obj("ApproveWeeklyRequest", {"publishAt": "time"})
obj("HoldRequest", {"reason": "str"})
obj("AdminAd", {"live": "bool", "ageBands": "[str]", "checks": "[$ReportCheck]", "id": "uuid", "brand": "str", "kind": "$AdKind", "status": "$AdStatus", "headline": "str", "body": "~str", "linkUrl": "~str", "ctaLabel": "~str", "imageUrl": "~str", "audioClipId": "~uuid",
  "categoryIds": "[uuid]", "states": "[str]", "startsOn": "~date", "endsOn": "~date", "frequencyCapPerDay": "int", "priceKobo": "~kobo",
  "views": "int", "taps": "int", "listens": "int", "rejectReason": "~str", "changeRequest": "~str"})
obj("AdminAdPage", {"items": "[$AdminAd]", "nextCursor": "~str", "awaitingApproval": "int"})
obj("UpsertAdRequest", {"?ageBands": "[str]", "brand": "str", "kind": "$AdKind", "headline": "str", "?body": "str", "?linkUrl": "str", "?ctaLabel": "str", "?imageFileId": "uuid", "?audioClipId": "uuid",
  "?categoryIds": "[uuid]", "?states": "[str]", "?startsOn": "date", "?endsOn": "date", "?frequencyCapPerDay": "int", "?priceKobo": "kobo"})
obj("AdDecision", {"decision": "enum:APPROVE|REJECT|ASK_FOR_CHANGES|PAUSE|RESUME", "?reason": "str"})
obj("ConfigEntry", {"key": "str", "value": "json", "description": "~str", "placeholder": "bool", "version": "int", "updatedAt": "time", "updatedBy": "~str"})
obj("ConfigList", {"items": "[$ConfigEntry]"})
obj("UpdateConfigRequest", {"value": "json", "reason": "str"})
obj("ConfigChange", {"id": "uuid", "key": "str", "oldValue": "json", "newValue": "json", "reason": "str", "by": "str", "createdAt": "time", "rollbackOfId": "~uuid"})
obj("ConfigChangePage", {"items": "[$ConfigChange]", "nextCursor": "~str"})
obj("AdjustWalletRequest", {"deltaMilli": "adjmilli", "reason": "str"})
obj("AdminWallet", {"user": "$Profile", "balanceMilli": "milli", "freePostsRemaining": "int", "ledger": "[$LedgerItem]", "payments": "[$Payment]", "nextCursor": "~str"})
obj("AdminPaymentPage", {"items": "[$Payment]", "nextCursor": "~str"})
obj("AdminUserPage", {"items": "[$AdminUser]", "nextCursor": "~str"})
obj("AdminUser", {"profile": "$Profile", "status": "$AccountStatus", "roles": "[$Role]", "strikes": "int", "createdAt": "time"})
obj("SuspendRequest", {"until": "~time", "reason": "str", "ban": "bool"})
obj("ConfirmGroupRequest", {"title": "str", "proposalIds": "[uuid]"})
obj("SummaryEditRequest", {"mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str", "approve": "bool"})
obj("AuditPage", {"items": "[$AuditEntry]", "nextCursor": "~str"})
obj("AuditEntry", {"id": "uuid", "at": "time", "actor": "~str", "action": "str", "targetType": "str", "targetId": "~str", "reason": "~str", "before": "json", "after": "json"})
