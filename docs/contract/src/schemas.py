# Compact schema DSL -> OpenAPI 3.1 component schemas.
# field spec: "?" optional (not required), "~" nullable. Types: uuid str int bool num time date kobo milli json
# "$Name" ref, "[T]" array, "enum:A|B"
ENUMS = {
 "Role": "MODERATOR EDITOR AD_MANAGER ADMIN",
 "NewsTag": "VERIFIED_NEWS UNVERIFIED_NEWS GOSSIP",
 "Mood": "ANGRY TIRED PROUD HOPEFUL",
 "ReactionKind": "POWERFUL WILD RELATABLE FUNNY SURPRISING SAD WELL_SAID THOUGHT_PROVOKING EXACTLY DISAGREE",
 "ReplyStance": "AGREE DISAGREE EXPERIENCE",
 "PostKind": "TEXT VOICE",
 "QuestionKind": "DAILY FLASH FOLLOW_UP OVERRIDE",
 "QuestionStatus": "DRAFT SCHEDULED LIVE CLOSED",
 "TopicStatus": "DRAFT IN_REVIEW SCHEDULED LIVE CLOSED",
 "PollStatus": "SCHEDULED OPEN CLOSED",
 "PollKind": "WEEKLY FLASH QUESTION",
 "ContentStatus": "PUBLISHED HELD REMOVED DELETED_BY_AUTHOR",
 "ReportTargetType": "ANSWER REPLY PROPOSAL RESULT_POST USER DM_MESSAGE",
 "ReportReason": "HATE_OR_HARASSMENT THREAT_OR_VIOLENCE SCAM_OR_SPAM PERSONAL_DETAILS MISLEADING_NEWS_TAG ABOUT_ME OTHER",
 "ModerationQueue": "REPORTED SCREENED SENSITIVE PRIORITY APPEAL",
 "ModerationActionKind": "KEEP REMOVE WARN REMOVE_AND_WARN SUSPEND BAN RESTORE",
 "ShareObjectType": "QUESTION ANSWER POLL_RESULT WEEKLY_REPORT PROFILE CATEGORY RESULT_THREAD WHAT_NEXT_SUMMARY",
 "ShareTarget": "WHATSAPP WHATSAPP_STATUS INSTAGRAM_STORIES FACEBOOK X TIKTOK TELEGRAM SMS COPY_LINK SYSTEM_SHEET",
 "PaymentKind": "UNITS EXTRA_VOICE SUBSCRIPTION",
 "PaymentStatus": "INITIATED PENDING SUCCEEDED FAILED EXPIRED REFUNDED",
 "ExtraVoiceTokenKind": "SECONDS_30 SECONDS_60",
 "ExtraVoiceTokenStatus": "AVAILABLE RESERVED USED REFUNDED",
 "NotificationType": "DAILY_QUESTION REPLY REACTIONS POLL_CLOSED FLASH_POLL CATEGORY_ALERT TAG_FOLLOW TAG_CHANGED UNITS_ADDED EXTRA_VOICE_ADDED RESULT_CHECKED WEEKLY_REPORT OVERRIDE_ALERT MODERATION_NOTICE VIDEO_READY",
 "AdKind": "FEED_CARD BANNER AUDIO_SLOT WALLET_OFFER",
 "AdStatus": "DRAFT AWAITING_APPROVAL APPROVED REJECTED PAUSED",
 "AdEventKind": "IMPRESSION TAP LISTEN",
 "OverrideContentKind": "TEXT VOICE IMAGE LINK",
 "OverrideStatus": "SCHEDULED LIVE ENDED CANCELLED",
 "WeeklyReportStatus": "DRAFT HELD APPROVED PUBLISHED",
 "ResultPostStatus": "NOT_VERIFIED VERIFIED REMOVED",
 "ResultThreadStatus": "SCHEDULED OPEN CLOSED",
 "VoiceClipPurpose": "ANSWER REPLY PROPOSAL VOTE_EXPLANATION VOICE_CARD OVERRIDE_NOTE AD_AUDIO SURVEY_ANSWER DM",
 "VoiceClipStatus": "PENDING_UPLOAD UPLOADED PROCESSING READY FAILED REMOVED",
 "FileKind": "AVATAR RESULT_PHOTO OVERRIDE_IMAGE AD_CREATIVE",
 "LedgerTxnKind": "PURCHASE SPEND_POST SPEND_REACTION SPEND_VOTE REVERSAL ADJUSTMENT REFUND SUBSCRIPTION_CREDIT",
 "SubscriptionStatus": "ACTIVE QUEUED ENDED CANCELLED_DELETED",
 "ChargeAction": "POST_TEXT POST_VOICE REACTION VOTE",
 "AccountStatus": "ACTIVE SUSPENDED BANNED DELETION_PENDING DELETED",
 "ProposalStanceKind": "SUPPORT CHALLENGE",
 "FeedSort": "TOP NEW DEBATED",
 "ErrorCode": "BAD_REQUEST MIN_TOPICS VALIDATION_FAILED UNAUTHENTICATED TOKEN_EXPIRED FORBIDDEN ROLE_REQUIRED ACCOUNT_SUSPENDED NOT_FOUND CONFLICT IDEMPOTENCY_KEY_REQUIRED IDEMPOTENCY_KEY_REUSED REQUEST_IN_PROGRESS INSUFFICIENT_UNITS FREE_POSTS_EXHAUSTED VOICE_TOO_LONG EXTRA_VOICE_REQUIRED DAILY_LIMIT_REACHED TEXT_FIX_FAILED QUESTION_CLOSED QUESTION_NOT_OPEN POLL_CLOSED POLL_NOT_STARTED ALREADY_VOTED EDIT_WINDOW_PASSED HANDLE_TAKEN AGE_CONFIRMATION_REQUIRED TAG_REQUIRED VERIFIED_NEWS_FORBIDDEN SOURCE_REQUIRED CLIP_NOT_READY CLIP_NOT_FOUND UPLOAD_NOT_RECEIVED PAYMENT_NOT_VERIFIED PAYMENT_AMOUNT_MISMATCH PAYMENT_EXPIRED CONTENT_REMOVED BLOCKED_BY_USER RATE_LIMITED PAYLOAD_TOO_LARGE UNSUPPORTED_MEDIA_TYPE UNAVAILABLE INTERNAL subscription_required verification_required dm_unavailable",
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
  "?messagesLeftToday": "int", "freeReactionsLeftToday": "int", "freeVotesLeftToday": "int",
  "costs": "$ActionCosts", "extraVoiceTokens": "[$ExtraVoiceToken]"},
  "What the person can do right now and what it costs. The screens show this before any tap.")
obj("ActionCosts", {"freeReactionsPerDay": "int", "freeVotesPerDay": "int", "baseKoboPerUnit": "kobo", "textPostMilli": "milli", "voicePostMilli": "milli", "reactionAfterFreeMilli": "milli", "voteAfterFreeMilli": "milli",
  "minPackKobo": "kobo", "extraVoice30Kobo": "kobo", "extraVoice60Kobo": "kobo", "textMaxChars": "int", "freeVoiceSeconds": "int",
  "?textPriceChars": "int", "?freePostTextChars": "int", "?messagesPerDay": "int", "?textFixMilli": "milli", "?voiceTier1Seconds": "int", "?voiceMaxSeconds": "int"},
  "Prices in tokens (V-36). textPostMilli is the price of textPriceChars characters, charged in proportion (5 tokens per 150 characters, rounded to the hundredth). The voice prices are extraVoice30Kobo (up to voiceTier1Seconds) and extraVoice60Kobo (up to voiceMaxSeconds), in kobo: 1 token is 100 kobo. A free post covers a voice of freeVoiceSeconds or a text of freePostTextChars; longer pays in full.")
obj("Me", {"phoneMasked": "~str", "id": "uuid", "wawuId": "str", "handle": "~str", "profileComplete": "bool", "savedCount": "int", "replyCount": "int", "reactionsReceived": "int", "roles": "[$Role]", "profile": "~$Profile",
  "allowances": "$Allowances", "unreadNotifications": "int", "settings": "$Settings", "referralCode": "str", "status": "$AccountStatus", "?deletionScheduledFor": "~time"}, "deletionScheduledFor (RW9) is the day the pending deletion will run: requested-at plus 14 days; null when none is pending.")
obj("Profile", {"id": "uuid", "handle": "str", "?displayName": "~str", "?bio": "~str", "?avatarUrl": "~str", "?admin": "bool", "?voiceCard": "~$VoiceClip",
  "countryCode": "str", "?state": "~str", "?city": "~str", "languages": "[str]", "joinedAt": "time", "voiceCount": "int", "?voicesCount": "int", "replyCount": "int", "reactionsReceived": "int", "?verified": "bool"}, "voiceCount, replyCount and reactionsReceived are stored counters kept in step by the service, never counted per request. voicesCount (lead ruling WF, 6 Nov, RW1) is the one count of this person's published top-level answers, voice or text (anonymous ones only on their own page): \"My voices N\" and the Person tab use it.")
obj("PublicProfile", {"profile": "$Profile", "isBlockedByMe": "bool", "recentAnswers": "[$Answer]", "nextCursor": "~str"})
obj("CreateMeRequest", {"handle": "str", "ageConfirmed": "bool", "termsAccepted": "bool", "rulesAccepted": "bool",
  "countryCode": "str", "languages": "[str]", "categoryIds": "[uuid]", "?referralCode": "str"},
  "First call after WAWU ID sign-in. Idempotent: a second call with the same body returns the same Me.")
obj("UpdateProfileRequest", {"?displayName": "~str", "?bio": "~str", "?avatarFileId": "~uuid", "?voiceCardClipId": "~uuid",
  "?state": "~str", "?city": "~str", "?languages": "[str]", "?countryCode": "str", "?handle": "str"})
obj("MyInvite", {"code": "str", "url": "str", "friendsAnswered": "int"})
obj("ClaimInviteRequest", {"code": "str"})
obj("InviterHandle", {"handle": "~str"})
obj("Friend", {"handle": "str", "displayName": "~str", "answeredAt": "time", "word": "~enum:ANGRY|TIRED|PROUD|HOPEFUL", "wordShared": "bool"})
obj("FriendsPage", {"count": "int", "items": "[$Friend]", "nextCursor": "~str"})
obj("Settings", {"language": "str", "dataSaver": "bool", "theme": "enum:system|light|dark", "timezone": "str",
  "quietHoursStart": "~int", "quietHoursEnd": "~int", "notifyDailyQuestion": "bool", "notifyWeeklyTopic": "bool", "notifyReplies": "bool", "notifyReactions": "bool",
  "notifyPollResults": "bool", "notifyFlashPolls": "bool", "notifyCategoryAlerts": "bool", "notifyTagFollows": "bool", "dailyQuestionMinute": "int", "shareMyWord": "bool", "useMyStateForSurveys": "bool", "dmOpen": "bool"})
obj("UpdateSettingsRequest", {"?language": "str", "?dataSaver": "bool", "?theme": "enum:system|light|dark", "?timezone": "str",
  "?quietHoursStart": "~int", "?quietHoursEnd": "~int", "?notifyDailyQuestion": "bool", "?notifyWeeklyTopic": "bool", "?notifyReplies": "bool", "?notifyReactions": "bool",
  "?notifyPollResults": "bool", "?notifyFlashPolls": "bool", "?notifyCategoryAlerts": "bool", "?notifyTagFollows": "bool", "?dailyQuestionMinute": "int", "?shareMyWord": "bool", "?useMyStateForSurveys": "bool", "?dmOpen": "bool"})
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
  "status": "$TopicStatus", "sensitive": "bool", "?whatNextPrompt": "~str", "voiceCount": "int", "?voicesCount": "int", "?weeklyPollId": "~uuid", "?reportId": "~uuid"}, "voicesCount (RW1) is the sum of its questions' voicesCount: the number every \"N voices so far\" shows. A week that has not started (status SCHEDULED) sends its title and dates only: questionCount is 0 (the field is a required integer), weeklyPollId and reportId are null, and the counts are 0.")
obj("CalendarWeek", {"weekNumber": "int", "topicId": "uuid", "title": "str", "startsOn": "date", "status": "$TopicStatus"})
obj("Question", {"iSaved": "bool", "recentVoices": "[$AvatarRef]", "id": "uuid", "kind": "$QuestionKind", "status": "$QuestionStatus", "text": "str", "?hint": "~str", "?moodOptions": "[$Mood]", "?category": "~$Category",
  "?topicId": "~uuid", "?topicTitle": "~str", "?weekNumber": "~int", "scheduledFor": "~date", "startsAt": "~time", "endsAt": "~time", "pinned": "bool", "sensitive": "bool",
  "voiceCount": "int", "answerCount": "int", "?voicesCount": "int", "hasOpenPoll": "bool", "proposalCount": "int",
  "?override": "~$OverrideContent"}, "moodOptions (LCH-02) lists the words the question offers: empty on an ordinary question; when it is not empty every answer carries one of them. voicesCount (lead ruling WF, 6 Nov, RW1) is the one voices count for every screen and card: top-level answers, voice or text, not removed or deleted. It equals answerCount. voiceCount stays the number of voice clips.")
obj("OverrideContent", {"contentKind": "$OverrideContentKind", "?body": "~str", "?audioUrl": "~str", "?audioClipId": "~uuid", "?audioDurationMs": "~int", "?imageUrl": "~str", "?linkUrl": "~str", "endsAt": "time"},
  "V-FIX-B: the message, picture, voice note and link an override carries. imageUrl is a public CDN link. The voice note is private like every voice: audioUrl stays null and the page plays audioClipId through GET /voice-clips/{clipId}/play (a short-lived link) when the person taps play. linkUrl opens from a button under the message.")
obj("QuestionPage", {"items": "[$Question]", "nextCursor": "~str"})
obj("Home", {"topicOfWeek": "$Topic", "dailyQuestion": "~$Question", "flashPoll": "~$Poll", "trending": "[$Answer]", "newConversations": "[$Question]", "?sponsored": "~$AdPlacement", "greetingName": "~str"}, "trending is the top voices of today's question only (empty until that question has opened); it is not a cross-question list.")
obj("CategoryDetail", {"counts": "$CategoryCounts", "topVoices": "[$Answer]", "category": "$Category", "todaysQuestion": "~$Question", "questions": "[$Question]", "topVoice": "~$Answer", "nextCursor": "~str"})

# ---- answers
obj("VoiceClip", {"id": "uuid", "status": "$VoiceClipStatus", "durationMs": "~int", "maxDurationMs": "int", "peaks": "~[int]", "?transcript": "~$Transcript"})
obj("Transcript", {"status": "enum:PENDING|READY|FAILED", "language": "~str", "text": "~str"})
obj("AuthorRef", {"id": "uuid", "handle": "str", "?displayName": "~str", "?state": "~str", "?avatarUrl": "~str", "?admin": "bool", "?verified": "bool"}, "Anonymous posts carry author null (no picture, no admin mark). admin is true only while the person holds the ADMIN role (the web shows an Admin pill beside the name; editors and moderators are not marked). verified (V-46) is true while an admin-approved ID and bill and a running subscription stand; the web shows a tick beside the name.")
obj("NewsLabel", {"tag": "$NewsTag", "?sourceName": "~str", "?sourceUrl": "~str", "chosenBy": "str", "chosenAt": "time"}, "Always shown with the post, in the feed, in search and on share cards.")
obj("Answer", {"?categoryName": "~str", "id": "uuid", "questionId": "uuid", "author": "~$AuthorRef", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip",
  "createdAt": "time", "editedAt": "~time", "status": "$ContentStatus", "news": "~$NewsLabel",
  "likeCount": "int", "replyCount": "int", "agreeCount": "int", "disagreeCount": "int", "reactionCount": "int",
  "reactionBreakdown": "[$ReactionCount]", "myReaction": "~$ReactionKind", "iLiked": "bool", "iSaved": "bool", "isMine": "bool",
  "labels": "[enum:TRENDING|MOST_RELATABLE|MOST_THOUGHT_PROVOKING|MOST_DEBATED|MOST_SUPPORTED|MOST_SURPRISING]",
  "?questionText": "~str", "?explainsVote": "bool", "?mood": "~$Mood"}, "mood (LCH-02) is the one word of an answer to a mood question, null on any other.")
obj("PublicConfig", {"currency": "enum:NGN", "?dmsLive": "bool", "freePosts": "int", "unitBaseKobo": "kobo", "costs": "$ActionCosts", "tiers": "[$UnitTier]", "extraVoice": "[$ExtraVoiceOffer]", "voiceFreeSeconds": "int"}, "Guest-readable prices and limits for Landing, Onboarding and the token screens. Same values as config, never typed into a client.")
obj("Country", {"code": "str", "name": "str", "currency": "str", "status": "enum:live|coming"})
obj("CountryList", {"items": "[$Country]"})
obj("CategoryFollowList", {"categories": "[$CategoryFollow]"})
obj("SavedItem", {"kind": "enum:ANSWER|QUESTION", "savedAt": "time", "?answer": "~$Answer", "?question": "~$Question"})
obj("SavedPage", {"items": "[$SavedItem]", "nextCursor": "~str"})
obj("ProposalList", {"items": "[$Proposal]"})
obj("AppealRequest", {"targetType": "enum:ANSWER|REPLY|PROPOSAL|RESULT_POST|USER|DM_MESSAGE", "targetId": "uuid", "note": "str"})
obj("AppealReceipt", {"id": "uuid", "status": "enum:OPEN|DECIDED"})
obj("SupportMessageRequest", {"topic": "enum:PAYMENT|ACCOUNT|CONTENT|OTHER", "message": "str", "?paymentId": "uuid", "?contactEmail": "str"})
obj("SupportReceipt", {"id": "uuid"})
obj("RegionShare", {"state": "str", "votes": "int", "leading": "str", "percent": "int"}, "One state in the weekly poll: how many votes came from it, the choice that led there and its whole percent. A state under the anonymity floor (config weekly.min_group_size) is never listed.")
obj("Emotion", {"name": "str", "share": "num", "change": "~num"}, "share is the percent of people who chose a mood (a mood under 5 people is folded into Other); change is the move in percentage points since last week, or null when last week had too few mood answers to compare.")
obj("CategoryCounts", {"open": "int", "closed": "int", "polls": "int"})
obj("Health", {"status": "enum:ok", "db": "enum:up"})
obj("AvatarRef", {"id": "uuid", "handle": "str", "?avatarUrl": "~str", "?admin": "bool"})
obj("ReactionCount", {"kind": "$ReactionKind", "count": "int"})
obj("AnswerPage", {"items": "[$AnswerOrAd]", "nextCursor": "~str"})
obj("AnswerOrAd", {"type": "enum:answer|sponsored", "?answer": "$Answer", "?ad": "$AdPlacement"}, "A sponsored card never sits in the first 3 items and is never mixed into ranking.")
obj("CreateAnswerRequest", {"kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid",
  "?isNews": "bool", "?newsTag": "$NewsTag", "?newsSourceName": "str", "?newsSourceUrl": "str", "?requestVerified": "bool", "?anonymous": "bool", "?mood": "$Mood", "?showNameOnCard": "bool"},
  "Text answers carry body. Voice answers carry clipId of a READY clip. A clip over the free length also needs an extra voice token. isNews requires newsTag VERIFIED_NEWS needs an editor or admin role and a source. requestVerified (V-FIX-B) asks the editors for Verified News: it needs isNews, newsTag UNVERIFIED_NEWS and newsSourceName (the source the editors check, kept on the request, not shown on the post); the post goes up as Unverified News and waits in the editors' queue. On a question with moodOptions every answer, voice or text, carries one of them in mood (422 \"Pick one word before you post.\" otherwise); on any other question mood is refused. showNameOnCard (LCH-03) is off unless true and ignored on an anonymous answer.")
obj("MoodCountItem", {"mood": "$Mood", "count": "int", "percent": "int"})
obj("MoodCounts", {"questionId": "uuid", "total": "int", "updatedAt": "time", "items": "[$MoodCountItem]"}, "LCH-02: valid answers per word, everyone, whole percents.")
obj("WhereYouSitGroup", {"percent": "~int", "voices": "~int"}, "percent is a whole percent and voices the valid answers in the group, both null while the group holds fewer than 50.")
obj("WhereYouSit", {"answerId": "uuid", "questionId": "uuid", "mood": "$Mood", "showNameOnCard": "bool", "nigeria": "$WhereYouSitGroup", "world": "$WhereYouSitGroup", "defaultScope": "enum:NIGERIA|WORLD", "showSwitch": "bool", "line": "str", "cardLine": "str", "updatedAt": "time"}, "LCH-04. showSwitch is false until a group has a percentage (no Nigeria / World switch before 50). line is the sentence for the default scope; cardLine is the same sentence as the share card draws it.")
obj("CardNameRequest", {"showName": "bool"})
obj("MakeVideoRequest", {"shape": "enum:9x16|1x1"})
obj("VoiceVideo", {"id": "uuid", "answerId": "uuid", "shape": "enum:9x16|1x1", "status": "enum:QUEUED|MAKING|READY|FAILED", "durationMs": "~int", "url": "~str", "createdAt": "time", "readyAt": "~time"}, "LCH-07: url is the file route, only when READY.")
obj("VoiceVideoList", {"items": "[$VoiceVideo]"})
obj("CardNameResult", {"answerId": "uuid", "showNameOnCard": "bool"})
obj("EditAnswerRequest", {"body": "str"}, "Text only, within 5 minutes of posting.")
obj("PostReceipt", {"answer": "$Answer", "charge": "$ChargeSummary", "allowances": "$Allowances"})
obj("ChargeSummary", {"costMilli": "milli", "usedFreePost": "bool", "usedFreeDaily": "bool", "balanceMilli": "milli"})
obj("Reply", {"helpfulCount": "int", "id": "uuid", "answerId": "uuid", "author": "~$AuthorRef", "stance": "$ReplyStance", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip",
  "createdAt": "time", "status": "$ContentStatus", "isMine": "bool"},
  "author is null for a reply posted without the person's name, for every reader including the writer (isMine says it is theirs). A person's own page lists these replies for that person only.")
obj("ReplyPage", {"items": "[$Reply]", "nextCursor": "~str", "?counts": "$StanceCounts"}, "counts (agree, disagree, experience) come with the replies of one answer.")
obj("StanceCounts", {"agree": "int", "disagree": "int", "experience": "int"})
obj("CreateReplyRequest", {"stance": "$ReplyStance", "kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid", "?anonymous": "bool"},
  "anonymous (default false) posts the reply without the person's name: no read of the reply, notice or mail carries the author. A reply by the writer of a nameless answer, under that answer, is always nameless whatever this says.")
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
obj("ExplainVoteRequest", {"kind": "$PostKind", "?body": "str", "?clipId": "uuid", "?extraVoiceTokenId": "uuid", "?mood": "$Mood", "?questionId": "uuid"}, "LCH-02: on a mood question the explanation is an answer and carries one of its words in mood, as POST /questions/{id}/answers does; on any other question mood is refused. H2: questionId is the question the voter came from (the one whose words they were shown); a weekly poll has no question of its own, so the reason is posted under it. It must belong to the poll's conversation (422 otherwise). Without it a weekly poll uses the topic's open question in slot order.")

# ---- what next
obj("Proposal", {"id": "uuid", "questionId": "uuid", "author": "$AuthorRef", "kind": "$PostKind", "?body": "~str", "?clip": "~$VoiceClip", "label": "enum:PROPOSED",
  "supportCount": "int", "challengeCount": "int", "improveCount": "int", "groupId": "~uuid", "improvesId": "~uuid", "myStance": "~$ProposalStanceKind", "createdAt": "time", "isMine": "bool"},
  "label is always PROPOSED. A proposal is never shown as accepted.")
obj("ProposalGroup", {"id": "uuid", "title": "str", "confirmed": "bool", "proposalCount": "int", "supportCount": "int", "challengeCount": "int", "topProposal": "~$Proposal"})
obj("EditorialSummary", {"topicId": "uuid", "mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str",
  "basedOnVoices": "int", "basedOnVotes": "int", "updatedAt": "time", "reviewedByEditor": "bool", "?aiDrafted": "bool"}, "Shown only after an editor reviews it. aiDrafted is true when the wording came from the AI draft (the page then says AI-assisted). The two counts are voices an editor counted, never poll votes; approving needs both at least 1 and together no more than basedOnVoices. Wording is 'lean towards' or 'split', never 'everyone agrees'.")
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
obj("RequestVerifiedRequest", {"sourceName": "str", "?sourceUrl": "str"}, "V-FIX-B: the source the editors will check. sourceName is 1 to 200 characters; sourceUrl, if sent, is a full http(s) link.")
obj("VerifiedRequestReceipt", {"id": "uuid", "status": "enum:OPEN|APPROVED|DECLINED"})
obj("TagInfo", {"count": "int", "newCount": "int", "tag": "$NewsTag", "label": "str", "meaning": "str", "followed": "bool"})

# ---- reports, blocks
obj("CreateReportRequest", {"targetType": "$ReportTargetType", "targetId": "uuid", "reason": "$ReportReason", "?note": "str", "?alsoBlock": "bool"})
obj("ReportReceipt", {"id": "uuid", "status": "enum:OPEN|ACTIONED|DISMISSED", "blocked": "bool"})

# ---- weekly
obj("WeeklyQuote", {"excerpt": "str", "placeLabel": "str", "?clipUrl": "~str"})
obj("WeeklyReport", {"emotions": "[$Emotion]", "?regions": "[$RegionShare]", "id": "uuid", "topicId": "uuid", "weekNumber": "int", "title": "str", "range": "str", "mood": "~str", "summary": "str",
  "themes": "json", "sentiment": "json", "pollSummary": "json", "quotes": "[$WeeklyQuote]", "basedOnVoices": "int", "basedOnVotes": "int",
  "label": "enum:AI-assisted and human-reviewed", "publishedAt": "time"})
obj("WeeklyReportCard", {"id": "uuid", "weekNumber": "int", "title": "str", "range": "str", "mood": "~str", "basedOnVoices": "int", "basedOnVotes": "int", "publishedAt": "time"})
obj("WeeklyArchive", {"latest": "~$WeeklyReportCard", "items": "[$WeeklyReportCard]", "nextCursor": "~str", "nextPublishAt": "~time"})

# ---- search, notifications
obj("SearchResults", {"questions": "[$Question]", "answers": "[$Answer]", "people": "[$Profile]", "topics": "[$Topic]", "totals": "$SearchTotals", "nextCursor": "~str"})
obj("SearchTotals", {"questions": "int", "voices": "int", "people": "int", "topics": "int"})
obj("Notification", {"id": "uuid", "type": "$NotificationType", "title": "str", "body": "~str", "targetType": "~str", "targetId": "~uuid", "actorCount": "int", "read": "bool", "createdAt": "time", "?questionId": "~uuid", "?appeal": "~$NoticeAppeal", "?resolved": "bool"},
  "RW7: replies and reactions are worded from who did them, \"@kemi.b replied to your voice\" with the quote in body, \"@tunde.a and 41 others reacted to your voice\"; a person blocked either way is never named and their notice is not served; every notice has a body and a target. questionId is the question to open when the target is an answer or a question. resolved (RX2) is true on a removal, warning, suspension or ban notice whose appeal has been decided since: it has no Appeal action and is shown as resolved.")
obj("NoticeAppeal", {"state": "enum:AVAILABLE|SENT", "targetType": "$ReportTargetType", "targetId": "uuid"}, "RW2: present on a removal, warning, suspension or ban notice. Send POST /appeals with this target while state is AVAILABLE; SENT means the appeal is waiting for another moderator.")
obj("NotificationPage", {"items": "[$Notification]", "nextCursor": "~str", "unread": "int"})

# ---- share
obj("CreateShareLinkRequest", {"objectType": "$ShareObjectType", "objectId": "uuid", "?language": "str"})
obj("ShareLink", {"code": "str", "url": "str", "cardStatus": "enum:PENDING|READY|FAILED|FALLBACK", "?storyImageUrl": "~str", "?squareImageUrl": "~str", "?imageUrl": "~str", "previewText": "str"}, "imageUrl is the one 1200x630 card (V-22), null while PENDING or FAILED. storyImageUrl is the 1080x1920 Stories card (GET /share/{code}/story), null only where that route would 404. squareImageUrl is the 1080x1080 card (GET /share/{code}/square) for every kind (brief 6.8), null only where that route would 404. An anonymous voice carries no name and no invite code on any size.")
obj("ShareEventRequest", {"kind": "enum:intent|link_open|add_voice_tap|recording_started|published_from_link", "?target": "$ShareTarget"})
obj("SharePage", {"code": "str", "objectType": "$ShareObjectType", "topicLine": "str", "countryAndTheme": "str", "arguments": "[$ShareArgument]", "leanLine": "~str",
  "poll": "~$PollResults", "proposalCount": "~int", "topProposal": "~$Proposal", "news": "~$NewsLabel", "basedOnVoices": "int", "summaryUpdatedAt": "time",
  "summaryLabel": "str", "featuredVoice": "~$Answer", "transcript": "~str", "question": "~$Question", "report": "~$WeeklyReportCard", "cardFallback": "bool",
  "ctaLabel": "str", "openGraph": "$OpenGraph"}, "Public. No account, no app. 'Add your voice' is the one call to action.")
obj("ShareArgument", {"text": "str", "voices": "int"})
obj("OpenGraph", {"title": "str", "description": "str", "imageUrl": "str", "url": "str"})

# ---- units
obj("Quote", {"priceKobo": "kobo", "vatKobo": "kobo", "chargeKobo": "kobo", "totalKobo": "kobo"},
  "What the customer pays: the price, VAT on it and the payment charge, each rounded up to the kobo. The tokens or plan value are priced at priceKobo and never change; totalKobo is what is sent to Flutterwave and what verification requires.")
obj("UnitTier", {"id": "uuid", "slug": "str", "name": "str", "priceKobo": "kobo", "unitsMilli": "milli", "bonusMilli": "milli", "effectiveKoboPerUnit": "int", "baseKoboPerUnit": "int", "?quote": "$Quote"}, "effectiveKoboPerUnit is price divided by all units including the bonus; baseKoboPerUnit is price divided by units without the bonus.")
obj("TiersResponse", {"?vatRateBps": "int", "tiers": "[$UnitTier]", "minPackKobo": "kobo", "costs": "$ActionCosts", "extraVoice": "[$ExtraVoiceOffer]", "?walletOffer": "~$AdPlacement"})
obj("ExtraVoiceOffer", {"kind": "$ExtraVoiceTokenKind", "maxSeconds": "int", "priceKobo": "kobo", "label": "str"})
obj("ExtraVoiceToken", {"id": "uuid", "kind": "$ExtraVoiceTokenKind", "maxSeconds": "int", "status": "$ExtraVoiceTokenStatus", "createdAt": "time"})
obj("Wallet", {"balanceMilli": "milli", "freePostsRemaining": "int", "freePostsUsed": "int", "allowances": "$Allowances", "costs": "$ActionCosts", "tokens": "[$ExtraVoiceToken]"})
obj("LedgerItem", {"amountKobo": "~kobo", "freePostsLeft": "~int", "id": "uuid", "kind": "$LedgerTxnKind", "title": "str", "deltaMilli": "milli", "balanceAfterMilli": "~milli", "free": "bool", "paymentId": "~uuid", "hasReceipt": "bool", "createdAt": "time", "note": "~str"},
  "Extra voice purchases appear with deltaMilli 0 and a receipt: they are naira, not units.")
obj("LedgerPage", {"items": "[$LedgerItem]", "nextCursor": "~str"})
obj("InitPaymentRequest", {"?method": "enum:card|banktransfer|ussd", "kind": "$PaymentKind", "?tierId": "uuid", "?planId": "uuid", "?tokenKind": "$ExtraVoiceTokenKind", "?returnPath": "str"},
  "For kind SUBSCRIPTION send planId. A second plan is refused (409 SUBSCRIPTION_ACTIVE) while one runs or waits.")
obj("PaymentInit", {"paymentId": "uuid", "txRef": "str", "?reference": "str", "amountKobo": "kobo", "?vatKobo": "~kobo", "?chargeKobo": "~kobo", "?totalKobo": "~kobo", "currency": "enum:NGN", "unitsMilli": "~milli", "checkoutUrl": "str", "expiresAt": "time"},
  "Send the person to checkoutUrl (Flutterwave hosted payment). The amount is fixed here, by us.")
obj("Payment", {"id": "uuid", "kind": "$PaymentKind", "status": "$PaymentStatus", "amountKobo": "kobo", "?vatKobo": "~kobo", "?chargeKobo": "~kobo", "?totalKobo": "~kobo", "txRef": "str", "?reference": "str", "title": "str", "unitsMilli": "~milli", "bonusMilli": "~milli",
  "method": "~str", "cardLast4": "~str", "receiptNo": "~str", "failureReason": "~str", "balanceMilli": "~milli", "createdAt": "time", "verifiedAt": "~time", "token": "~$ExtraVoiceToken", "?plan": "~$PaymentPlan"},
  "For a SUBSCRIPTION, unitsMilli is the total over all its months: nothing is credited at once beyond the first month.")
obj("PaymentPlan", {"slug": "str", "name": "str", "months": "int", "monthlyMilli": "milli"})
obj("SubscriptionPlan", {"id": "uuid", "slug": "str", "name": "str", "months": "int", "priceKobo": "kobo", "monthlyMilli": "milli", "totalMilli": "milli", "?quote": "$Quote"})
obj("SubscriptionPlans", {"?vatRateBps": "int", "plans": "[$SubscriptionPlan]"}, "Prices and tokens come from config (docs/launch/PRICING.md). Paid once up front; tokens are credited month by month.")
obj("Subscription", {"id": "uuid", "planSlug": "str", "planName": "str", "status": "$SubscriptionStatus", "months": "int", "monthlyMilli": "milli", "totalMilli": "milli", "priceKobo": "kobo",
  "creditedMonths": "int", "startDay": "str", "endDay": "str", "nextCreditDay": "~str", "paymentId": "uuid"},
  "Days are Lagos calendar days, YYYY-MM-DD. Month n is credited on the same day of month n as the start day (the last day of a shorter month).")
obj("MySubscriptions", {"current": "~$Subscription", "queued": "~$Subscription", "past": "[$Subscription]", "canBuy": "bool"})
obj("VerifyPaymentRequest", {"?providerTxId": "str"}, "The server never trusts this value alone: it calls Flutterwave's verify itself and compares reference, amount and currency.")
obj("Receipt", {"receiptNo": "str", "?reference": "str", "txRef": "str", "title": "str", "amountKobo": "kobo", "?vatKobo": "~kobo", "?chargeKobo": "~kobo", "?totalKobo": "~kobo", "unitsMilli": "~milli", "method": "~str", "cardLast4": "~str", "paidAt": "time", "buyerHandle": "str"})
obj("FlutterwaveWebhook", {"event": "str", "data": "json"}, "Flutterwave's own payload. Verified by the verif-hash header, then re-verified with the verify call.")

# ---- ads
obj("AdPlacement", {"id": "uuid", "kind": "$AdKind", "brand": "str", "label": "enum:Ad|Sponsored", "headline": "str", "?body": "~str", "?imageUrl": "~str",
  "?audioClipId": "~uuid", "?audioDurationMs": "~int", "?linkUrl": "~str", "?ctaLabel": "~str"}, "Always labelled. Audio plays only when tapped: the page asks GET /voice-clips/{audioClipId}/play for a short-lived link (V-FIX-B). audioClipId is null on an audio advert whose recording is not ready.")
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
obj("TodayStats", {"sharesByTarget": "[$ShareTargetCount]", "voicesToday": "int", "voicePercent": "int", "pollVotes": "int", "shares": "int", "openReports": "int", "oldestReportMinutes": "~int", "dailyQuestionMailsToday": "int", "weeklyTopicMailsToday": "int", "topicMailBudgetLeftToday": "int", "?dailyQuestionMailRun": "$TopicMailRun", "?weeklyTopicMailRun": "$TopicMailRun"})
obj("TopicMailRun", {"?state": "enum:done|stopped|budget", "?at": "time", "sent": "int", "refused": "int", "onSkip": "int"})
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
obj("AdminOverride", {"headline": "~str", "id": "uuid", "status": "$OverrideStatus", "contentKind": "$OverrideContentKind", "?body": "~str", "?linkUrl": "~str", "?imageUrl": "~str", "?audioUrl": "~str", "?audioClipId": "~uuid",
  "startsAt": "time", "endsAt": "time", "emergency": "bool", "notifyAlert": "bool", "keepWeeklyTheme": "bool", "dropReplaced": "bool",
  "replaced": "~$Question", "questionId": "uuid", "by": "str", "?byName": "~str", "createdAt": "time", "result": "~str"})
obj("CreateOverrideRequest", {"?headline": "str", "contentKind": "$OverrideContentKind", "?body": "str", "?voiceClipId": "uuid", "?imageFileId": "uuid", "?linkUrl": "str",
  "startsAt": "time", "endsAt": "time", "?emergency": "bool", "?notifyAlert": "bool", "?keepWeeklyTheme": "bool", "?dropReplaced": "bool", "?reason": "str"})
obj("AdminQuestionPool", {"items": "[$AdminQuestion]", "nextCursor": "~str", "total": "int"}, "V-42: the question pool, newest first; total counts the whole pool.")
obj("BulkQuestionsRequest", {"kind": "enum:DAILY|FLASH", "?categoryId": "uuid", "lines": "[str]"}, "V-42 (K2): one question per line, at most 50 non-blank lines; the line number is the position in this list, counted from 1.")
obj("BulkQuestionLine", {"line": "int", "text": "str", "question": "~$AdminQuestion", "error": "~str"}, "One line of a bulk add: the question made, or why the line was refused.")
obj("BulkQuestionsResult", {"created": "int", "refused": "int", "items": "[$BulkQuestionLine]"}, "Every non-blank line, in order. A refused line does not stop the others.")
obj("ScheduleQuestionRequest", {"day": "date", "?replace": "bool"}, "V-42 (K3): the day to put the pool question on. replace true confirms swapping the question already there into the pool.")
obj("MoveQuestionRequest", {"day": "date"}, "RW6: the day (inside the question's own week) to put it on.")
obj("MoveQuestionResult", {"question": "$AdminQuestion", "swappedWith": "~$AdminQuestion"}, "swappedWith is the question that was on that day and now sits on the first one's old day (one transaction); null when the day was free.")
obj("OverridePreview", {"replaced": "~$Question", "schedule": "[$AdminQuestion]"}, "What the week looks like after the override: the replaced question moves to the next free slot, the rest shift one day.")
obj("CancelRequest", {"reason": "str"})
obj("ModerationItem", {"id": "uuid", "queue": "$ModerationQueue", "targetType": "$ReportTargetType", "targetId": "uuid", "reasons": "[str]", "reportCount": "int", "priority": "bool",
  "summary": "str", "createdAt": "time", "status": "enum:OPEN|RESOLVED", "questionText": "~str", "listenCount": "int", "postKind": "~enum:VOICE|TEXT|REPLY_VOICE|REPLY_TEXT"})
obj("ModerationItemDetail", {"listenCount": "int", "item": "$ModerationItem", "author": "~$ModAuthor", "content": "json", "transcript": "~str", "playUrl": "~str", "?appeals": "[$ModAppeal]", "?appealKind": "~enum:REMOVAL|WARNING|SUSPENSION", "screening": "[str]", "context": "~$Question", "audit": "[$AuditLine]"})
obj("ModAppeal", {"id": "uuid", "note": "str", "status": "enum:OPEN|DECIDED", "createdAt": "time"}, "RW2: the poster's own words, shown to the moderator in the item detail.")
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
obj("AdminWeeklyReport", {"emotions": "[$Emotion]", "?regions": "[$RegionShare]", "cardTitle": "~str", "editorNote": "~str", "id": "uuid", "topicId": "uuid", "weekNumber": "int", "status": "$WeeklyReportStatus", "draftedAt": "time", "pollClosedAt": "~time", "publishAt": "~time", "headline": "~str", "mood": "~str", "summary": "~str", "themes": "json", "sentiment": "json", "pollSummary": "json",
  "quotes": "[$AdminQuote]", "basedOnVoices": "int", "basedOnVotes": "int", "languagesRead": "[str]", "checks": "[$ReportCheck]"})
obj("AdminQuote", {"answerId": "uuid", "excerpt": "str", "placeLabel": "str", "consent": "bool"})
obj("ReportCheck", {"text": "str", "ok": "bool"})
obj("EditWeeklyReportRequest", {"?cardTitle": "str", "?editorNote": "str", "?emotions": "[$Emotion]", "?headline": "str", "?mood": "str", "?summary": "str", "?themes": "json", "?quotes": "[$AdminQuote]"})
obj("ApproveWeeklyRequest", {"publishAt": "time"})
obj("HoldRequest", {"reason": "str"})
obj("AdminAd", {"live": "bool", "ageBands": "[str]", "checks": "[$ReportCheck]", "id": "uuid", "brand": "str", "brandId": "~uuid", "kind": "$AdKind", "status": "$AdStatus", "headline": "str", "body": "~str", "linkUrl": "~str", "ctaLabel": "~str", "imageUrl": "~str", "audioClipId": "~uuid",
  "categoryIds": "[uuid]", "states": "[str]", "startsOn": "~date", "endsOn": "~date", "frequencyCapPerDay": "int", "priceKobo": "~kobo",
  "views": "int", "taps": "int", "listens": "int", "rejectReason": "~str", "changeRequest": "~str"})
obj("AdminAdPage", {"items": "[$AdminAd]", "nextCursor": "~str", "awaitingApproval": "int"})
obj("UpsertAdRequest", {"?ageBands": "[str]", "brand": "str", "?brandId": "~uuid", "kind": "$AdKind", "headline": "str", "?body": "str", "?linkUrl": "str", "?ctaLabel": "str", "?imageFileId": "uuid", "?audioClipId": "uuid",
  "?categoryIds": "[uuid]", "?states": "[str]", "?startsOn": "date", "?endsOn": "date", "?frequencyCapPerDay": "int", "?priceKobo": "kobo"})
obj("AdDecision", {"decision": "enum:APPROVE|REJECT|ASK_FOR_CHANGES|PAUSE|RESUME", "?reason": "str"})
# V-SURVEYS: sponsored surveys, brand pages
obj("SurveyQuestionInput", {"kind": "enum:SINGLE_CHOICE|TEXT|VOICE", "prompt": "str", "?options": "[str]"})
obj("UpsertSurveyRequest", {"brandName": "str", "?brandId": "uuid", "contactEmail": "str", "title": "str", "questions": "[$SurveyQuestionInput]",
  "?categoryIds": "[uuid]", "?states": "[str]", "?startsOn": "date", "?endsOn": "date", "?frequencyCapPerDay": "int", "?priceKobo": "kobo", "?responseTarget": "int"})
obj("SurveyDecision", {"decision": "enum:APPROVE|REJECT|ASK_FOR_CHANGES|PAUSE|RESUME", "?reason": "str"})
obj("SurveyOptionView", {"id": "uuid", "label": "str"})
obj("SurveyQuestionView", {"id": "uuid", "position": "int", "kind": "enum:SINGLE_CHOICE|TEXT|VOICE", "prompt": "str", "options": "[$SurveyOptionView]"})
obj("AdminSurvey", {"id": "uuid", "brandId": "~uuid", "brandName": "str", "contactEmail": "str", "title": "str", "status": "$AdStatus", "label": "str",
  "live": "bool", "checks": "[$ReportCheck]", "questions": "[$SurveyQuestionView]", "categoryIds": "[uuid]", "states": "[str]", "startsOn": "~date", "endsOn": "~date",
  "frequencyCapPerDay": "int", "priceKobo": "~kobo", "responseTarget": "~int", "views": "int", "starts": "int", "completes": "int", "skips": "int", "responses": "int",
  "rejectReason": "~str", "changeRequest": "~str", "submittedAt": "~time", "approvedAt": "~time", "snapshotAt": "~time", "releasedAt": "~time"})
obj("AdminSurveyPage", {"items": "[$AdminSurvey]", "nextCursor": "~str", "awaitingApproval": "int"})
obj("SurveyReportOption", {"id": "uuid", "label": "str", "count": "~int", "share": "~int", "hidden": "bool"})
obj("SurveyReportOther", {"label": "str", "count": "int", "share": "int"},
  "The choices that are hidden, together. Present only when their sum is at least weekly.min_group_size. Every choice under twice that size is folded into this line, and only when no folded choice can be worked out; otherwise the question has no breakdown at all and answered is null.")
obj("SurveyBreakdownOther", {"responses": "int", "share": "int"})
obj("SurveyReportVoice", {"transcript": "str", "seconds": "int"})
obj("SurveyReportQuestion", {"id": "uuid", "position": "int", "kind": "enum:SINGLE_CHOICE|TEXT|VOICE", "prompt": "str", "answered": "~int",
  "options": "[$SurveyReportOption]", "other": "~$SurveyReportOther", "texts": "[str]", "voices": "[$SurveyReportVoice]"})
obj("SurveyReportTotals", {"views": "~int", "starts": "~int", "skips": "~int", "responses": "~int", "completionRate": "~int"},
  "Each count about people is null while it is under weekly.min_group_size (not enough yet). starts, and so completionRate, is also null when starts and responses differ by a number under that size.")
obj("SurveyReportState", {"state": "str", "responses": "int", "share": "int"})
obj("SurveyReportAge", {"ageBand": "str", "responses": "int", "share": "int"})
obj("SurveyReportHead", {"id": "uuid", "brandName": "str", "title": "str", "status": "$AdStatus", "startsOn": "~date", "endsOn": "~date", "responseTarget": "~int"})
obj("SurveyReport", {"survey": "$SurveyReportHead", "stage": "enum:NOT_LIVE|RUNNING|REVIEW|RELEASED", "ready": "bool", "released": "bool",
  "?answeredSoFar": "int", "?releasedAt": "time", "?minGroupSize": "int", "?belowMinimum": "bool", "?totals": "$SurveyReportTotals",
  "?questions": "[$SurveyReportQuestion]", "?byState": "[$SurveyReportState]", "?byStateOther": "~$SurveyBreakdownOther", "?byAgeBand": "[$SurveyReportAge]",
  "?byAgeBandOther": "~$SurveyBreakdownOther", "note": "str"},
  "While the survey runs (and until staff release it) only stage, ready, released, answeredSoFar and note are present. The counts, shares, free answers and breakdowns exist only when released is true, and are then the stored report, never recomputed.")
obj("SurveyFreeItem", {"id": "str", "questionId": "uuid", "prompt": "str", "kind": "enum:TEXT|VOICE", "text": "str", "seconds": "~int", "hidden": "bool"})
obj("SurveyFreeAnswers", {"released": "bool", "items": "[$SurveyFreeItem]", "total": "int", "hiddenCount": "int", "nextCursor": "~str"})
obj("HideFreeAnswerRequest", {"hidden": "bool"})
obj("HideFreeAnswerResult", {"id": "str", "hidden": "bool"})
obj("SurveyReleaseResult", {"released": "bool", "releasedAt": "time", "hiddenCount": "int", "mailed": "bool"})
obj("SurveyCard", {"id": "uuid", "label": "str", "brandName": "str", "brandSlug": "~str", "brandWebsite": "~str", "title": "str", "questionCount": "int"})
obj("SurveyPlacementResponse", {"survey": "~$SurveyCard"})
obj("Survey", {"id": "uuid", "label": "str", "brandName": "str", "brandSlug": "~str", "brandWebsite": "~str", "title": "str", "questionCount": "int", "note": "str",
  "myStatus": "enum:OPEN|ANSWERED", "voiceMaxSeconds": "int", "ageBands": "[str]", "questions": "[$SurveyQuestionView]"})
obj("SurveyEventRequest", {"kind": "enum:VIEW|START|SKIP"})
obj("SurveyAnswerInput", {"questionId": "uuid", "?optionId": "uuid", "?text": "str", "?clipId": "uuid"})
obj("SurveyResponseRequest", {"answers": "[$SurveyAnswerInput]", "?anonymous": "bool", "?shareState": "bool", "?ageBand": "enum:18-24|25-34|35-44|45-54|55+"})
obj("SurveyResponseResult", {"ok": "bool", "note": "str"})
obj("BrandInput", {"name": "str", "?tagline": "str", "?logoFileId": "uuid", "?website": "str", "?contactEmail": "str", "?active": "bool"})
obj("AdminBrand", {"id": "uuid", "name": "str", "slug": "str", "tagline": "~str", "website": "~str", "contactEmail": "~str", "active": "bool", "logoUrl": "~str", "label": "str"})
obj("AdminBrandList", {"items": "[$AdminBrand]"})
obj("BrandHead", {"name": "str", "slug": "str", "tagline": "~str", "website": "~str", "logoUrl": "~str", "label": "str"})
obj("BrandSurveyCard", {"id": "uuid", "title": "str", "label": "str", "questionCount": "int", "endsOn": "~date"})
obj("BrandAdCard", {"id": "uuid", "kind": "$AdKind", "label": "enum:Ad|Sponsored", "headline": "str", "body": "~str", "imageUrl": "~str", "linkUrl": "~str", "ctaLabel": "~str"})
obj("BrandPage", {"brand": "$BrandHead", "surveys": "[$BrandSurveyCard]", "ads": "[$BrandAdCard]"})
obj("ConfigEntry", {"key": "str", "value": "json", "description": "~str", "placeholder": "bool", "version": "int", "updatedAt": "time", "updatedBy": "~str"})
obj("ConfigList", {"items": "[$ConfigEntry]"})
obj("UpdateConfigRequest", {"value": "json", "reason": "str"})
obj("ConfigChange", {"id": "uuid", "key": "str", "oldValue": "json", "newValue": "json", "reason": "str", "by": "str", "createdAt": "time", "rollbackOfId": "~uuid"})
obj("ConfigChangePage", {"items": "[$ConfigChange]", "nextCursor": "~str"})
obj("AdjustWalletRequest", {"deltaMilli": "adjmilli", "reason": "str"})
obj("PaymentPerson", {"id": "uuid", "handle": "str"})
obj("AdminPayment", {**S["Payment"]["_fields"], "user": "$PaymentPerson", "overpaidKobo": "int", "refundNeeded": "bool"},
  "V-ADMIN-MONEY: a payment as the admin sees it: the person, the price, VAT, charge and total it was started with (null on a payment made before the customer paid charges), and what was paid over the total (V-23), to refund by hand.")
obj("WalletAdjustment", {"auditId": "uuid", "txnId": "uuid", "deltaMilli": "adjmilli", "balanceMilli": "milli"},
  "What an adjust call did: the audit entry and the ledger transaction it wrote, and the balance after.")
obj("AdminWallet", {"user": "$Profile", "status": "$AccountStatus", "balanceMilli": "milli", "freePostsRemaining": "int", "ledger": "[$LedgerItem]", "payments": "[$AdminPayment]", "nextCursor": "~str", "?adjustment": "$WalletAdjustment"})
obj("AdminPaymentPage", {"items": "[$AdminPayment]", "nextCursor": "~str"})
obj("MoneySlice", {"count": "int", "priceKobo": "int", "vatKobo": "int", "chargeKobo": "int", "totalKobo": "int"},
  "Paid payments, summed by the database from the payment rows' own amounts. priceKobo is WAWU's own revenue; VAT and the payment charge are paid by the customer on top and shown apart; totalKobo is what the customer paid.")
obj("MoneyReceived", {"packs": "$MoneySlice", "subscriptions": "$MoneySlice", "other": "$MoneySlice", "total": "$MoneySlice"})
obj("MoneyPaymentCounts", {"paid": "int", "failed": "int", "pending": "int", "expired": "int", "refunded": "int"},
  "paid: confirmed in the window. The others: started in the window and in that state now. pending is initiated plus pending.")
obj("MoneyTokens", {"soldMilli": "int", "fromPlansMilli": "int", "spentMilli": "int", "reversedMilli": "int", "adjustedInMilli": "int", "adjustedOutMilli": "int", "otherMilli": "int", "netSpentMilli": "int", "walletChangeMilli": "int"},
  "Wallet movements in the window from the ledger entries: bought in packs, credited from plans, spent, spends reversed, admin adjustments up and down, anything else, spent net of reversals, and the net change of all wallets.")
obj("MoneyWindow", {"label": "str", "fromDay": "date", "toDay": "date", "from": "time", "to": "time", "received": "$MoneyReceived", "overpaidKobo": "int", "payments": "$MoneyPaymentCounts", "newPayers": "int", "tokens": "$MoneyTokens"},
  "A window of whole Lagos days from fromDay's start to now. newPayers: people whose first confirmed payment ever is in the window.")
obj("MoneyWindows", {"today": "$MoneyWindow", "last7": "$MoneyWindow", "last30": "$MoneyWindow"})
obj("MoneyOverview", {"asOf": "time", "lagosDay": "date", "tokensHeldMilli": "int", "windows": "$MoneyWindows"},
  "V-ADMIN-MONEY: every figure comes from the payment and ledger tables; a screen adds nothing up.")
obj("AdminSubscriptionPerson", {"id": "uuid", "handle": "str", "displayName": "~str"})
obj("AdminSubscriptionPlan", {"slug": "str", "name": "str"})
obj("AdminSubscription", {"id": "uuid", "user": "$AdminSubscriptionPerson", "plan": "$AdminSubscriptionPlan", "status": "$SubscriptionStatus", "startDay": "date", "endDay": "date",
  "months": "int", "creditedMonths": "int", "monthlyMilli": "milli", "priceKobo": "kobo", "nextCreditDay": "~date", "paymentId": "uuid", "createdAt": "time"})
obj("AdminSubscriptionPage", {"items": "[$AdminSubscription]", "counts": "json", "nextCursor": "~str"},
  "counts: the number of plans in each status, whatever the page or filter.")
obj("VerificationState", {"state": "enum:NOT_SUBSCRIBED|READY|UNDER_REVIEW|VERIFIED|REJECTED|EXPIRED|LAPSED", "verified": "bool", "verifiedUntil": "~time",
  "subscription": "~$VerificationPlan", "canUpload": "bool", "canSubmit": "bool", "documents": "$VerificationDocuments", "request": "~$VerificationRequestView", "lastDecision": "~$VerificationLastDecision"},
  "V-46. canUpload is true with a running subscription unless the person is verified or under review. documents says which of the two files are in the draft (the files themselves are never returned).")
obj("VerificationPlan", {"planName": "str", "endDay": "str", "endLabel": "str"}, "endDay is the Lagos day the plan ends, YYYY-MM-DD; endLabel is the same day as 14 Feb 2027.")
obj("VerificationDocuments", {"id": "bool", "bill": "bool"})
obj("VerificationRequestView", {"id": "uuid", "status": "enum:DRAFT|PENDING|APPROVED|REJECTED|EXPIRED", "submittedAt": "~time", "decidedAt": "~time", "reason": "~str"}, "reason is set for a rejection: plain words, the admin's reason.")
obj("VerificationLastDecision", {"outcome": "enum:APPROVED|REJECTED", "decidedAt": "~time"})
obj("AdminVerificationPerson", {"id": "uuid", "handle": "str", "displayName": "~str"})
obj("AdminVerificationItem", {"id": "uuid", "status": "enum:PENDING|APPROVED|REJECTED", "submittedAt": "~time", "decidedAt": "~time", "person": "$AdminVerificationPerson",
  "subscription": "~$VerificationPlan", "decidedBy": "~str", "reason": "~str", "documentsDeleted": "bool"})
obj("AdminVerificationPage", {"items": "[$AdminVerificationItem]", "nextCursor": "~str"})
obj("VerificationDocumentLink", {"url": "str", "mime": "str", "expiresAt": "time"}, "A signed link that stops working at expiresAt (5 minutes after it was given). Never log it, never store it.")
obj("AdminVerification", {"id": "uuid", "status": "enum:PENDING|APPROVED|REJECTED", "submittedAt": "~time", "decidedAt": "~time", "person": "$AdminVerificationPerson",
  "subscription": "~$VerificationPlan", "reason": "~str", "documentsDeleted": "bool", "idDocument": "~$VerificationDocumentInfo", "billDocument": "~$VerificationDocumentInfo"})
obj("VerificationDocumentInfo", {"mime": "str"}, "That the document is there and its type. Its link is made by GET /admin/verification/{requestId}/documents/{kind} when an admin opens it.")
obj("ApproveVerificationRequest", {"?note": "str"}, "note is for the audit line only; the person does not see it.")
obj("RejectVerificationRequest", {"reasonCode": "enum:ID_UNREADABLE|ID_NOT_VALID|ID_EXPIRED|BILL_UNREADABLE|BILL_TOO_OLD|DETAILS_DO_NOT_MATCH|SUBSCRIPTION_ENDED|OTHER", "?note": "str"},
  "The person reads the short words for the code, then the note. OTHER needs a note (at most 500 characters).")
obj("AdminVerificationDecision", {"id": "uuid", "status": "enum:APPROVED|REJECTED", "?verifiedUntil": "time"})
obj("AdminUserPage", {"items": "[$AdminUserRow]", "nextCursor": "~str", "total": "int", "counts": "$AdminUserCounts"},
  "total is how many people match the current search and status, ignoring the cursor. counts is the whole user table, whatever the search.")
obj("AdminUserRow", {"profile": "$Profile", "status": "$AccountStatus", "roles": "[$Role]", "strikes": "int", "createdAt": "time",
  "mailTo": "~str", "displayName": "~str", "state": "~str", "verified": "bool", "postCount": "int", "hasProfile": "bool"},
  "An AdminUser plus what the Users screen shows. mailTo is the notification address; only this list returns it, and only to an admin. postCount is answers plus replies not deleted. hasProfile is false while the person has no display name, bio or photo. There is no last-seen field: the User model has none.")
obj("AdminUserCounts", {"total": "int", "today": "int", "verified": "int", "byStatus": "$AdminUserStatusCounts"},
  "total is everyone registered. today is those who joined since midnight in Lagos. verified is those verified right now.")
obj("AdminUserStatusCounts", {"ACTIVE": "int", "SUSPENDED": "int", "BANNED": "int", "DELETION_PENDING": "int", "DELETED": "int"})
obj("AdminUser", {"profile": "$Profile", "status": "$AccountStatus", "roles": "[$Role]", "strikes": "int", "createdAt": "time"})
obj("SuspendRequest", {"until": "~time", "reason": "str", "ban": "bool"})
obj("ConfirmGroupRequest", {"title": "str", "proposalIds": "[uuid]"})
obj("SummaryEditRequest", {"mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str", "approve": "bool", "?aiDrafted": "bool"})
obj("SavedSummary", {"topicId": "uuid", "mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str", "basedOnVoices": "int", "basedOnVotes": "int", "updatedAt": "time", "reviewedByEditor": "bool", "aiDrafted": "bool"})
obj("AdminSummary", {"aiAvailable": "bool", "summary": "~$SavedSummary"}, "The saved summary (reviewed or not) and whether the AI draft is switched on here (a GEMINI_API_KEY is set).")
obj("DraftSummaryRequest", {"?ai": "bool"})
obj("SummaryDraftFields", {"mainView": "str", "mainViewVoices": "int", "opposingView": "str", "opposingViewVoices": "int", "pollLine": "str", "nextStepsLine": "str"})
obj("SummaryDraftMood", {"mood": "$Mood", "count": "int", "percent": "int"})
obj("SummaryDraftCategory", {"name": "str", "voices": "int"})
obj("SummaryDraftQuote", {"answerId": "uuid", "kind": "$PostKind", "reactions": "int", "excerpt": "str"})
obj("SummaryDraft", {"topicId": "uuid", "source": "enum:DATA|AI", "aiAvailable": "bool", "aiNote": "~str", "draft": "$SummaryDraftFields", "basedOnVoices": "int", "basedOnVotes": "int", "moods": "[$SummaryDraftMood]", "categories": "[$SummaryDraftCategory]", "quotes": "[$SummaryDraftQuote]"},
  "Nothing is saved. The data draft needs no AI: the weekly poll's two leading choices as the two positions, the poll line and the next-steps line counted from the poll and the proposals, plus mood counts, the busiest categories and the most-reacted voices as material. An empty mainView or opposingView means the data had nothing to put there and the editor writes it.")
obj("AdminProposalQuestion", {"questionId": "uuid", "text": "str", "weekNumber": "~int", "proposalCount": "int", "groupCount": "int", "ungroupedCount": "int"})
obj("AdminProposalQuestions", {"items": "[$AdminProposalQuestion]"})
obj("AdminProposalItem", {"id": "uuid", "kind": "$PostKind", "text": "str", "supportCount": "int", "challengeCount": "int", "groupId": "~uuid", "groupTitle": "~str", "createdAt": "time"})
obj("AdminProposalGroup", {"id": "uuid", "title": "str", "confirmed": "bool", "proposalCount": "int"})
obj("AdminGroupSuggestion", {"title": "str", "proposalIds": "[uuid]"})
obj("AdminProposalQuestionRef", {"id": "uuid", "text": "str"})
obj("AdminGroupRemoved", {"id": "uuid", "released": "int"})
obj("AdminProposals", {"question": "$AdminProposalQuestionRef", "items": "[$AdminProposalItem]", "groups": "[$AdminProposalGroup]", "suggestions": "[$AdminGroupSuggestion]"},
  "A question's published proposals (up to 300, best supported first) with its groups. A suggestion is proposals with words in common; nothing is grouped until a moderator confirms it with POST /admin/proposal-groups.")
obj("AuditPage", {"items": "[$AuditEntry]", "nextCursor": "~str"})
obj("AuditEntry", {"id": "uuid", "at": "time", "actor": "~str", "action": "str", "targetType": "str", "targetId": "~str", "reason": "~str", "before": "json", "after": "json"})

obj("TextFixRequest", {"text": "str"}, "The person's own text, 1 to 2,500 characters (counted as Unicode characters, an emoji is one).")
obj("TextFixChange", {"from": "str", "to": "str", "start": "int"}, "One change: the words that were there, the words that replace them, and where `from` starts in the original text, in characters.")
obj("TextFixCharge", {"costMilli": "milli", "balanceMilli": "milli"})
obj("TextFixResult", {"fixedText": "str", "changes": "[$TextFixChange]", "changed": "bool", "charge": "$TextFixCharge"},
  "The corrected text and the changes, for the person to use or keep their own. changed is false (and nothing is charged) when there was nothing to fix.")

# ---- V-DM: direct messages
obj("DmPerson", {"id": "uuid", "handle": "str", "displayName": "~str", "?avatarUrl": "~str", "?admin": "bool", "place": "~str", "verified": "bool", "deleted": "bool"})
obj("DmClip", {"id": "uuid", "durationMs": "~int", "peaks": "~[int]", "transcript": "~str"}, "Play it with GET /voice-clips/{id}/play: only the two people in the conversation may.")
obj("DmMessage", {"id": "uuid", "conversationId": "uuid", "senderId": "uuid", "mine": "bool", "kind": "$PostKind", "body": "~str", "clip": "~$DmClip", "status": "$ContentStatus",
  "?costMilli": "milli", "readAt": "~time", "createdAt": "time"},
  "A removed message (status REMOVED or DELETED_BY_AUTHOR) has no body and no clip. costMilli is only on my own messages, readAt only on my own and says when the other person opened it.")
obj("SendDmRequest", {"toUserId": "uuid", "kind": "$PostKind", "?body": "str", "?clipId": "uuid"},
  "A TEXT message has body (1 to 5,000 characters) and no clipId. A VOICE message has clipId (a READY clip made with purpose DM, at most dm.voice_max_seconds, 60 by default) and no body.")
obj("DmCharge", {"costMilli": "milli", "balanceMilli": "milli"})
obj("DmSendReceipt", {"message": "$DmMessage", "charge": "$DmCharge"})
obj("DmLastMessage", {"id": "uuid", "kind": "$PostKind", "preview": "str", "mine": "bool", "createdAt": "time"})
obj("DmConversation", {"id": "uuid", "person": "$DmPerson", "lastMessage": "~$DmLastMessage", "unread": "int", "muted": "bool", "acceptsMessages": "bool", "updatedAt": "time"})
obj("DmMessagePage", {"person": "$DmPerson", "muted": "bool", "acceptsMessages": "bool", "items": "[$DmMessage]", "nextCursor": "~str"})
obj("DmWith", {"person": "$DmPerson", "conversationId": "~uuid", "acceptsMessages": "bool"},
  "acceptsMessages is false when the person turned messages off, is suspended, or either of us blocked the other.")
obj("DmLimits", {"textPriceMilli": "milli", "textPriceChars": "int", "voicePriceMilli": "milli", "voiceMaxSeconds": "int", "maxChars": "int", "messagesPerDay": "int", "messagesLeftToday": "int", "balanceMilli": "milli"},
  "What a direct message costs now, from config. 0 is free (the owner's design says messages are free). textPriceMilli is per textPriceChars characters, in proportion; voicePriceMilli is for one voice message of any length up to voiceMaxSeconds.")
