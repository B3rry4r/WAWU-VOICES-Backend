-- Additive: serves the topic mail budget count (template in C01, C02 and createdAt since the UTC day start).
CREATE INDEX "MailLog_template_createdAt_idx" ON "MailLog"("template", "createdAt");
