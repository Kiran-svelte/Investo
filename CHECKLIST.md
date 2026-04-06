# INVESTO - Verification Checklist

> Extracted from README.md. Every bullet must be verified during implementation.

---

## A. Core Architecture
- [ ] A1. Project uses React 18 + TypeScript + Tailwind CSS for frontend
- [ ] A2. Project uses Node.js + Express + TypeScript for backend
- [ ] A3. PostgreSQL 15 as primary database
- [ ] A4. Redis for caching and message queuing
- [ ] A5. Docker + Docker Compose for deployment
- [ ] A6. Monorepo structure with separate frontend/backend packages

## B. Authentication & Security
- [ ] B1. JWT-based authentication with 24h expiry
- [ ] B2. Refresh tokens with 7-day expiry and rotation
- [ ] B3. Passwords hashed with bcrypt (12+ rounds)
- [ ] B4. Rate limiting: 100 req/min per user, 1000/min per company
- [ ] B5. CORS restricted to known domains
- [ ] B6. All API endpoints require authentication (except webhook verification)
- [ ] B7. SQL injection prevented via parameterized queries (ORM)
- [ ] B8. XSS prevented via output encoding
- [ ] B9. Error responses don't leak internal details
- [ ] B10. No sensitive data in logs (passwords, tokens, full phone numbers)
- [ ] B11. TLS for all data transmission
- [ ] B12. No hardcoded configuration values (environment variables only)

## C. Multi-Tenant Isolation
- [ ] C1. All tables have company_id column
- [ ] C2. Middleware automatically injects company_id from JWT
- [ ] C3. Every database query includes company_id filter
- [ ] C4. Company can NEVER see another company's data
- [ ] C5. Super admin can view all data but should not modify company business data
- [ ] C6. Server-side company_id from session, ignore client-provided company_id

## D. RBAC (Role-Based Access Control)
- [ ] D1. Five roles implemented: super_admin, company_admin, sales_agent, operations, viewer
- [ ] D2. Permission matrix enforced at API level (not just UI)
- [ ] D3. Sales agent sees ONLY assigned leads
- [ ] D4. Operations role is read-only for leads
- [ ] D5. Viewer role is read-only for everything
- [ ] D6. RBAC middleware checks role on every request

## E. Lead Management CRM
- [ ] E1. Lead fields: name, phone, email, budget range, location, property type, source, agent, status, notes
- [ ] E2. Lead statuses: new, contacted, visit_scheduled, visited, negotiation, closed_won, closed_lost
- [ ] E3. Lead status state machine enforced (no skipping states)
- [ ] E4. closed_won and closed_lost are terminal states
- [ ] E5. Only company_admin can reopen closed_lost lead
- [ ] E6. Leads auto-created from new WhatsApp messages
- [ ] E7. Lead assignment: round-robin or least-loaded
- [ ] E8. Search, filter by status/agent/date
- [ ] E9. Leads cannot be deleted (only closed)
- [ ] E10. Lead timeline showing all activity

## F. Property Management
- [ ] F1. Property fields: name, builder, location, price range, bedrooms, type, amenities, images, brochure, RERA, status
- [ ] F2. Property statuses: available, sold, upcoming
- [ ] F3. Up to 10 images per property
- [ ] F4. AI queries property database to match customer preferences
- [ ] F5. Search by location, price range, bedrooms, type

## G. Visit / Calendar System
- [ ] G1. Visit statuses: scheduled, confirmed, completed, cancelled, no_show
- [ ] G2. Visit state machine enforced
- [ ] G3. Cannot schedule visits in the past
- [ ] G4. Cannot double-book agent (60 min minimum gap)
- [ ] G5. Calendar views: day, week, month
- [ ] G6. WhatsApp reminder 24h and 1h before visit
- [ ] G7. Reschedule and cancel functionality

## H. WhatsApp AI Engine
- [ ] H1. WhatsApp Cloud API integration (Meta)
- [ ] H2. Webhook handler with Meta signature verification
- [ ] H3. Language detection from customer message
- [ ] H4. AI responds in same language as customer
- [ ] H5. 11+ Indian languages supported (en, hi, kn, te, ta, ml, mr, bn, gu, pa, or)
- [ ] H6. AI wired ONLY for real estate (rejects off-topic)
- [ ] H7. AI collects: budget, location, property type, timeline
- [ ] H8. AI queries property database for matches
- [ ] H9. AI presents 2-3 best matching properties
- [ ] H10. AI persuades customer to book site visit
- [ ] H11. Persuasion rules followed (never pushy, always friendly)
- [ ] H12. Objection handling (too expensive, not interested, will think, looking elsewhere)
- [ ] H13. Agent takeover protocol (after 3 failed attempts or customer request)
- [ ] H14. AI stops sending when conversation is agent_active
- [ ] H15. Mixed language support (Hinglish etc.)
- [ ] H16. AI response time < 10 seconds

## I. Conversation Management
- [ ] I1. Conversation statuses: ai_active, agent_active, closed
- [ ] I2. Conversation state machine enforced
- [ ] I3. Full chat history viewable
- [ ] I4. AI vs human messages color-coded
- [ ] I5. Agent takeover button
- [ ] I6. Internal notes on conversations
- [ ] I7. Real-time updates via WebSocket
- [ ] I8. Inactivity timeout: 24 hours -> auto-close

## J. Multi-Language Support
- [ ] J1. Website language selector in header
- [ ] J2. All UI strings externalized to i18n files
- [ ] J3. All 11 Indian languages available in UI
- [ ] J4. Default language: English
- [ ] J5. AI auto-detects customer language
- [ ] J6. AI can switch languages mid-conversation

## K. Dashboard & UI
- [ ] K1. Fully responsive (mobile-first design)
- [ ] K2. Works on mobile browsers (not native app)
- [ ] K3. Works on laptop/desktop browsers
- [ ] K4. Super admin dashboard: companies, agents, conversations, revenue, health
- [ ] K5. Company dashboard: leads today, visits, deals, conversion rate
- [ ] K6. Sales agent dashboard: assigned leads, calendar, follow-ups
- [ ] K7. Page load < 2 seconds
- [ ] K8. Auto-refresh on dashboards (60 second interval)

## L. Automation
- [ ] L1. Lead auto-creation from WhatsApp messages
- [ ] L2. Visit reminders: 24h, 1h before (WhatsApp), 15min (agent notification)
- [ ] L3. Follow-up: contacted 48h no activity -> auto follow-up
- [ ] L4. Follow-up: visit completed -> next day feedback
- [ ] L5. Follow-up: negotiation 7 days -> agent reminder
- [ ] L6. Analytics CRON: daily aggregation at midnight
- [ ] L7. Lead assignment automation (round-robin/least-loaded)

## M. Notifications
- [ ] M1. Notification types: lead_new, visit_reminder, agent_takeover, system, follow_up
- [ ] M2. Real-time notifications in dashboard
- [ ] M3. WhatsApp notifications for customers
- [ ] M4. Mark as read functionality

## N. Analytics
- [ ] N1. Metrics: leads, visits, deals, conversion, revenue
- [ ] N2. Agent performance comparison
- [ ] N3. AI conversation statistics
- [ ] N4. Time filters: today, week, month, custom
- [ ] N5. Charts: lead funnel, daily trend, agent leaderboard
- [ ] N6. Export: PDF report, CSV data

## O. Billing & Subscriptions (Super Admin)
- [ ] O1. Subscription plans: Starter, Growth, Enterprise
- [ ] O2. Plan limits enforced (agents, leads, properties)
- [ ] O3. Monthly invoice auto-generation
- [ ] O4. Payment status tracking

## P. Audit & Compliance
- [ ] P1. Audit logs for all write operations
- [ ] P2. Audit log fields: user, action, resource, details, IP, timestamp
- [ ] P3. Company data retained 90 days after deactivation
- [ ] P4. Companies can request data export (CSV)
- [ ] P5. Companies cannot be deleted (only deactivated)

## Q. Infrastructure Invariants
- [ ] Q1. API response < 500ms (p95)
- [ ] Q2. Webhook processing < 3 seconds
- [ ] Q3. AI response < 10 seconds
- [ ] Q4. Dashboard load < 2 seconds
- [ ] Q5. System uptime 99.5%
- [ ] Q6. Phone numbers in E.164 format
- [ ] Q7. All timestamps in UTC (convert in UI)
- [ ] Q8. UUIDs for all primary keys
- [ ] Q9. Monetary values as DECIMAL (never FLOAT)
- [ ] Q10. Database connection pool: min 10, max 50

## R. Testing
- [ ] R1. Unit tests: 70% coverage (business logic, state machines, validation)
- [ ] R2. Integration tests: 20% coverage (API endpoints, DB operations)
- [ ] R3. E2E tests: 10% coverage (critical user flows)
- [ ] R4. Tests written BEFORE implementation
- [ ] R5. Full test suite must pass before deployment

## S. Forbidden Items Verification
- [ ] S1. No cross-tenant data access possible
- [ ] S2. AI never discusses non-real-estate topics
- [ ] S3. No plain text passwords stored
- [ ] S4. No API endpoints without authentication (except webhook)
- [ ] S5. No direct database access from frontend
- [ ] S6. No raw SQL in route handlers (ORM only)
- [ ] S7. No leads can be deleted
- [ ] S8. No visits scheduled in the past
- [ ] S9. No lead status skipping allowed
- [ ] S10. No agent double-booking possible

## T. Dynamic Roles & Customization
- [ ] T1. Company admin can create custom roles with specific permissions
- [ ] T2. Default system roles (company_admin, sales_agent) always available
- [ ] T3. Custom roles stored per company (CompanyRole model)
- [ ] T4. Permissions stored as JSON (resource → actions mapping)
- [ ] T5. RBAC middleware resolves custom roles dynamically
- [ ] T6. Feature flags per company (CompanyFeature model)
- [ ] T7. Feature-gated routes check company features before access
- [ ] T8. Company admin can enable/disable features
- [ ] T9. Users assigned to custom roles work correctly

## U. Onboarding Flow
- [ ] U1. Multi-step onboarding wizard (6 steps)
- [ ] U2. Step 1: Company profile setup
- [ ] U3. Step 2: Role configuration (select needed roles)
- [ ] U4. Step 3: Feature selection (enable/disable modules)
- [ ] U5. Step 4: AI configuration (tone, languages, FAQ)
- [ ] U6. Step 5: Team invitation
- [ ] U7. Step 6: Completion confirmation
- [ ] U8. Onboarding state tracked per company
- [ ] U9. Users redirected to onboarding if not completed
- [ ] U10. Onboarding can be resumed (saves progress)

## V. AI Bot (OpenAI Integration)
- [ ] V1. OpenAI API key configurable in .env
- [ ] V2. AI provider selectable (openai/claude)
- [ ] V3. Trained real estate conversation layer
- [ ] V4. Property matching from database
- [ ] V5. Multi-language detection and response
- [ ] V6. Persuasion engine with objection handling
- [ ] V7. Working hours enforcement
- [ ] V8. Agent takeover protocol
