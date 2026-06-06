-- Inbound WhatsApp message idempotency (cross-instance webhook dedup)
CREATE TABLE IF NOT EXISTS "inbound_whatsapp_dedup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "whatsapp_message_id" VARCHAR(255) NOT NULL,
    "sender_phone" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_whatsapp_dedup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_whatsapp_dedup_company_id_whatsapp_message_id_key"
    ON "inbound_whatsapp_dedup"("company_id", "whatsapp_message_id");

CREATE INDEX IF NOT EXISTS "inbound_whatsapp_dedup_company_id_created_at_idx"
    ON "inbound_whatsapp_dedup"("company_id", "created_at");

ALTER TABLE "inbound_whatsapp_dedup"
    ADD CONSTRAINT "inbound_whatsapp_dedup_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
