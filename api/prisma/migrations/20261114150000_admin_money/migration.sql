-- V-ADMIN-MONEY: the admin money screens read the payment and ledger tables by time and by kind. ADDITIVE ONLY: three
-- indexes, no column, no type, no data change. (The config change log, the audit log and the plans already exist.)
-- CreateIndex
CREATE INDEX "Payment_status_verifiedAt_idx" ON "Payment"("status", "verifiedAt");

-- CreateIndex
CREATE INDEX "Payment_kind_createdAt_idx" ON "Payment"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_kind_createdAt_idx" ON "LedgerTransaction"("kind", "createdAt");
