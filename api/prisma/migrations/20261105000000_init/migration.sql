-- V-SHARED-0 init: generated from docs/contract/schema.prisma (prisma migrate diff), then the hand-written part below.
-- Needs a role that may CREATE EXTENSION pg_trgm (trusted since PG13: the database owner).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VoicesRole" AS ENUM ('MODERATOR', 'EDITOR', 'AD_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETION_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('PUBLISHED', 'HELD', 'REMOVED', 'DELETED_BY_AUTHOR');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('DAILY', 'FLASH', 'FOLLOW_UP', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'LIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "PollKind" AS ENUM ('WEEKLY', 'FLASH', 'QUESTION');

-- CreateEnum
CREATE TYPE "PollChoiceMode" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "NewsTag" AS ENUM ('VERIFIED_NEWS', 'UNVERIFIED_NEWS', 'GOSSIP');

-- CreateEnum
CREATE TYPE "NewsReviewStatus" AS ENUM ('NONE', 'FLAGGED', 'VERIFIED_REQUESTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReplyStance" AS ENUM ('AGREE', 'DISAGREE', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('POWERFUL', 'WILD', 'RELATABLE', 'FUNNY', 'SURPRISING', 'SAD', 'WELL_SAID', 'THOUGHT_PROVOKING', 'EXACTLY', 'DISAGREE');

-- CreateEnum
CREATE TYPE "ProposalStanceKind" AS ENUM ('SUPPORT', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "VoiceClipPurpose" AS ENUM ('ANSWER', 'REPLY', 'PROPOSAL', 'VOTE_EXPLANATION', 'VOICE_CARD', 'OVERRIDE_NOTE', 'AD_AUDIO');

-- CreateEnum
CREATE TYPE "VoiceClipStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('AVATAR', 'RESULT_PHOTO', 'OVERRIDE_IMAGE', 'AD_CREATIVE', 'SHARE_CARD', 'DATA_EXPORT');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('ANSWER', 'REPLY', 'PROPOSAL', 'RESULT_POST', 'USER');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('HATE_OR_HARASSMENT', 'THREAT_OR_VIOLENCE', 'SCAM_OR_SPAM', 'PERSONAL_DETAILS', 'MISLEADING_NEWS_TAG', 'ABOUT_ME', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationQueue" AS ENUM ('REPORTED', 'SCREENED', 'SENSITIVE', 'PRIORITY', 'APPEAL');

-- CreateEnum
CREATE TYPE "ModerationItemStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ModerationActionKind" AS ENUM ('KEEP', 'REMOVE', 'WARN', 'REMOVE_AND_WARN', 'SUSPEND', 'BAN', 'RESTORE');

-- CreateEnum
CREATE TYPE "ResultPostStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ResultThreadStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WeeklyReportStatus" AS ENUM ('DRAFT', 'HELD', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DAILY_QUESTION', 'REPLY', 'REACTIONS', 'POLL_CLOSED', 'FLASH_POLL', 'CATEGORY_ALERT', 'TAG_FOLLOW', 'TAG_CHANGED', 'UNITS_ADDED', 'EXTRA_VOICE_ADDED', 'RESULT_CHECKED', 'WEEKLY_REPORT', 'OVERRIDE_ALERT', 'MODERATION_NOTICE');

-- CreateEnum
CREATE TYPE "ShareObjectType" AS ENUM ('QUESTION', 'ANSWER', 'POLL_RESULT', 'WEEKLY_REPORT', 'PROFILE', 'CATEGORY', 'RESULT_THREAD', 'WHAT_NEXT_SUMMARY');

-- CreateEnum
CREATE TYPE "ShareCardStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'FALLBACK');

-- CreateEnum
CREATE TYPE "ShareTarget" AS ENUM ('WHATSAPP', 'WHATSAPP_STATUS', 'INSTAGRAM_STORIES', 'FACEBOOK', 'X', 'TIKTOK', 'TELEGRAM', 'SMS', 'COPY_LINK', 'SYSTEM_SHEET');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('UNITS', 'EXTRA_VOICE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ExtraVoiceTokenKind" AS ENUM ('SECONDS_30', 'SECONDS_60');

-- CreateEnum
CREATE TYPE "ExtraVoiceTokenStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'USED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('USER_WALLET', 'PURCHASES', 'SPEND', 'BONUS', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerTxnKind" AS ENUM ('PURCHASE', 'SPEND_POST', 'SPEND_REACTION', 'SPEND_VOTE', 'REVERSAL', 'ADJUSTMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "ChargeAction" AS ENUM ('POST_TEXT', 'POST_VOICE', 'REACTION', 'VOTE');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('COMMITTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AdKind" AS ENUM ('FEED_CARD', 'BANNER', 'AUDIO_SLOT', 'WALLET_OFFER');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'PAUSED');

-- CreateEnum
CREATE TYPE "AdEventKind" AS ENUM ('IMPRESSION', 'TAP', 'LISTEN');

-- CreateEnum
CREATE TYPE "OverrideContentKind" AS ENUM ('TEXT', 'VOICE', 'IMAGE', 'LINK');

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "wawuId" TEXT NOT NULL,
    "phoneHash" TEXT,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarFileId" TEXT,
    "voiceCardClipId" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'NG',
    "state" TEXT,
    "city" TEXT,
    "languages" TEXT[],
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendedUntil" TIMESTAMP(3),
    "ageConfirmedAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "rulesAcceptedAt" TIMESTAMP(3),
    "referralCode" TEXT NOT NULL,
    "referredByUserId" TEXT,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "reactionsReceived" INTEGER NOT NULL DEFAULT 0,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "deletionRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "VoicesRole" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "dataSaver" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "notifyDailyQuestion" BOOLEAN NOT NULL DEFAULT true,
    "notifyReplies" BOOLEAN NOT NULL DEFAULT true,
    "notifyReactions" BOOLEAN NOT NULL DEFAULT true,
    "notifyPollResults" BOOLEAN NOT NULL DEFAULT true,
    "notifyFlashPolls" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategoryAlerts" BOOLEAN NOT NULL DEFAULT true,
    "dailyQuestionMinute" INTEGER NOT NULL DEFAULT 480,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "shareLinkCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCategory" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCategory_pkey" PRIMARY KEY ("userId","categoryId")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "blurb" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'NG',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'DRAFT',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "whatNextPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "topicId" TEXT,
    "categoryId" TEXT,
    "kind" "QuestionKind" NOT NULL DEFAULT 'DAILY',
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "text" TEXT NOT NULL,
    "hint" TEXT,
    "scheduledFor" DATE,
    "slotIndex" INTEGER,
    "isSpare" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "answerCount" INTEGER NOT NULL DEFAULT 0,
    "voiceCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Override" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "replacedQuestionId" TEXT,
    "contentKind" "OverrideContentKind" NOT NULL,
    "body" TEXT,
    "voiceClipId" TEXT,
    "imageFileId" TEXT,
    "linkUrl" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "OverrideStatus" NOT NULL DEFAULT 'SCHEDULED',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "notifyAlert" BOOLEAN NOT NULL DEFAULT false,
    "keepWeeklyTheme" BOOLEAN NOT NULL DEFAULT true,
    "dropReplaced" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceClip" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" "VoiceClipPurpose" NOT NULL,
    "status" "VoiceClipStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "rawKey" TEXT NOT NULL,
    "rawMime" TEXT NOT NULL,
    "rawBytes" INTEGER,
    "playKey" TEXT,
    "playMime" TEXT,
    "durationMs" INTEGER,
    "maxDurationMs" INTEGER NOT NULL,
    "extraTokenId" TEXT,
    "peaks" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "VoiceClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "language" TEXT,
    "text" TEXT,
    "screening" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "PostKind" NOT NULL,
    "body" TEXT,
    "clipId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "isNews" BOOLEAN NOT NULL DEFAULT false,
    "newsTag" "NewsTag",
    "newsSourceName" TEXT,
    "newsSourceUrl" TEXT,
    "newsReviewStatus" "NewsReviewStatus" NOT NULL DEFAULT 'NONE',
    "newsFlagCount" INTEGER NOT NULL DEFAULT 0,
    "explainsVoteId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "agreeCount" INTEGER NOT NULL DEFAULT 0,
    "disagreeCount" INTEGER NOT NULL DEFAULT 0,
    "experienceCount" INTEGER NOT NULL DEFAULT 0,
    "listenCount" INTEGER NOT NULL DEFAULT 0,
    "listenThroughCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "rankScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debateScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "screening" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "stance" "ReplyStance" NOT NULL,
    "kind" "PostKind" NOT NULL,
    "body" TEXT,
    "clipId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "screening" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Like" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Save" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Save_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "chargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "topicId" TEXT,
    "questionId" TEXT,
    "kind" "PollKind" NOT NULL,
    "title" TEXT NOT NULL,
    "choiceMode" "PollChoiceMode" NOT NULL DEFAULT 'SINGLE',
    "publicInterest" BOOLEAN NOT NULL DEFAULT false,
    "status" "PollStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "showLiveResults" BOOLEAN NOT NULL DEFAULT true,
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "chargeId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteChoice" (
    "voteId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "VoteChoice_pkey" PRIMARY KEY ("voteId","optionId")
);

-- CreateTable
CREATE TABLE "ProposalGroup" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "suggestedBy" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "groupId" TEXT,
    "improvesId" TEXT,
    "kind" "PostKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "clipId" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "supportCount" INTEGER NOT NULL DEFAULT 0,
    "challengeCount" INTEGER NOT NULL DEFAULT 0,
    "improveCount" INTEGER NOT NULL DEFAULT 0,
    "screening" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalStance" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProposalStanceKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalStance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialSummary" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "mainView" TEXT NOT NULL,
    "mainViewVoices" INTEGER NOT NULL,
    "opposingView" TEXT NOT NULL,
    "opposingViewVoices" INTEGER NOT NULL,
    "pollLine" TEXT NOT NULL,
    "nextStepsLine" TEXT NOT NULL,
    "basedOnVoices" INTEGER NOT NULL,
    "basedOnVotes" INTEGER NOT NULL,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT true,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "heldOn" DATE NOT NULL,
    "status" "ResultThreadStatus" NOT NULL DEFAULT 'SCHEDULED',
    "topicId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultPost" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "pollingUnit" TEXT NOT NULL,
    "accredited" INTEGER NOT NULL,
    "votesCast" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "photoFileId" TEXT,
    "status" "ResultPostStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "checkNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagChange" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "fromTag" "NewsTag",
    "toTag" "NewsTag" NOT NULL,
    "byUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsVerificationRequest" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidenceFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsTagFollow" (
    "userId" TEXT NOT NULL,
    "tag" "NewsTag" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsTagFollow_pkey" PRIMARY KEY ("userId","tag")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "alsoBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationItem" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "queue" "ModerationQueue" NOT NULL,
    "status" "ModerationItemStatus" NOT NULL DEFAULT 'OPEN',
    "reasons" TEXT[],
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ModerationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" "ModerationActionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "itemId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "paymentId" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "status" "WeeklyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" TEXT,
    "mood" TEXT,
    "summary" TEXT,
    "themes" JSONB,
    "sentiment" JSONB,
    "pollSummary" JSONB,
    "regionBreakdown" JSONB,
    "basedOnVoices" INTEGER,
    "basedOnVotes" INTEGER,
    "languagesRead" TEXT[],
    "aiAssisted" BOOLEAN NOT NULL DEFAULT true,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "emotions" JSONB,
    "cardTitle" TEXT,
    "editorNote" TEXT,
    "draftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "heldNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyQuote" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "placeLabel" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "groupKey" TEXT,
    "actorCount" INTEGER NOT NULL DEFAULT 1,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "objectType" "ShareObjectType" NOT NULL,
    "objectId" TEXT NOT NULL,
    "sharerId" TEXT,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareCard" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "ShareCardStatus" NOT NULL DEFAULT 'PENDING',
    "topicLine" TEXT NOT NULL,
    "argumentChips" TEXT[],
    "leanLine" TEXT,
    "basedOnVoices" INTEGER,
    "summaryUpdatedAt" TIMESTAMP(3),
    "newsTag" "NewsTag",
    "storyFileId" TEXT,
    "squareFileId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "ShareCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" "ShareTarget",
    "userId" TEXT,
    "guestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeAllowance" (
    "userId" TEXT NOT NULL,
    "freePostsRemaining" INTEGER NOT NULL DEFAULT 10,
    "freePostsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeAllowance_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "action" "ChargeAction" NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("userId","day","action")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "userId" TEXT NOT NULL,
    "balanceMilli" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ChargeAction" NOT NULL,
    "costMilli" INTEGER NOT NULL,
    "usedFreePost" BOOLEAN NOT NULL DEFAULT false,
    "usedFreeDaily" BOOLEAN NOT NULL DEFAULT false,
    "status" "ChargeStatus" NOT NULL DEFAULT 'COMMITTED',
    "refType" TEXT,
    "refId" TEXT,
    "spendTxnId" TEXT,
    "reversalTxnId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "kind" "LedgerTxnKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "paymentId" TEXT,
    "chargeId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "walletUserId" TEXT,
    "deltaMilli" INTEGER NOT NULL,
    "balanceAfterMilli" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "tierId" TEXT,
    "tokenKind" "ExtraVoiceTokenKind",
    "amountKobo" INTEGER NOT NULL,
    "unitsMilli" INTEGER,
    "bonusMilli" INTEGER,
    "txRef" TEXT NOT NULL,
    "providerTxId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "method" TEXT,
    "cardLast4" TEXT,
    "receiptNo" TEXT,
    "failureReason" TEXT,
    "rawVerify" JSONB,
    "webhookSeenAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitTier" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "unitsMilli" INTEGER NOT NULL,
    "bonusMilli" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraVoiceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" "ExtraVoiceTokenKind" NOT NULL,
    "maxSeconds" INTEGER NOT NULL,
    "status" "ExtraVoiceTokenStatus" NOT NULL DEFAULT 'AVAILABLE',
    "usedOnClipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ExtraVoiceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigEntry" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "description" TEXT,
    "placeholder" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigEntry_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ConfigChange" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "rollbackOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "kind" "AdKind" NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "ctaLabel" TEXT,
    "imageFileId" TEXT,
    "audioClipId" TEXT,
    "categoryIds" TEXT[],
    "states" TEXT[],
    "startsOn" DATE,
    "endsOn" DATE,
    "frequencyCapPerDay" INTEGER NOT NULL DEFAULT 3,
    "ageBands" TEXT[],
    "priceKobo" INTEGER,
    "rejectReason" TEXT,
    "changeRequest" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdEvent" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "kind" "AdEventKind" NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" "FileKind" NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "sessionId" TEXT,
    "props" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wawuId_key" ON "User"("wawuId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "User_voiceCardClipId_key" ON "User"("voiceCardClipId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleGrant_userId_role_key" ON "UserRoleGrant"("userId", "role");

-- CreateIndex
CREATE INDEX "Device_fingerprint_idx" ON "Device"("fingerprint");

-- CreateIndex
CREATE INDEX "Device_guestId_idx" ON "Device"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredId_key" ON "Referral"("referredId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "Strike_actionId_key" ON "Strike"("actionId");

-- CreateIndex
CREATE INDEX "Strike_userId_idx" ON "Strike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_weekNumber_key" ON "Topic"("weekNumber");

-- CreateIndex
CREATE INDEX "Topic_startsOn_idx" ON "Topic"("startsOn");

-- CreateIndex
CREATE INDEX "Topic_status_idx" ON "Topic"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Question_seedKey_key" ON "Question"("seedKey");

-- CreateIndex
CREATE INDEX "Question_topicId_slotIndex_idx" ON "Question"("topicId", "slotIndex");

-- CreateIndex
CREATE INDEX "Question_scheduledFor_idx" ON "Question"("scheduledFor");

-- CreateIndex
CREATE INDEX "Question_status_kind_idx" ON "Question"("status", "kind");

-- CreateIndex
CREATE INDEX "Question_categoryId_status_idx" ON "Question"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Override_questionId_key" ON "Override"("questionId");

-- CreateIndex
CREATE INDEX "Override_status_startsAt_idx" ON "Override"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceClip_extraTokenId_key" ON "VoiceClip"("extraTokenId");

-- CreateIndex
CREATE INDEX "VoiceClip_ownerId_status_idx" ON "VoiceClip"("ownerId", "status");

-- CreateIndex
CREATE INDEX "VoiceClip_status_createdAt_idx" ON "VoiceClip"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_clipId_key" ON "Transcript"("clipId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_clipId_key" ON "Answer"("clipId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_explainsVoteId_key" ON "Answer"("explainsVoteId");

-- CreateIndex
CREATE INDEX "Answer_questionId_status_createdAt_idx" ON "Answer"("questionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_questionId_status_rankScore_idx" ON "Answer"("questionId", "status", "rankScore");

-- CreateIndex
CREATE INDEX "Answer_authorId_createdAt_idx" ON "Answer"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_isNews_newsTag_createdAt_idx" ON "Answer"("isNews", "newsTag", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_newsReviewStatus_idx" ON "Answer"("newsReviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Reply_clipId_key" ON "Reply"("clipId");

-- CreateIndex
CREATE INDEX "Reply_answerId_status_createdAt_idx" ON "Reply"("answerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Reply_authorId_createdAt_idx" ON "Reply"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Like_userId_idx" ON "Like"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Like_answerId_userId_key" ON "Like"("answerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Like_answerId_guestId_key" ON "Like"("answerId", "guestId");

-- CreateIndex
CREATE INDEX "Save_userId_createdAt_idx" ON "Save"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Save_userId_answerId_key" ON "Save"("userId", "answerId");

-- CreateIndex
CREATE INDEX "SavedQuestion_userId_createdAt_idx" ON "SavedQuestion"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedQuestion_userId_questionId_key" ON "SavedQuestion"("userId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_chargeId_key" ON "Reaction"("chargeId");

-- CreateIndex
CREATE INDEX "Reaction_userId_createdAt_idx" ON "Reaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_answerId_userId_key" ON "Reaction"("answerId", "userId");

-- CreateIndex
CREATE INDEX "Poll_topicId_kind_idx" ON "Poll"("topicId", "kind");

-- CreateIndex
CREATE INDEX "Poll_questionId_idx" ON "Poll"("questionId");

-- CreateIndex
CREATE INDEX "Poll_status_endsAt_idx" ON "Poll"("status", "endsAt");

-- CreateIndex
CREATE INDEX "PollOption_pollId_idx" ON "PollOption"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollOption_pollId_sortOrder_key" ON "PollOption"("pollId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_chargeId_key" ON "Vote"("chargeId");

-- CreateIndex
CREATE INDEX "Vote_pollId_createdAt_idx" ON "Vote"("pollId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_pollId_userId_key" ON "Vote"("pollId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_pollId_phoneHash_key" ON "Vote"("pollId", "phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_userId_idempotencyKey_key" ON "Vote"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VoteChoice_optionId_idx" ON "VoteChoice"("optionId");

-- CreateIndex
CREATE INDEX "ProposalGroup_questionId_idx" ON "ProposalGroup"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_clipId_key" ON "Proposal"("clipId");

-- CreateIndex
CREATE INDEX "Proposal_questionId_status_supportCount_idx" ON "Proposal"("questionId", "status", "supportCount");

-- CreateIndex
CREATE INDEX "Proposal_groupId_idx" ON "Proposal"("groupId");

-- CreateIndex
CREATE INDEX "ProposalStance_userId_idx" ON "ProposalStance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalStance_proposalId_userId_key" ON "ProposalStance"("proposalId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialSummary_topicId_key" ON "EditorialSummary"("topicId");

-- CreateIndex
CREATE INDEX "ResultThread_status_heldOn_idx" ON "ResultThread"("status", "heldOn");

-- CreateIndex
CREATE INDEX "ResultPost_threadId_status_createdAt_idx" ON "ResultPost"("threadId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResultPost_status_createdAt_idx" ON "ResultPost"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResultPost_authorId_idempotencyKey_key" ON "ResultPost"("authorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TagChange_answerId_createdAt_idx" ON "TagChange"("answerId", "createdAt");

-- CreateIndex
CREATE INDEX "NewsVerificationRequest_status_createdAt_idx" ON "NewsVerificationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Report_status_priority_createdAt_idx" ON "Report"("status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_targetType_targetId_key" ON "Report"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationItem_queue_status_priority_createdAt_idx" ON "ModerationItem"("queue", "status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationItem_targetType_targetId_queue_key" ON "ModerationItem"("targetType", "targetId", "queue");

-- CreateIndex
CREATE INDEX "ModerationAction_itemId_createdAt_idx" ON "ModerationAction"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_status_createdAt_idx" ON "Appeal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appeal_userId_targetType_targetId_key" ON "Appeal"("userId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "SupportMessage_createdAt_idx" ON "SupportMessage"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_topicId_key" ON "WeeklyReport"("topicId");

-- CreateIndex
CREATE INDEX "WeeklyReport_status_publishAt_idx" ON "WeeklyReport"("status", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyQuote_reportId_answerId_key" ON "WeeklyQuote"("reportId", "answerId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_groupKey_key" ON "Notification"("userId", "groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_code_key" ON "ShortLink"("code");

-- CreateIndex
CREATE INDEX "ShortLink_objectType_objectId_idx" ON "ShortLink"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "ShortLink_sharerId_idx" ON "ShortLink"("sharerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareCard_linkId_language_key" ON "ShareCard"("linkId", "language");

-- CreateIndex
CREATE INDEX "ShareEvent_linkId_kind_idx" ON "ShareEvent"("linkId", "kind");

-- CreateIndex
CREATE INDEX "ShareEvent_createdAt_idx" ON "ShareEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_spendTxnId_key" ON "Charge"("spendTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_reversalTxnId_key" ON "Charge"("reversalTxnId");

-- CreateIndex
CREATE INDEX "Charge_userId_createdAt_idx" ON "Charge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Charge_refType_refId_idx" ON "Charge"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_userId_idempotencyKey_key" ON "Charge"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_paymentId_key" ON "LedgerTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_chargeId_idx" ON "LedgerTransaction"("chargeId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_createdAt_idx" ON "LedgerTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_txnId_idx" ON "LedgerEntry"("txnId");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletUserId_createdAt_idx" ON "LedgerEntry"("walletUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_txRef_key" ON "Payment"("txRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTxId_key" ON "Payment"("providerTxId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UnitTier_slug_key" ON "UnitTier"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraVoiceToken_paymentId_key" ON "ExtraVoiceToken"("paymentId");

-- CreateIndex
CREATE INDEX "ExtraVoiceToken_userId_status_idx" ON "ExtraVoiceToken"("userId", "status");

-- CreateIndex
CREATE INDEX "ConfigChange_key_createdAt_idx" ON "ConfigChange"("key", "createdAt");

-- CreateIndex
CREATE INDEX "Ad_status_startsOn_endsOn_idx" ON "Ad"("status", "startsOn", "endsOn");

-- CreateIndex
CREATE INDEX "Ad_kind_status_idx" ON "Ad"("kind", "status");

-- CreateIndex
CREATE INDEX "AdEvent_adId_kind_day_idx" ON "AdEvent"("adId", "kind", "day");

-- CreateIndex
CREATE INDEX "AdEvent_adId_userId_day_idx" ON "AdEvent"("adId", "userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_kind_idx" ON "StoredFile"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorId_key_key" ON "IdempotencyRecord"("actorId", "key");

-- CreateIndex
CREATE INDEX "DataExport_userId_createdAt_idx" ON "DataExport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_createdAt_idx" ON "AnalyticsEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "UserRoleGrant" ADD CONSTRAINT "UserRoleGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strike" ADD CONSTRAINT "Strike_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ModerationAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCategory" ADD CONSTRAINT "UserCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCategory" ADD CONSTRAINT "UserCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_replacedQuestionId_fkey" FOREIGN KEY ("replacedQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_extraTokenId_fkey" FOREIGN KEY ("extraTokenId") REFERENCES "ExtraVoiceToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "VoiceClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_explainsVoteId_fkey" FOREIGN KEY ("explainsVoteId") REFERENCES "Vote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteChoice" ADD CONSTRAINT "VoteChoice_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteChoice" ADD CONSTRAINT "VoteChoice_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProposalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_improvesId_fkey" FOREIGN KEY ("improvesId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalStance" ADD CONSTRAINT "ProposalStance_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialSummary" ADD CONSTRAINT "EditorialSummary_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPost" ADD CONSTRAINT "ResultPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ResultThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPost" ADD CONSTRAINT "ResultPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagChange" ADD CONSTRAINT "TagChange_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsVerificationRequest" ADD CONSTRAINT "NewsVerificationRequest_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsTagFollow" ADD CONSTRAINT "NewsTagFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ModerationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyQuote" ADD CONSTRAINT "WeeklyQuote_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCard" ADD CONSTRAINT "ShareCard_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ShortLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareEvent" ADD CONSTRAINT "ShareEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ShortLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeAllowance" ADD CONSTRAINT "FreeAllowance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletUserId_fkey" FOREIGN KEY ("walletUserId") REFERENCES "Wallet"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "UnitTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraVoiceToken" ADD CONSTRAINT "ExtraVoiceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraVoiceToken" ADD CONSTRAINT "ExtraVoiceToken_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ====================================================================== hand-written

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Wallet balance never below zero and never above 2,000,000,000 milli-units (V-17/V-18, 32-bit Int).
ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_balanceMilli_range" CHECK ("balanceMilli" >= 0 AND "balanceMilli" <= 2000000000);

-- Ledger transactions sum to zero: checked once per transaction at COMMIT (deferred), so the entries of one
-- transaction can be inserted one by one.
CREATE FUNCTION voices_ledger_zero_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM("deltaMilli"), 0) INTO total FROM "LedgerEntry" WHERE "txnId" = NEW."txnId";
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not sum to zero (sum %)', NEW."txnId", total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "LedgerEntry_zero_sum"
  AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION voices_ledger_zero_sum();

-- Append-only tables: Vote, VoteChoice, LedgerTransaction, LedgerEntry, AuditLog, TagChange.
-- 1. DELETE is revoked from the application role on all six. UPDATE is revoked on the four no foreign key points into.
--    (The role that runs this migration is the application role: infra/provision.sh makes one role for both.)
-- 2. Vote and LedgerTransaction are parents of foreign keys. Postgres checks those keys with SELECT ... FOR KEY SHARE,
--    which needs the UPDATE privilege, so UPDATE cannot be revoked there. A trigger refuses UPDATE on them instead.
--    The same trigger sits on all six, so even a superuser cannot change a row without dropping it first.
REVOKE DELETE ON "Vote", "VoteChoice", "LedgerTransaction", "LedgerEntry", "AuditLog", "TagChange" FROM PUBLIC, CURRENT_USER;
REVOKE UPDATE ON "VoteChoice", "LedgerEntry", "AuditLog", "TagChange" FROM PUBLIC, CURRENT_USER;

CREATE FUNCTION voices_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "Vote_append_only" BEFORE UPDATE OR DELETE ON "Vote" FOR EACH ROW EXECUTE FUNCTION voices_append_only();
CREATE TRIGGER "VoteChoice_append_only" BEFORE UPDATE OR DELETE ON "VoteChoice" FOR EACH ROW EXECUTE FUNCTION voices_append_only();
CREATE TRIGGER "LedgerTransaction_append_only" BEFORE UPDATE OR DELETE ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION voices_append_only();
CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION voices_append_only();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION voices_append_only();
CREATE TRIGGER "TagChange_append_only" BEFORE UPDATE OR DELETE ON "TagChange" FOR EACH ROW EXECUTE FUNCTION voices_append_only();

-- Search: tsvector columns kept by the database, GIN indexes. 'simple' config: no stemming, works for every language.
ALTER TABLE "Question"
  ADD COLUMN "searchTsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("text", ''))) STORED;
CREATE INDEX "Question_searchTsv_idx" ON "Question" USING GIN ("searchTsv");

ALTER TABLE "Answer"
  ADD COLUMN "searchTsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("body", ''))) STORED;
CREATE INDEX "Answer_searchTsv_idx" ON "Answer" USING GIN ("searchTsv");

ALTER TABLE "Transcript"
  ADD COLUMN "searchTsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("text", ''))) STORED;
CREATE INDEX "Transcript_searchTsv_idx" ON "Transcript" USING GIN ("searchTsv");

-- Trigram indexes: handle search and "similar proposals".
CREATE INDEX "User_handle_trgm_idx" ON "User" USING GIN ("handle" gin_trgm_ops);
CREATE INDEX "Proposal_body_trgm_idx" ON "Proposal" USING GIN ("body" gin_trgm_ops);
