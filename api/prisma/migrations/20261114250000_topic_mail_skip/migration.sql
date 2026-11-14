-- Additive: people the relay refused for a topic mail (C01, C02), left alone until "until". No existing table is touched.
CREATE TABLE "TopicMailSkip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicMailSkip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicMailSkip_userId_template_key" ON "TopicMailSkip"("userId", "template");
CREATE INDEX "TopicMailSkip_until_idx" ON "TopicMailSkip"("until");
