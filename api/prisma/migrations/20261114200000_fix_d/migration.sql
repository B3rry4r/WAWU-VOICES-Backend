-- V-FIX-D: a reply can be posted without the person's name, as an answer can. Additive: one column with a default, so every
-- reply that exists stays named and the previous release (which never reads the column) keeps working.
ALTER TABLE "Reply" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;
