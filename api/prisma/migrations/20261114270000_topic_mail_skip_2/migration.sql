-- TopicMailSkip no longer stores the e-mail address: a keyed hash of it is kept, enough to see that it changed.
-- The rows of the old shape (at most a day old, they only hold skip times) are removed; the next refusals write new ones.
DELETE FROM "TopicMailSkip";
ALTER TABLE "TopicMailSkip" DROP COLUMN "address";
ALTER TABLE "TopicMailSkip" ADD COLUMN "addressHash" TEXT NOT NULL;
ALTER TABLE "TopicMailSkip" ADD COLUMN "refusedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
