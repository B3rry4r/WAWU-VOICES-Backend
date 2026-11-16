-- V-FIX-B round 2. Additive: one defaulted column and one new table.
ALTER TABLE "UserSettings" ADD COLUMN "notifyTagFollows" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AlertMarker" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertMarker_pkey" PRIMARY KEY ("key")
);
