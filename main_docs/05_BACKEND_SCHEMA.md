# Investo — Backend Schema

| Field | Value |
|-------|-------|
| Document | Backend Database Schema (source of truth) |
| ORM | Prisma 7 → PostgreSQL 15 |
| Source | `backend/prisma/schema.prisma` |
| Extensions | `pgvector` (vector), `uuid-ossp` |
| Last updated | 2026-06-07 |

> All primary keys are `UUID` (default `uuid()`). All money is `Decimal`. Timestamps are UTC. Every tenant-scoped table carries `company_id`. Column names map to snake_case in PostgreSQL.

---

## 1. Entity-relationship overview

```
SubscriptionPlan 1───* Company
Company 1───* User, Lead, Property, PropertyProject, Conversation, Visit,
            Notification, AuditLog, Analytics, Invoice, CompanyRole,
            CompanyFeature, AgentSession, AgentActionLog,
            InboundWhatsappDedup, WorkflowRunRecord, WorkflowIdempotencyKey,
            PropertyImport* (drafts/units/media/jobs/blobs)
Company 1───1 AiSetting, CompanyOnboarding
CompanyRole 1───* User (custom_role_id)
User 1───* RefreshToken, PasswordResetToken, AssignedLeads, Visits, AgentSession
Lead 1───* Conversation, Visit
Conversation 1───* Message
PropertyProject 1───* Property, PropertyProjectFile, PropertyImportDraft
Property 1───* Visit
AgentSession 1───* PendingAction
PropertyImportDraft 1───* PropertyImportUnit, PropertyImportMedia, PropertyImportJob
PropertyImportMedia 1───1 PropertyImportMediaBlob
```

---

## 2. Core tenancy & identity

### 2.1 `subscription_plans`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(100) | |
| max_agents | int | |
| max_leads | int? | |
| max_properties | int? | |
| price_monthly | decimal(12,2) | |
| price_yearly | decimal(12,2)? | |
| features | json | default `[]` |
| status | PlanStatus | active/inactive |
| created_at | timestamp | |

### 2.2 `companies` (tenant root)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(255) | |
| slug | varchar(100) | **unique** |
| whatsapp_phone | varchar(20)? | **unique** (global) |
| plan_id | uuid? FK→subscription_plans | |
| status | CompanyStatus | active/inactive/suspended |
| settings | json | per-tenant config (WhatsApp creds, branding) |
| created_at / updated_at | timestamp | |

### 2.3 `users`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| auth_provider_id | varchar(255)? | unique (external IdP) |
| company_id | uuid FK→companies | |
| name | varchar(255) | |
| email | varchar(255) | **unique** |
| phone | varchar(20)? | |
| password_hash | varchar(255)? | bcrypt |
| role | UserRole | super_admin/company_admin/sales_agent/operations/viewer |
| status | UserStatus | active/inactive |
| must_change_password | bool | default false |
| custom_role_id | uuid? FK→company_roles | dynamic RBAC |
| last_login | timestamp? | |
| created_at / updated_at | timestamp | |

Indexes: `(company_id, role)`.

### 2.4 `refresh_tokens` / `password_reset_tokens`
- `refresh_tokens`: `token_hash`, `expires_at`, `revoked`; FK→users (cascade). Index `(user_id)`, `(token_hash)`.
- `password_reset_tokens`: `token_hash` unique, `expires_at`, `used`; FK→users (cascade).

---

## 3. Dynamic RBAC, features, onboarding

### 3.1 `company_roles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK | |
| role_name | varchar(50) | unique per company |
| display_name | varchar(100) | |
| permissions | json | `{ leads:["read","update"], ... }` |
| is_default | bool | system roles |

Unique `(company_id, role_name)`.

### 3.2 `company_features`
| Column | Type | Notes |
|--------|------|-------|
| company_id | uuid FK | |
| feature_key | varchar(50) | e.g., `ai_bot`, `analytics` |
| enabled | bool | default true |
| config | json | feature-specific |

Unique `(company_id, feature_key)`.

### 3.3 `company_onboarding`
| Column | Type | Notes |
|--------|------|-------|
| company_id | uuid FK | **unique** (1:1) |
| step_completed | int | 0–6 |
| company_profile / roles_configured / features_selected / ai_configured / team_invited | bool | step flags |
| completed_at | timestamp? | |

---

## 4. CRM: leads, conversations, messages

### 4.1 `leads`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK | |
| customer_name | varchar(255)? | |
| phone | varchar(20) | E.164 |
| email | varchar(255)? | |
| budget_min / budget_max | decimal(14,2)? | |
| location_preference | varchar(255)? | |
| property_type | PropertyType? | |
| source | LeadSource | whatsapp/website/manual/referral |
| status | LeadStatus | FSM (see §10) |
| assigned_agent_id | uuid? FK→users | |
| notes | text? | |
| language | varchar(5) | default `en` |
| re_engagement_sent_at | timestamp? | anti-spam guard |
| re_engagement_count | int | |
| metadata | json | lead_score, tags[], source_detail, lost_reason |
| **lead_memory** | json? | **unified AI brain** (budget, projects discussed, summary, open questions) |
| created_at / updated_at / last_contact_at | timestamp | |

Indexes: `(company_id, status)`, `(company_id, assigned_agent_id)`, `(phone)`, `(company_id, last_contact_at)`. **Unique `(company_id, phone)`** — prevents duplicate leads on concurrent webhook retries.

### 4.2 `conversations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK | |
| lead_id | uuid? FK→leads | |
| whatsapp_phone | varchar(20) | |
| status | ConversationStatus | ai_active/agent_active/closed |
| language | varchar(5) | |
| ai_enabled | bool | |
| **stage** | ConversationStage | goal-directed FSM |
| stage_entered_at | timestamp | |
| stage_message_count | int | |
| commitments | json | micro-commitment tracking |
| objection_count / consecutive_objections | int | |
| last_objection_type | varchar(50)? | |
| urgency_score / value_score | int | default 5 |
| escalation_reason | text? | |
| escalated_at | timestamp? | |
| recommended_property_ids | json | array |
| selected_property_id | uuid? | |
| proposed_visit_time | timestamp? | |
| created_at / updated_at | timestamp | |

Indexes: `(company_id)`, `(whatsapp_phone)`, `(lead_id)`.

### 4.3 `messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| conversation_id | uuid FK | |
| sender_type | SenderType | customer/ai/agent |
| content | text | |
| language | varchar(5)? | |
| whatsapp_message_id | varchar(255)? | **unique** (dedup) |
| status | MessageStatus | sent/delivered/read/failed |
| created_at | timestamp | |

Index `(conversation_id, created_at)`.

### 4.4 `inbound_whatsapp_dedup`
Cross-instance idempotency for inbound webhooks (Meta retries, dual providers).
| Column | Type | Notes |
|--------|------|-------|
| company_id | uuid FK | |
| whatsapp_message_id | varchar(255) | |
| sender_phone | varchar(32)? | |

Unique `(company_id, whatsapp_message_id)`; index `(company_id, created_at)`.

---

## 5. Properties & projects

### 5.1 `property_projects` / `property_project_files`
- `property_projects`: name, description, sort_order; index `(company_id, sort_order)`.
- `property_project_files`: file_name, mime_type, storage_key, file_size; FK→project (cascade).

### 5.2 `properties`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK | |
| project_id | uuid? FK→property_projects | |
| name | varchar(255) | |
| builder | varchar(255)? | |
| location_city / location_area | varchar(100)? | |
| location_pincode | varchar(10)? | |
| price_min / price_max | decimal(14,2)? | |
| bedrooms | int? | |
| property_type | PropertyType | villa/apartment/plot/commercial/other |
| amenities | json | array |
| description | text? | |
| images | json | array of URLs |
| brochure_url | varchar(500)? | |
| floor_plan_urls | json | array |
| price_list_url | varchar(500)? | |
| latitude | decimal(10,8)? | WhatsApp location |
| longitude | decimal(11,8)? | |
| rera_number | varchar(50)? | |
| status | PropertyStatus | available/sold/upcoming |

Indexes: `(company_id, status)`, `(company_id, project_id)`.

---

## 6. Property import pipeline

### 6.1 `property_import_drafts`
Tracks upload→extraction→review→publish. Key fields: `status` (PropertyImportDraftStatus), `extraction_status` (PropertyImportExtractionStatus), `retry_count`/`max_retries`, `failure_reason`, `draft_data` (json), `review_notes`, timestamps (`extraction_requested_at`, `reviewed_at`, `published_at`, `cancelled_at`). FKs: company, project, created_by_user, reviewed_by_user, published_property. Indexes `(company_id, status)`, `(company_id, extraction_status)`, `(created_by_user_id)`.

### 6.2 `property_import_units`
Flat-level inventory per draft: `sort_order`, `label`, `unit_data` (json), `published_property_id`, `status` (PropertyImportUnitStatus). FK→draft (cascade).

### 6.3 `property_import_media` / `property_import_media_blobs`
- Media: `asset_type` (image/brochure/video), `status`, file_name, mime_type, file_size, storage_key, public_url, `upload_token` (unique), etag, `extracted_metadata`. Unique `(company_id, storage_key)`.
- Blob: raw `bytes` stored in DB (1:1 with media), keyed by `media_id`.

### 6.4 `property_import_jobs`
Async extraction jobs: `job_type` (extract_media), `status`, queue_name, `idempotency_key`, payload, result, attempt/max_attempts, `next_retry_at`. Unique `(company_id, idempotency_key)`; indexes `(draft_id, status)`, `(company_id, status, next_retry_at)`, `(queue_name, status)`.

---

## 7. Visits

### `visits`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| company_id | uuid FK | |
| lead_id | uuid FK→leads | |
| property_id | uuid? FK→properties | |
| agent_id | uuid FK→users | |
| scheduled_at | timestamp | no past dates |
| duration_minutes | int | default 60 |
| status | VisitStatus | scheduled/confirmed/completed/cancelled/no_show |
| notes | text? | |
| reminder_sent | bool | |

Indexes: `(company_id, scheduled_at)`, `(agent_id, scheduled_at)`. Business rule: no agent double-book within 60 min.

---

## 8. AI configuration & staff agent

### 8.1 `ai_settings` (1:1 with company)
Base: business_name, business_description, operating_locations (json), budget_ranges (json), response_tone (formal/friendly/casual), working_hours (json), faq_knowledge (json), greeting_template, persuasion_level (1–10), auto_detect_language, default_language, agent_name (default "Riya").

**Never-Say-No conversion brain:** business_type (residential_sale/rental/mixed/commercial/fractional), partner_company_ids (json), special_offers (json), conversion_rules (json), launch_weeks_from_now, operator_contact (json), offer_fractional (bool), offer_rent_to_own (bool), budget_stretch_pct (default 15), auto_confirm_visits (default false).

### 8.2 `agent_sessions` (staff WhatsApp copilot)
| Column | Type | Notes |
|--------|------|-------|
| user_id / company_id | uuid FK | |
| phone | varchar(20) | |
| thread_id | varchar(100) | **unique** |
| status | AgentSessionStatus | active/inactive |
| last_active_at | timestamp | |

Unique `(user_id, phone)`; indexes `(phone)`, `(company_id, status)`.

### 8.3 `pending_actions` (destructive-action confirmations)
`session_id` FK→agent_sessions (cascade), `action_type`, `action_params` (json), `display_message`, `status` (PendingActionStatus: awaiting/confirmed/rejected/expired), `expires_at`, `resolved_at`. Indexes `(session_id, status)`, `(expires_at)`.

---

## 9. Workflow saga, idempotency & observability

### 9.1 `workflow_run_records` (saga tracking)
`workflow_id`, `channel`, `idempotency_key`, `status` (WorkflowRunStatus: running/completed/failed/completed_with_errors/needs_reconciliation), `state_snapshot` (json — pre-mutation state), `steps_json` (json — per-step {action,status,errorMessage}), `failed_step`, `completed_at`. Indexes `(company_id, status)`, `(company_id, workflow_id, created_at)`, `(idempotency_key)`.

### 9.2 `workflow_idempotency_keys`
Deterministic `key` = `{workflowId}:{companyId}:{leadId/visitId}:{scheduledAtISO}`, `workflow_id`, `result_reply` (cached reply on duplicate), `status`, `expires_at` (24 h TTL). Unique `(company_id, key)`; index `(company_id, expires_at)`.

### 9.3 `agent_action_logs` (AI transparency)
`triggered_by` (cron/agent_tool/automation/inbound_message), `actor_id`/`actor_role`, `action`, `resource_type`/`resource_id`, `inputs` (json), `result` (text), `status` (success/failed/skipped), `error_message`, `duration_ms`. Indexes `(company_id, created_at)`, `(company_id, action)`, `(resource_type, resource_id)`.

---

## 10. Supporting tables

### `invoices`
invoice_number (unique), amount, tax, total_amount, currency (default INR), status (InvoiceStatus: pending/paid/overdue/cancelled), period_start/end, due_date, paid_at, payment_method, payment_ref, notes. Indexes `(company_id, status)`, `(due_date)`.

### `notifications`
company_id?, user_id?, type (NotificationType), title, message, data (json, mapped `details`), read. Index `(user_id, read)`.

### `audit_logs`
company_id?, user_id?, action, resource_type, resource_id, details (json), ip_address. Index `(company_id, created_at)`.

### `analytics` (daily snapshot)
date, leads_generated, visits_scheduled, visits_completed, deals_closed, revenue (decimal 14,2), ai_conversations, ai_messages_sent. **Unique `(company_id, date)`**.

---

## 11. Enumerations

| Enum | Values |
|------|--------|
| PlanStatus | active, inactive |
| InvoiceStatus | pending, paid, overdue, cancelled |
| CompanyStatus | active, inactive, suspended |
| UserRole | super_admin, company_admin, sales_agent, operations, viewer |
| UserStatus | active, inactive |
| AgentSessionStatus | active, inactive |
| PendingActionStatus | awaiting, confirmed, rejected, expired |
| LeadStatus | new, contacted, visit_scheduled, visited, negotiation, closed_won, closed_lost |
| LeadSource | whatsapp, website, manual, referral |
| PropertyType | villa, apartment, plot, commercial, other |
| PropertyStatus | available, sold, upcoming |
| ConversationStatus | ai_active, agent_active, closed |
| ConversationStage | rapport, qualify, shortlist, objection_handling, commitment, visit_booking, confirmation, human_escalated, closed_won, closed_lost |
| SenderType | customer, ai, agent |
| MessageStatus | sent, delivered, read, failed |
| VisitStatus | scheduled, confirmed, completed, cancelled, no_show |
| ResponseTone | formal, friendly, casual |
| NotificationType | lead_new, visit_reminder, agent_takeover, system, follow_up, lead_assigned, lead_status_change, lead_reassigned, visit_scheduled, visit_confirmed, visit_completed, visit_cancelled, visit_rescheduled, system_alert |
| PropertyImportDraftStatus | draft, extracting, review_ready, publish_ready, published, failed, cancelled |
| PropertyImportExtractionStatus | pending_upload, upload_completed, queued, processing, extracted, failed, cancelled |
| PropertyImportMediaStatus | upload_requested, uploaded, verified, queued_for_extraction, extracted, failed, cancelled |
| PropertyImportAssetType | image, brochure, video |
| PropertyImportJobType | extract_media |
| PropertyImportJobStatus | queued, processing, succeeded, failed, cancelled |
| PropertyImportUnitStatus | draft, ready, published, failed |
| WorkflowRunStatus | running, completed, failed, completed_with_errors, needs_reconciliation |

---

## 12. Vector / RAG storage

Beyond the Prisma models, the platform uses `pgvector` for:
- **`client_memory_chunks`** — per-lead RAG embeddings derived from `leads.lead_memory`.
- **Property knowledge embeddings** — for grounding AI answers in inventory.

These are **derived** stores synced asynchronously (`syncLeadClientMemory`); `leads.lead_memory` remains the single source of truth.

---

## 13. Data integrity & multi-tenant invariants

1. Every tenant-scoped query **must** filter `company_id` (injected from JWT, never trusted from client).
2. UUID PKs everywhere (multi-tenant safety; no guessable auto-increment).
3. Money as `Decimal`, never float; timestamps UTC; phones E.164.
4. Companies and leads are **never hard-deleted** — deactivate / close-as-lost.
5. Unique constraints enforce idempotency: `messages.whatsapp_message_id`, `inbound_whatsapp_dedup(company_id, whatsapp_message_id)`, `leads(company_id, phone)`, `workflow_idempotency_keys(company_id, key)`.
6. Cascade deletes only on owned children (import drafts→units/media/jobs, sessions→pending_actions, tokens→user).
