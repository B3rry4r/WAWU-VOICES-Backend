-- V-SUBS (V-45): VOICES subscriptions (CONNECT, PLUS, INFINITY). ADDITIVE ONLY: three new tables, one new nullable column
-- (Payment.planId) and three new enum values, plus three nullable Payment columns (vatKobo, chargeKobo, totalKobo). Nothing existing is renamed, retyped or removed.
-- The new enum values are not used inside this migration (PostgreSQL forbids that in the same transaction).
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'QUEUED', 'ENDED', 'CANCELLED_DELETED');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'SUBSCRIPTIONS';

-- AlterEnum
ALTER TYPE "LedgerTxnKind" ADD VALUE 'SUBSCRIPTION_CREDIT';

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'SUBSCRIPTION';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "planId" TEXT;
-- The customer pays VAT and the payment charge on top (owner, 14 Nov 2026). Nullable: an older payment has no total and keeps the rule "amount equals price".
ALTER TABLE "Payment" ADD COLUMN     "vatKobo" INTEGER,
ADD COLUMN     "chargeKobo" INTEGER,
ADD COLUMN     "totalKobo" INTEGER;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "monthlyMilli" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "months" INTEGER NOT NULL,
    "monthlyMilli" INTEGER NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "startDay" TEXT NOT NULL,
    "endDay" TEXT NOT NULL,
    "creditedMonths" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCredit" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "monthNo" INTEGER NOT NULL,
    "amountMilli" INTEGER NOT NULL,
    "ledgerTxnId" TEXT NOT NULL,
    "creditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paymentId_key" ON "Subscription"("paymentId");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_startDay_idx" ON "Subscription"("status", "startDay");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCredit_ledgerTxnId_key" ON "SubscriptionCredit"("ledgerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCredit_subscriptionId_monthNo_key" ON "SubscriptionCredit"("subscriptionId", "monthNo");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCredit" ADD CONSTRAINT "SubscriptionCredit_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money sanity at the database, whatever the code does.
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_positive" CHECK ("months" > 0 AND "priceKobo" > 0 AND "monthlyMilli" > 0);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_counts" CHECK ("months" > 0 AND "monthlyMilli" > 0 AND "creditedMonths" >= 0 AND "creditedMonths" <= "months");
ALTER TABLE "SubscriptionCredit" ADD CONSTRAINT "SubscriptionCredit_amount" CHECK ("amountMilli" > 0 AND "monthNo" > 0);

-- The three plans of docs/launch/PRICING.md (prices in kobo, tokens in thousandths). Config, not code: the web reads them from the API.
INSERT INTO "SubscriptionPlan" ("id","slug","name","months","priceKobo","monthlyMilli","sortOrder","active","updatedAt") VALUES
  (gen_random_uuid()::text,'connect','VOICES CONNECT',3,299900,500000,1,true,now()),
  (gen_random_uuid()::text,'plus','VOICES PLUS',6,539900,600000,2,true,now()),
  (gen_random_uuid()::text,'infinity','VOICES INFINITY',12,959900,750000,3,true,now())
ON CONFLICT ("slug") DO NOTHING;
