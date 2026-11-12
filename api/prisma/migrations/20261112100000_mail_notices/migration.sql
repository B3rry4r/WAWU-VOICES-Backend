-- M-b (V-44): VOICES notification emails. Additive: one nullable column and one new table.
ALTER TABLE "User" ADD COLUMN "mailTo" TEXT;

CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "scopeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailLog_userId_template_eventKey_key" ON "MailLog"("userId", "template", "eventKey");
CREATE INDEX "MailLog_userId_template_scopeKey_createdAt_idx" ON "MailLog"("userId", "template", "scopeKey", "createdAt");
