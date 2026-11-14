-- DOWN for 20261114300000_launch_hint (then delete the _prisma_migrations row).
UPDATE "Question" SET "hint" = 'With everything going on, say it in your voice. 10 seconds.' WHERE "hint" = 'With everything going on, say it in your voice. Up to 1 minute.';
