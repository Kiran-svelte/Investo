-- Billing & subscription lifecycle (14-day trial + Cashfree)

CREATE TYPE "BillingStatus" AS ENUM ('invited', 'trialing', 'active', 'past_due', 'suspended', 'canceled');
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('card', 'invoice', 'upi', 'bank_transfer');
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'success', 'failed', 'cancelled');

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "line_items" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "company_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "billing_status" "BillingStatus" NOT NULL DEFAULT 'trialing',
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "payment_method" "SubscriptionPaymentMethod",
    "negotiated_monthly_price" DECIMAL(12,2),
    "included_seats" INTEGER NOT NULL DEFAULT 5,
    "per_seat_price_inr" DECIMAL(12,2) NOT NULL DEFAULT 499,
    "base_price_monthly" DECIMAL(12,2) NOT NULL DEFAULT 8999,
    "cashfree_subscription_id" VARCHAR(100),
    "cashfree_customer_id" VARCHAR(100),
    "next_billing_date" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "last_trial_reminder_day" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_subscriptions_company_id_key" ON "company_subscriptions"("company_id");

CREATE TABLE "agency_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(64) NOT NULL,
    "agency_name" VARCHAR(255) NOT NULL,
    "admin_email" VARCHAR(255) NOT NULL,
    "negotiated_monthly_price" DECIMAL(12,2),
    "company_id" UUID,
    "notes" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_invites_token_key" ON "agency_invites"("token");
CREATE INDEX "agency_invites_admin_email_idx" ON "agency_invites"("admin_email");

CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "subscription_id" UUID,
    "invoice_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "cashfree_order_id" VARCHAR(100),
    "cashfree_payment_id" VARCHAR(100),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_cashfree_order_id_key" ON "payments"("cashfree_order_id");
CREATE INDEX "payments_company_id_status_idx" ON "payments"("company_id", "status");

CREATE TABLE "billing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_events_company_id_created_at_idx" ON "billing_events"("company_id", "created_at");

ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_invites" ADD CONSTRAINT "agency_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "company_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
