-- Agent action log — AI transparency / audit trail (90-day TTL via cron purge).
CREATE TABLE "agent_action_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "company_id" UUID NOT NULL,
    "triggered_by" VARCHAR(40) NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(40),
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(40),
    "resource_id" UUID,
    "inputs" JSONB DEFAULT '{}',
    "result" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_action_logs" ADD CONSTRAINT "agent_action_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "agent_action_logs_company_created_idx" ON "agent_action_logs"("company_id", "created_at");
CREATE INDEX "agent_action_logs_company_action_idx" ON "agent_action_logs"("company_id", "action");
CREATE INDEX "agent_action_logs_resource_idx" ON "agent_action_logs"("resource_type", "resource_id");
