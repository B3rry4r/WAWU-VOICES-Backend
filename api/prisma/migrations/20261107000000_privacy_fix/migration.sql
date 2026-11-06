-- Privacy fix (P1 to P3). Additive: three nullable columns, one DROP NOT NULL, and a scrub of stored payment responses.

-- P2: a result post keeps its totals as a public record but loses its author link when the author's account is purged.
ALTER TABLE "ResultPost" ALTER COLUMN "authorId" DROP NOT NULL;

-- P3: marks so the storage purge job never deletes a file twice.
ALTER TABLE "VoiceClip" ADD COLUMN "storagePurgedAt" TIMESTAMP(3);
ALTER TABLE "StoredFile" ADD COLUMN "purgeRequestedAt" TIMESTAMP(3);
ALTER TABLE "StoredFile" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "VoiceClip_storagePurgedAt_status_idx" ON "VoiceClip"("status", "storagePurgedAt");
CREATE INDEX "StoredFile_purgedAt_purgeRequestedAt_idx" ON "StoredFile"("purgedAt", "purgeRequestedAt");

-- P1: scrub every stored Flutterwave verify response down to the whitelist (status, amount, currency, tx_ref, id,
-- charged_amount, created_at, card brand and last 4). init.checkoutUrl and overpay are kept. Safe to run twice.
UPDATE "Payment" p
SET "rawVerify" = (
  CASE WHEN jsonb_typeof(p."rawVerify"->'init') = 'object' THEN
    jsonb_build_object('init', jsonb_strip_nulls(jsonb_build_object('checkoutUrl', p."rawVerify"->'init'->'checkoutUrl')))
  ELSE '{}'::jsonb END
) || (
  CASE WHEN jsonb_typeof(p."rawVerify"->'overpay') = 'object' THEN
    jsonb_build_object('overpay', p."rawVerify"->'overpay')
  ELSE '{}'::jsonb END
) || (
  CASE WHEN jsonb_typeof(p."rawVerify"->'verify') = 'object' THEN
    jsonb_build_object('verify', jsonb_strip_nulls(jsonb_build_object(
      'status', s.src->'status',
      'amount', s.src->'amount',
      'currency', s.src->'currency',
      'tx_ref', s.src->'tx_ref',
      'id', s.src->'id',
      'charged_amount', s.src->'charged_amount',
      'created_at', s.src->'created_at',
      'card', CASE WHEN jsonb_typeof(s.src->'card') = 'object' THEN
        nullif(jsonb_strip_nulls(jsonb_build_object('type', s.src->'card'->'type', 'last_4digits', s.src->'card'->'last_4digits')), '{}'::jsonb)
      END
    )))
  ELSE '{}'::jsonb END
)
FROM (
  SELECT id, CASE WHEN jsonb_typeof("rawVerify"->'verify'->'data') = 'object' THEN "rawVerify"->'verify'->'data' ELSE "rawVerify"->'verify' END AS src
  FROM "Payment" WHERE "rawVerify" IS NOT NULL
) s
WHERE s.id = p.id AND p."rawVerify" IS NOT NULL AND jsonb_typeof(p."rawVerify") = 'object';
