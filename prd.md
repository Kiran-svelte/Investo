# PRD: Investo Multi-Tenant Real Estate AI Platform

## 1. Product overview

### 1.1 Document title and version

- PRD: Investo Multi-Tenant Real Estate AI Platform
- Version: 1.0.0

### 1.2 Product summary

This project is a multi-tenant SaaS platform for real estate companies that combines a web CRM dashboard with a WhatsApp AI conversation engine. The platform captures inbound WhatsApp inquiries, turns them into qualified leads, recommends properties, and drives site-visit scheduling.

The product is designed for strict tenant isolation, role-based access control, and multilingual communication, with a strong India-first focus. It includes onboarding, lead and property management, visit scheduling, analytics, billing, notifications, and auditability.

Current implementation is split into a TypeScript React frontend and a Node.js/Express backend with Prisma and PostgreSQL, plus Redis support, WebSocket updates, and automation jobs for reminders and follow-ups.

## 2. Goals

### 2.1 Business goals

- Increase qualified real estate leads from WhatsApp conversations.
- Improve lead-to-visit conversion rates through AI-assisted persuasion and follow-up.
- Provide a scalable multi-tenant SaaS model with subscription and billing support.
- Reduce operational overhead for sales and admin teams with automation.
- Enable enterprise trust with security controls, audit trails, and access governance.

### 2.2 User goals

- Company admins can onboard quickly, configure AI behavior, and manage teams.
- Sales agents can prioritize assigned leads and schedule visits efficiently.
- Operations users can monitor conversations and intervene when needed.
- Super admins can manage companies, plans, platform health, and governance.
- End customers can communicate in their preferred language and get relevant property suggestions fast.

### 2.3 Non-goals

- Building a native mobile app in this phase.
- Supporting non-real-estate AI use cases.
- Providing a full accounting ERP beyond subscription invoices.
- Replacing external WhatsApp platform infrastructure.

## 3. User personas

### 3.1 Key user types

- Super admin (platform owner)
- Company admin (tenant administrator)
- Sales agent
- Operations/support user
- Viewer/manager
- Real estate customer (WhatsApp end user)

### 3.2 Basic persona details

- **Super admin**: Manages tenants, plans, platform health, and global compliance.
- **Company admin**: Owns configuration, onboarding, users, properties, and team workflows for one tenant.
- **Sales agent**: Handles assigned leads, conversations, and visit closures.
- **Operations/support**: Monitors conversation quality and coordination tasks.
- **Viewer/manager**: Consumes analytics and performance insights with limited edit rights.
- **Customer**: Discovers properties via WhatsApp and books visits.

### 3.3 Role-based access

- **Super admin**: Cross-tenant control over companies, subscriptions, platform resources, and global analytics.
- **Company admin**: Full control within own tenant over users, leads, properties, AI settings, onboarding, and analytics.
- **Sales agent**: Access to assigned leads, related conversations, visits, and status updates.
- **Operations**: Monitoring and coordination access, typically broader read/write than agents but tenant-limited.
- **Viewer**: Read-only access to approved tenant resources and reports.

## 4. Functional requirements

- **Authentication and session management** (Priority: P0)
  - JWT access token plus refresh token flow.
  - Secure login, password reset, forced password change support.
  - Route guards for authenticated and public pages.

- **Authorization and tenant isolation** (Priority: P0)
  - Enforce role-based authorization across APIs and UI routes.
  - Scope all tenant data operations by server-side company context.
  - Prevent cross-tenant access at middleware and query layers.

- **WhatsApp webhook and message ingestion** (Priority: P0)
  - Verify webhook signatures and process incoming messages asynchronously.
  - Deduplicate incoming message IDs.
  - Map messages to correct tenant using phone number configuration.

- **Lead and conversation lifecycle management** (Priority: P0)
  - Auto-create leads from new WhatsApp contacts.
  - Maintain conversation state (ai_active, agent_active, closed).
  - Store message history and update lead status and engagement timestamps.

- **AI response generation and extraction** (Priority: P0)
  - Generate context-aware multilingual responses using provider abstraction.
  - Restrict assistant to real-estate context.
  - Extract structured intent fields (budget, location, property type, customer details).

- **Property catalog and matching** (Priority: P1)
  - Manage property inventory with metadata and availability status.
  - Provide property context to AI for recommendation quality.

- **Visit scheduling and automation** (Priority: P1)
  - Schedule and track visits with status and reminders.
  - Trigger automated 24h/1h reminders and follow-up workflows.
  - Notify agents on near-term appointments and stale negotiations.

- **Dashboard and analytics** (Priority: P1)
  - Deliver tenant-specific reporting on leads, visits, conversion, and AI activity.
  - Support role-specific dashboard visibility.

- **Notifications and audit logs** (Priority: P1)
  - Generate operational notifications for lead and visit events.
  - Capture auditable action records for governance and traceability.

- **Subscription, billing, onboarding, and feature flags** (Priority: P2)
  - Manage subscription plans and tenant invoices.
  - Track onboarding step completion per company.
  - Enable/disable tenant features with configurable flags.

## 5. User experience

### 5.1 Entry points and first-time user flow

- User accesses web app and authenticates via login.
- If required, user is routed to password change.
- Company admins are routed through onboarding until completion.
- After onboarding, user lands on role-appropriate dashboard.
- Customer entry point begins through inbound WhatsApp message.

### 5.2 Core experience

- **Inbound conversation**: Customer sends WhatsApp message, system verifies webhook, maps tenant, and stores message.
  - This ensures low-friction lead capture and immediate engagement.
- **AI qualification**: AI asks clarifying questions and shares relevant property options in customer language.
  - This ensures contextual personalization and faster lead qualification.
- **Conversion action**: AI or agent drives booking of a site visit.
  - This ensures measurable progress from inquiry to sales activity.
- **Team execution**: Agent updates lead status, visit outcomes, and notes in CRM.
  - This ensures operational continuity and visibility.

### 5.3 Advanced features and edge cases

- AI provider fallback behavior when primary provider fails.
- Duplicate webhook event handling.
- Agent takeover mode with AI disabled for selected conversation.
- Auto-close stale conversations after inactivity.
- Refresh token recovery on expired access tokens.
- Super-admin cross-tenant targeting for admin operations.

### 5.4 UI/UX highlights

- Route-level guards for auth, onboarding, and protected modules.
- Unified dashboard shell with role-based navigation.
- Real-time updates through socket connections.
- Searchable, filterable resource pages (leads, conversations, properties, visits).
- Internationalization support for web UI and multilingual AI chat behavior.

## 6. Narrative

A customer starts by sending a WhatsApp message in their preferred language. The system securely validates and processes the message, links it to the correct company, and launches an AI-guided conversation that qualifies intent and recommends relevant properties. When interest is confirmed, the workflow transitions to visit scheduling and sales execution inside the tenant dashboard. Agents and admins operate from a single source of truth with alerts, analytics, and auditability, while platform administrators maintain control over tenancy, plans, and reliability.

## 7. Success metrics

### 7.1 User-centric metrics

- Median first-response time to inbound WhatsApp messages.
- Lead qualification completion rate within first conversation.
- Visit scheduling rate per new lead.
- Agent task completion rate (status updates and follow-ups).
- Customer re-engagement rate after automated follow-ups.

### 7.2 Business metrics

- Tenant activation rate after onboarding.
- Lead-to-visit and visit-to-close conversion rates.
- Monthly recurring revenue and plan upgrade rate.
- Churn rate by tenant segment.
- Cost per qualified lead.

### 7.3 Technical metrics

- Webhook acknowledgment within 5 seconds.
- API p95 response time for core CRM endpoints.
- Message processing success rate and deduplication accuracy.
- Job success rate for reminders/follow-ups.
- Error rate by module and uptime of critical services.

## 8. Technical considerations

### 8.1 Integration points

- WhatsApp Cloud API for inbound/outbound messaging and webhook verification.
- AI providers (Anthropic Claude primary, OpenAI fallback).
- PostgreSQL via Prisma for transactional domain storage.
- Redis capability for caching/deduplication acceleration.
- WebSocket layer for real-time dashboard events.
- Docker-based environment for deployment consistency.

### 8.2 Data storage and privacy

- Tenant data model anchored on companyId relationships.
- Server-enforced tenant isolation middleware.
- JWT-authenticated APIs with role checks and status checks.
- Audit log tables for traceability.
- Masked logging practices for sensitive fields (for example phone numbers in webhook logs).
- Data retention and privacy policy controls required before production hardening.

### 8.3 Scalability and performance

- Rate limiting for user, company, and sensitive endpoints.
- Async webhook processing to meet provider response SLA.
- Background automation jobs for reminders and follow-ups.
- Database indexing on high-cardinality filters (companyId, status, timestamps).
- Horizontal scaling path for API workers and queue-backed job execution.

### 8.4 Potential challenges

- AI variability and multilingual quality consistency across regional language mixes.
- Mapping WhatsApp phone number IDs to tenant configs at scale.
- Ensuring all data access paths include tenant constraints.
- Avoiding reminder or follow-up duplication in distributed deployments.
- Managing schema drift and raw SQL usage in notification workflows.

### 8.5 Current architecture and project hierarchy

- **Frontend hierarchy**
  - React + TypeScript SPA with route guards for public/protected/onboarding flows.
  - Context providers for authentication and sockets.
  - Domain pages for dashboard, leads, properties, conversations, calendar, analytics, billing, settings, and audit logs.

- **Backend hierarchy**
  - Express application bootstrapped with security middleware, rate limiters, and modular route registration.
  - Middleware layers for authentication, RBAC, tenant isolation, validation, audit, and WhatsApp security.
  - Service layer for AI, WhatsApp messaging, automation jobs, deduplication, notifications, and socket orchestration.
  - Prisma schema covering tenancy, users, leads, conversations/messages, properties, visits, analytics, billing, onboarding, feature flags, and custom roles.

- **Runtime flow hierarchy**
  - Inbound WhatsApp event -> webhook security -> deduplication -> lead/conversation update -> AI generation -> outbound message -> dashboard visibility and automation hooks.
  - Dashboard user action -> API auth + tenant checks -> database update -> notification/audit/socket propagation.

## 9. Milestones and sequencing

### 9.1 Project estimate

- Large: 16-24 weeks for production-hardening and enterprise rollout.

### 9.2 Team size and composition

- Team size: 7-10
- Roles involved: Product manager, tech lead, 2-3 backend engineers, 2 frontend engineers, QA engineer, DevOps/SRE, data/AI engineer.

### 9.3 Suggested phases

- **Phase 1**: Foundation and security baseline (3-4 weeks)
  - Key deliverables: Auth hardening, tenant isolation verification, RBAC matrix enforcement, schema validation.
- **Phase 2**: Core CRM and conversation reliability (4-5 weeks)
  - Key deliverables: Stable lead/conversation lifecycle, webhook resiliency, deduplication coverage, error observability.
- **Phase 3**: AI quality and multilingual optimization (3-4 weeks)
  - Key deliverables: Prompt tuning, extraction accuracy, fallback behavior, regression tests for languages.
- **Phase 4**: Visit automation and analytics depth (3-4 weeks)
  - Key deliverables: Reminder/follow-up reliability, analytics consistency, dashboard performance.
- **Phase 5**: Billing, onboarding, and go-live readiness (3-4 weeks)
  - Key deliverables: Subscription workflows, onboarding completion UX, runbooks, load/security testing.

## 10. User stories

### 10.1 Authenticate and access the platform

- **ID**: GH-001
- **Description**: As a platform user, I want to sign in securely and maintain session continuity so I can use the dashboard without frequent disruptions.
- **Acceptance criteria**:
  - User can log in with valid credentials and receives access and refresh tokens.
  - Invalid credentials return a clear authentication error without sensitive details.
  - Expired access token triggers refresh flow and retries original request.
  - Missing or invalid refresh token redirects user to login.

### 10.2 Enforce role-based authorization

- **ID**: GH-002
- **Description**: As an admin, I want role-aware access controls so users only see and perform allowed actions.
- **Acceptance criteria**:
  - Protected endpoints reject unauthorized roles with 403.
  - UI hides or disables navigation/actions not permitted for current role.
  - Super admin can access platform-level resources; tenant roles cannot.

### 10.3 Enforce tenant isolation for all data operations

- **ID**: GH-003
- **Description**: As a tenant admin, I want strict company data isolation so my data never leaks to other companies.
- **Acceptance criteria**:
  - All non-super-admin requests are scoped to server-resolved company context.
  - Cross-tenant reads and writes are blocked at API layer.
  - Query logs and tests verify companyId constraints on core entities.

### 10.4 Process inbound WhatsApp messages securely

- **ID**: GH-004
- **Description**: As the platform, I want to ingest WhatsApp messages with verification so only authentic events are processed.
- **Acceptance criteria**:
  - Webhook verification endpoint supports subscription challenge.
  - Signature validation rejects spoofed requests in non-development environments.
  - Webhook endpoint acknowledges accepted payloads within provider SLA.
  - IP allowlisting and request size limits are enforced.

### 10.5 Prevent duplicate message processing

- **ID**: GH-005
- **Description**: As an operations user, I want duplicate webhook events ignored so leads and conversations remain consistent.
- **Acceptance criteria**:
  - Duplicate message IDs are detected and skipped.
  - Duplicate events do not create duplicate messages or status transitions.
  - Processing logs indicate deduplication outcome.

### 10.6 Auto-create and enrich leads from conversations

- **ID**: GH-006
- **Description**: As a sales team, I want new WhatsApp contacts to automatically become leads so no inquiry is missed.
- **Acceptance criteria**:
  - New inbound number creates a lead with source set to WhatsApp.
  - Lead is assigned to an active agent using least-loaded logic when available.
  - Lead last-contact timestamp updates on incoming customer messages.

### 10.7 Maintain conversation state machine

- **ID**: GH-007
- **Description**: As an agent, I want conversation states to control AI or human handling so handovers are reliable.
- **Acceptance criteria**:
  - AI responds only when conversation is ai_active and aiEnabled.
  - Agent takeover prevents automatic AI outbound messaging.
  - Inactive open conversations auto-close after timeout policy.

### 10.8 Provide multilingual AI responses with extracted intent

- **ID**: GH-008
- **Description**: As a customer, I want responses in my language and relevant suggestions so communication feels natural and useful.
- **Acceptance criteria**:
  - AI responds in detected customer language for supported locales.
  - AI output remains constrained to real-estate use case.
  - Extracted fields (budget, location, property type, name) update lead profile when confidence is sufficient.
  - Fallback provider is used when primary provider fails.

### 10.9 Manage property inventory for AI and agents

- **ID**: GH-009
- **Description**: As a company admin, I want to maintain property listings so customers receive accurate recommendations.
- **Acceptance criteria**:
  - Admin can create, update, list, and archive properties.
  - Property fields include pricing, location, type, amenities, and status.
  - AI recommendation context includes available properties only.

### 10.10 Schedule and track site visits

- **ID**: GH-010
- **Description**: As a sales agent, I want to schedule and manage visits so I can move leads toward closure.
- **Acceptance criteria**:
  - Agent can create and update visits with lead, property, and schedule details.
  - Visit status transitions are validated.
  - Visit records appear in agent/company calendar views.

### 10.11 Automate reminders and follow-ups

- **ID**: GH-011
- **Description**: As a company admin, I want automated reminders and follow-ups so conversion momentum is maintained.
- **Acceptance criteria**:
  - 24h and 1h reminders are sent for eligible upcoming visits.
  - Stale contacted leads receive automated follow-up messages.
  - Stale negotiation leads create internal notifications.
  - Automation jobs are observable and idempotent across reruns.

### 10.12 Deliver real-time dashboard updates and notifications

- **ID**: GH-012
- **Description**: As an operations user, I want real-time updates so I can respond quickly to lead and conversation changes.
- **Acceptance criteria**:
  - New conversation/lead activity appears in dashboard without manual refresh.
  - Notification center shows unread/read state and event context.
  - Access to notification data remains tenant-scoped.

### 10.13 Support onboarding completion flow

- **ID**: GH-013
- **Description**: As a company admin, I want a guided onboarding sequence so my organization can go live quickly.
- **Acceptance criteria**:
  - Onboarding status endpoint returns step completion state.
  - Company admin is redirected to onboarding until mandatory steps are complete.
  - Completion marks timestamp and unlocks standard dashboard access.

### 10.14 Manage subscription plans and invoices

- **ID**: GH-014
- **Description**: As a super admin, I want plan and invoice management so platform billing is controllable and traceable.
- **Acceptance criteria**:
  - Super admin can manage plans and assign tenant subscriptions.
  - Invoices support status lifecycle (pending, paid, overdue, cancelled).
  - Tenant billing views show only own company billing data.

### 10.15 Preserve auditability and compliance posture

- **ID**: GH-015
- **Description**: As a compliance stakeholder, I want key actions logged so investigations and governance reporting are possible.
- **Acceptance criteria**:
  - Security-sensitive and business-critical actions write audit records.
  - Audit logs are filterable by tenant and date.
  - Unauthorized users cannot view audit logs.

### 10.16 Support password reset and account recovery

- **ID**: GH-016
- **Description**: As a user, I want to recover account access safely if I forget my password.
- **Acceptance criteria**:
  - Password reset request creates time-bound reset token.
  - Used or expired reset tokens are rejected.
  - Successful reset invalidates stale session context.

This PRD is ready for approval. After approval, user stories GH-001 to GH-016 can be converted into GitHub issues.