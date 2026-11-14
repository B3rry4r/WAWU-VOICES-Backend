VERDICT: FIX

# Verify V-PRELAUNCH (API), first version, still being updated

Code under test: v/prelaunch d45f0d5, merged locally with origin/main 755aa15 (no conflicts, merge not pushed).
Attack specs are uncommitted. Every item says "run" (I ran it and saw the result) or "read" (code only).

## BLOCKER
(none so far)

## HIGH
1. (run) GET /api/v1/voice-clips/{clipId} and GET /api/v1/voice-clips/{clipId}/play answer 200 to a guest for the clip of a voice answer whose question has not opened (17 Nov question, clock 14 Nov 05:00 UTC, after the real launch shift). Body: the transcript text, status, duration, and a signed audio URL. The builder's list of read paths does not include these two routes. Needs the clip id, which anyone who saw the answer on 12-13 Nov (before the shift) already has. Should be 404 for everyone except the clip's owner/moderator, the same as the answer.
2. (run) POST /api/v1/share/links {objectType:QUESTION, objectId:<launch question>} at 14 Nov 05:00 UTC answers 404 NOT_FOUND ("We could not find that."). So no share link to the launch question can be made before 23:00 UTC tonight, the day people will share it. (Builder's own caveat; pre-existing V-27 rule, not fixed.) GET /questions/{launch}, /questions/today and /home all answer 200 as SCHEDULED with text and startsAt and no counts (good).

(more to follow)
