-- Owner, 14 Nov 2026 (13:50 UTC): VOICES is open now and people are registering. The launch question opens at once,
-- not at 23:00 UTC. Only its start moves: its day (15 Nov), its end and everything else stay as they are.
-- Data only. A question that has already started is left alone, so running this again changes nothing.
UPDATE "Question" SET "startsAt" = now(), "updatedAt" = now()
 WHERE "seedKey" = 'launch-mood-1' AND "startsAt" > now();
