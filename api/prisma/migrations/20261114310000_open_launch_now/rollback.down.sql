-- DOWN for 20261114310000_open_launch_now (then delete the _prisma_migrations row): the launch question starts at the
-- start of its Lagos day again. Only sensible before 23:00 UTC on 14 Nov 2026; after that the question is open either way.
UPDATE "Question" SET "startsAt" = '2026-11-14T23:00:00Z', "updatedAt" = now()
 WHERE "seedKey" = 'launch-mood-1' AND "startsAt" < '2026-11-14T23:00:00Z';
