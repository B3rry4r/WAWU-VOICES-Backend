-- DOWN for 20261109000000_answer_listen (run only with the API of the previous release; then delete the _prisma_migrations row).
-- WARNING: this deletes every listen record. They exist nowhere else, so take a copy first if you want to keep them.
BEGIN;
DROP TABLE "AnswerListen";
COMMIT;
