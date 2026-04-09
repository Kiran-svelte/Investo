# INVESTO - Real Estate AI SaaS Platform

> **Multi-tenant, multi-language real estate CRM with WhatsApp AI that speaks every Indian language, convinces clients, and closes site visits.**

---

## Table of Contents

1. [Vision & Core Service](#1-vision--core-service)
2. [Product Layer Model](#2-product-layer-model)
3. [System Architecture](#3-system-architecture)
4. [Roles & RBAC](#4-roles--rbac)
5. [Page-by-Page Specification](#5-page-by-page-specification)
6. [AI Conversation Engine](#6-ai-conversation-engine)
7. [Multi-Language Support](#7-multi-language-support)
8. [Database Structure](#8-database-structure)
9. [State Machine Rules](#9-state-machine-rules)
10. [Automation Features](#10-automation-features)
    - 10.1 Lead Auto-Creation
    - 10.2 Visit Reminder System
    - 10.3 Follow-Up Automation
    - 10.4 Lead Assignment
    - 10.5 Analytics Aggregation
    - **10.6 WhatsApp Rich Media & Dynamic Property Ingestion** ⭐ NEW
11. [Hard Decisions](#11-hard-decisions)
12. [What Is Forbidden](#12-what-is-forbidden)
13. [Data Ownership Rules](#13-data-ownership-rules)
14. [Infrastructure Contract Spec Invariants](#14-infrastructure-contract-spec-invariants)
15. [Testing Strategy](#15-testing-strategy)
16. [Red-Team Scenarios](#16-red-team-scenarios)
17. [Integration Audit Checklist](#17-integration-audit-checklist)
18. [Implementation Chunks](#18-implementation-chunks)
19. [Service Catalog](#19-service-catalog)

---

## 1. Vision & Core Service

**Investo** is a multi-tenant SaaS platform for the Indian real estate industry.

### What It Does
- **WhatsApp AI Agent** that speaks Kannada, Hindi, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, English, and more
- **Convinces clients** to book site visits through friendly, persistent, expert conversation
- **Never lets clients slip away** - the AI debates, persuades, and keeps focus on booking visits
- **Web dashboard** with full mobile compatibility (responsive web, NOT a native app)
- **Multi-tenant** - each real estate company gets isolated data and configuration

### Core Promise
> A customer messages on WhatsApp in ANY Indian language. The AI responds in the SAME language, understands their budget, preferences, and location needs, recommends matching properties from the database, and convinces them to schedule a site visit. The AI is wired ONLY for real estate - it will not discuss unrelated topics.

---

## 2. Product Layer Model

### Layer 1: Core Service
- WhatsApp AI conversation for real estate leads
- Property matching and recommendation
- Site visit booking

### Layer 2: Essential Infrastructure
- Authentication / Login (JWT + refresh tokens)
- Multi-tenant database isolation
- WhatsApp Cloud API integration
- AI model integration (Claude/OpenAI)
- Data encryption at rest and in transit
- Automated backups
- Server monitoring and health checks

### Layer 3: Usability (Dashboard)
- Role-based dashboards
- Lead management CRM
- Property management
- Conversation viewer
- Calendar / visit scheduling
- Agent management
- Onboarding wizard for new companies

### Layer 4: Comfort Features
- Push notifications
- Search and filters across all entities
- Analytics dashboards
- Lead scoring
- Follow-up reminders
- Bulk operations

### Layer 5: Delight / Premium
- AI assistant that learns company tone
- Smart property suggestions
- Predictive lead scoring
- Beautiful, responsive UI
- WhatsApp quick reply templates
- Automated follow-up sequences

### Layer 6: Trust Layer
- Audit logs for all actions
- Role-based permissions (RBAC)
- Privacy controls per company
- Data encryption (AES-256)
- GDPR/Indian data compliance
- Rate limiting and abuse prevention

---

## 3. System Architecture

```
Customer WhatsApp (Any Indian Language)
        |
WhatsApp Cloud API (Meta Business)
        |
    Webhook Handler
        |
  Language Detection
        |
    AI Engine (Claude/OpenAI)
        |  |
        |  +-- Property Database Query
        |  +-- Lead Creation/Update
        |  +-- Visit Scheduling
        |
    Response in Customer's Language
        |
WhatsApp Cloud API --> Customer
        |
  Dashboard UI (React)
        |
  Backend API (Node.js/Express)
        |
  PostgreSQL + Redis
```

### Tech Stack
| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 15 |
| Cache | Redis |
| AI | Claude API / OpenAI API |
| WhatsApp | Meta WhatsApp Cloud API |
| Auth | JWT + bcrypt |
| File Storage | AWS S3 / Local |
| Deployment | Docker + Docker Compose |
| Testing | Jest + Supertest + React Testing Library |

---

## 4. Roles & RBAC

### Role Hierarchy

| Role | Scope | Access Level |
|------|-------|-------------|
| Super Admin | Entire platform | Full system control |
| Company Admin | Single company | Full company control |
| Sales Agent | Assigned leads only | Lead management |
| Operations/Support | Company internal | Chat monitoring, coordination |
| Viewer/Manager | Company read-only | Analytics and reports |

### Permission Matrix

| Resource | Super Admin | Company Admin | Sales Agent | Operations | Viewer |
|----------|-------------|---------------|-------------|------------|--------|
| Platform settings | CRUD | - | - | - | - |
| Company management | CRUD | R own | - | - | - |
| Subscriptions | CRUD | R own | - | - | - |
| Users (own company) | CRUD (all) | CRUD | R self | R | R |
| Leads | CRUD (all) | CRUD | RU assigned | R | R |
| Properties | CRUD (all) | CRUD | R | R | R |
| Conversations | R (all) | R (company) | R assigned | R (company) | - |
| Visits | CRUD (all) | CRUD | CRUD assigned | RU | R |
| Analytics | R (all) | R (company) | R own | R (company) | R |
| AI Settings | CRUD (all) | CRUD | - | - | - |
| Audit Logs | R (all) | R (company) | - | - | R |

**CRUD** = Create, Read, Update, Delete

### Data Isolation Rules
1. A company can NEVER see another company's data
2. A sales agent can NEVER see leads assigned to other agents (unless company admin grants access)
3. Super admin can see all data but should not modify company-level business data
4. All API endpoints MUST check tenant context before returning data
5. Database queries MUST include company_id filter (enforced at middleware level)

---

## 5. Page-by-Page Specification

### SUPER ADMIN Pages

#### 5.1 Platform Dashboard
- **Widgets**: Total companies, active agents, conversations today, monthly revenue, WhatsApp message usage, server health indicators
- **Behavior**: Auto-refreshes every 60 seconds, shows last 30 days trend
- **Data source**: Aggregated from all companies

#### 5.2 Company Management
- **CRUD operations**: Create, read, update, deactivate companies
- **Fields**: Company name, plan, user limit, WhatsApp number (unique), status, created date
- **Constraints**: Cannot delete company (only deactivate), WhatsApp number is globally unique
- **Subscription assignment**: Link company to a plan

#### 5.3 Subscription & Billing
- **Plans**: Define plan name, max agents, max leads, max properties, price, billing cycle
- **Invoices**: Auto-generated monthly, track payment status
- **Example Plans**:
  - Starter: 3 agents, 500 leads, 50 properties - Rs.4999/month
  - Growth: 10 agents, 2000 leads, 200 properties - Rs.14999/month
  - Enterprise: Unlimited - Rs.49999/month

#### 5.4 System Monitoring
- **Error logs**: Last 1000 errors with stack traces
- **Queue status**: WhatsApp message queue depth
- **AI usage**: Token consumption per company
- **Database health**: Connection pool, query performance

### COMPANY ADMIN Pages

#### 5.5 Company Dashboard
- **Widgets**: Leads today, visits scheduled, deals closed, conversion rate, AI conversations active, agent performance summary
- **Time filters**: Today, this week, this month, custom range
- **Charts**: Lead funnel, daily leads trend, agent leaderboard

#### 5.6 Lead Management (CRM)
- **Fields**: Customer name, phone (WhatsApp), email, budget range, location preference, property type interest (villa/apartment/plot/commercial), lead source, assigned agent, status, notes, created date, last contact date
- **Statuses**: New -> Contacted -> Visit Scheduled -> Visited -> Negotiation -> Closed Won -> Closed Lost
- **Features**: Search, filter by status/agent/date, bulk assign, export CSV, lead timeline
- **Auto-creation**: Leads auto-created when new WhatsApp customer messages

#### 5.7 Conversation Center
- **View**: All WhatsApp conversations for the company
- **Features**: Search by customer name/phone, filter by status, view full chat history, see AI vs human messages (color-coded), agent takeover button, add internal notes
- **Real-time**: New messages appear instantly (WebSocket)

#### 5.8 Calendar / Visit Scheduling
- **Views**: Day, week, month calendar
- **Features**: Book site visit, assign agent, set property, add notes, send reminder, reschedule, cancel
- **Constraints**: Cannot double-book same agent at same time, must have at least 1 hour between visits
- **Reminders**: WhatsApp reminder to customer 24h and 1h before visit

#### 5.9 Property Management
- **Fields**: Property name, builder/developer, location (city, area, pincode), price range, bedrooms (1/2/3/4+), property type, amenities (multi-select), description, images (up to 10), brochure PDF, status (available/sold/upcoming), RERA number
- **AI Integration**: AI queries this database to match customer preferences
- **Search**: By location, price range, bedrooms, type

#### 5.10 Agent Management
- **Fields**: Name, phone, email, role, assigned leads count, total sales, performance score
- **Features**: Add/edit/deactivate agents, view agent performance, reassign leads, set working hours

#### 5.11 AI Configuration
- **Settings**: Business name, business description, operating cities/areas, budget ranges handled, response tone (formal/friendly/casual), working hours, FAQ knowledge base, greeting message template, objection handling rules, follow-up schedule
- **Language**: Default response language, auto-detect toggle
- **Behavior**: How aggressively AI pushes for visit booking (1-10 scale)

#### 5.12 Analytics Dashboard
- **Metrics**: Total leads, leads by source, leads by status, conversion funnel, visits booked vs completed, deals closed, revenue, agent performance comparison, AI conversation stats, response time analytics
- **Export**: PDF report, CSV data

### SALES AGENT Pages

#### 5.13 My Leads
- **Shows**: Only leads assigned to this agent
- **Actions**: Update status, add notes, call customer, schedule visit

#### 5.14 My Calendar
- **Shows**: Only this agent's scheduled visits
- **Actions**: View details, reschedule, add notes, mark as completed

#### 5.15 Conversation Viewer
- **Shows**: Chat history of assigned leads only
- **Actions**: Read-only (cannot send messages from dashboard)

#### 5.16 Follow-Up Reminders
- **Shows**: Pending follow-ups for assigned leads
- **Actions**: Mark as done, snooze, add notes

### OPERATIONS Pages

#### 5.17 Conversation Monitor
- All active conversations, can flag issues
- Cannot modify leads or send messages

#### 5.18 Visit Coordinator
- All scheduled visits, coordinate logistics

---

## 6. AI Conversation Engine

### Core Behavior
The AI is **wired exclusively for real estate**. It will NOT discuss:
- Politics, religion, sports, entertainment
- Other products or services
- Personal opinions on non-real-estate topics

### Conversation Flow
```
1. Customer sends message (any Indian language)
2. System detects language
3. AI responds in SAME language
4. AI collects: budget, location preference, property type, timeline
5. AI queries property database for matches
6. AI presents 2-3 best matching properties
7. AI persuades customer to book site visit
8. On confirmation, system creates visit entry
9. System sends confirmation with date/time/location
10. System sends reminders before visit
```

### Persuasion Rules
1. **Never be pushy** - be warm, friendly, helpful
2. **Always relate back to property benefits** - if customer hesitates, highlight value
3. **Handle objections gracefully**:
   - "Too expensive" -> Show similar in lower range + explain value
   - "Not interested" -> Ask what specifically doesn't match, show alternative
   - "Will think about it" -> Offer no-commitment site visit, emphasize "just come see"
   - "Looking elsewhere" -> Highlight unique features, offer comparison visit
4. **Create urgency without pressure**: "This property has high demand, I can reserve a visit slot for you"
5. **Always end with a call to action**: Schedule visit, share more details, or follow up later
6. **Never argue** - acknowledge concerns, redirect to solutions

### Language Detection & Response
- Detect input language using AI language detection
- Respond in the SAME language
- Support: English, Hindi, Kannada, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia
- Mixed language (Hinglish, etc.) supported - respond in the dominant language
- Website: Language selector dropdown for UI translation

### AI Knowledge Base
The AI has access to:
1. Company's property database (real-time)
2. Company's FAQ configuration
3. Company's tone/brand settings
4. Conversation history with this customer
5. Customer's lead profile (budget, preferences)

### Agent Takeover Protocol
1. AI handles conversation by default
2. If customer explicitly asks for human OR AI cannot resolve query after 3 attempts:
   - AI informs customer: "Let me connect you with our expert"
   - System notifies assigned agent
   - Agent takes over in real-time
   - AI disengages until agent releases

---

## 7. Multi-Language Support

### WhatsApp (AI)
| Language | Code | Support Level |
|----------|------|---------------|
| English | en | Full |
| Hindi | hi | Full |
| Kannada | kn | Full |
| Telugu | te | Full |
| Tamil | ta | Full |
| Malayalam | ml | Full |
| Marathi | mr | Full |
| Bengali | bn | Full |
| Gujarati | gu | Full |
| Punjabi | pa | Full |
| Odia | or | Full |

### Website UI
- Language selector in header
- All UI strings externalized to i18n files
- RTL support not required (no RTL Indian languages)
- Default: English
- Available: All languages listed above

---

## 8. Database Structure

### Core Tables

```sql
-- Multi-tenant company isolation
companies (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  whatsapp_phone VARCHAR(20) UNIQUE,
  plan_id UUID REFERENCES subscription_plans(id),
  status ENUM('active', 'inactive', 'suspended'),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Users across all companies
users (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'),
  status ENUM('active', 'inactive'),
  last_login TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- CRM Leads
leads (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  customer_name VARCHAR(255),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  budget_min DECIMAL,
  budget_max DECIMAL,
  location_preference VARCHAR(255),
  property_type ENUM('villa', 'apartment', 'plot', 'commercial', 'other'),
  source ENUM('whatsapp', 'website', 'manual', 'referral'),
  status ENUM('new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'),
  assigned_agent_id UUID REFERENCES users(id),
  notes TEXT,
  language VARCHAR(5) DEFAULT 'en',
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  last_contact_at TIMESTAMP
)

-- WhatsApp conversations
conversations (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  lead_id UUID REFERENCES leads(id),
  whatsapp_phone VARCHAR(20) NOT NULL,
  status ENUM('ai_active', 'agent_active', 'closed'),
  language VARCHAR(5) DEFAULT 'en',
  ai_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Individual messages
messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) NOT NULL,
  sender_type ENUM('customer', 'ai', 'agent'),
  content TEXT NOT NULL,
  language VARCHAR(5),
  whatsapp_message_id VARCHAR(255),
  status ENUM('sent', 'delivered', 'read', 'failed'),
  created_at TIMESTAMP
)

-- Property listings
properties (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  name VARCHAR(255) NOT NULL,
  builder VARCHAR(255),
  location_city VARCHAR(100),
  location_area VARCHAR(100),
  location_pincode VARCHAR(10),
  price_min DECIMAL,
  price_max DECIMAL,
  bedrooms INTEGER,
  property_type ENUM('villa', 'apartment', 'plot', 'commercial'),
  amenities JSONB DEFAULT '[]',
  description TEXT,
  images JSONB DEFAULT '[]',
  brochure_url VARCHAR(500),
  rera_number VARCHAR(50),
  status ENUM('available', 'sold', 'upcoming'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Site visits
visits (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  lead_id UUID REFERENCES leads(id) NOT NULL,
  property_id UUID REFERENCES properties(id),
  agent_id UUID REFERENCES users(id) NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  status ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'),
  notes TEXT,
  reminder_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- AI configuration per company
ai_settings (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) UNIQUE NOT NULL,
  business_name VARCHAR(255),
  business_description TEXT,
  operating_locations JSONB DEFAULT '[]',
  budget_ranges JSONB DEFAULT '{}',
  response_tone ENUM('formal', 'friendly', 'casual') DEFAULT 'friendly',
  working_hours JSONB DEFAULT '{}',
  faq_knowledge JSONB DEFAULT '[]',
  greeting_template TEXT,
  persuasion_level INTEGER DEFAULT 7 CHECK (persuasion_level BETWEEN 1 AND 10),
  auto_detect_language BOOLEAN DEFAULT true,
  default_language VARCHAR(5) DEFAULT 'en',
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Subscription plans
subscription_plans (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  max_agents INTEGER NOT NULL,
  max_leads INTEGER,
  max_properties INTEGER,
  price_monthly DECIMAL NOT NULL,
  price_yearly DECIMAL,
  features JSONB DEFAULT '[]',
  status ENUM('active', 'inactive'),
  created_at TIMESTAMP
)

-- Notifications
notifications (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  type ENUM('lead_new', 'visit_reminder', 'agent_takeover', 'system', 'follow_up'),
  title VARCHAR(255),
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP
)

-- Audit logs
audit_logs (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMP
)

-- Analytics snapshots
analytics (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id) NOT NULL,
  date DATE NOT NULL,
  leads_generated INTEGER DEFAULT 0,
  visits_scheduled INTEGER DEFAULT 0,
  visits_completed INTEGER DEFAULT 0,
  deals_closed INTEGER DEFAULT 0,
  revenue DECIMAL DEFAULT 0,
  ai_conversations INTEGER DEFAULT 0,
  ai_messages_sent INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  UNIQUE(company_id, date)
)
```

### Indexes Required
- `leads(company_id, status)` - Lead filtering
- `leads(company_id, assigned_agent_id)` - Agent's leads
- `messages(conversation_id, created_at)` - Chat history
- `visits(company_id, scheduled_at)` - Calendar queries
- `visits(agent_id, scheduled_at)` - Agent schedule
- `properties(company_id, status)` - Available properties
- `audit_logs(company_id, created_at)` - Audit trail

---

## 9. State Machine Rules

### Lead Status Machine
```
New ──────────────> Contacted
                        |
                        v
              Visit Scheduled
                        |
                        v
                    Visited
                        |
                   ┌────┴────┐
                   v         v
             Negotiation  Closed Lost
                   |
              ┌────┴────┐
              v         v
        Closed Won  Closed Lost
```

**Rules:**
1. Lead starts as `new` (always)
2. `new` -> `contacted` (only valid transition from new)
3. `contacted` -> `visit_scheduled` or `closed_lost`
4. `visit_scheduled` -> `visited` or `cancelled` (reverts to `contacted`)
5. `visited` -> `negotiation` or `closed_lost`
6. `negotiation` -> `closed_won` or `closed_lost`
7. `closed_won` and `closed_lost` are terminal states - **NO transitions allowed out**
8. **CANNOT skip states** - must go through the pipeline in order
9. Only company_admin can reopen a closed_lost lead (back to `contacted`)

### Visit Status Machine
```
Scheduled -> Confirmed -> Completed
    |            |
    v            v
 Cancelled    No Show
```

**Rules:**
1. Visit starts as `scheduled`
2. `scheduled` -> `confirmed` (customer confirms) or `cancelled`
3. `confirmed` -> `completed` or `no_show`
4. `cancelled`, `completed`, `no_show` are terminal
5. Cannot schedule visit in the past
6. Cannot schedule two visits for same agent within 60 minutes

### Conversation Status Machine
```
AI Active ──> Agent Active ──> Closed
    |                            ^
    └────────────────────────────┘
```

**Rules:**
1. New conversations start as `ai_active`
2. `ai_active` -> `agent_active` (agent takeover or customer request)
3. `agent_active` -> `ai_active` (agent releases) or `closed`
4. `ai_active` -> `closed` (inactivity timeout: 24 hours)
5. AI does NOT send messages when conversation is `agent_active`

---

## 10. Automation Features

### 10.1 Lead Auto-Creation
**Trigger**: New WhatsApp message from unknown number
**Action**:
1. Create lead with status `new`
2. Create conversation with status `ai_active`
3. Detect language from message
4. Assign to round-robin agent OR least-loaded agent
5. Notify company admin
6. AI begins conversation

### 10.2 Visit Reminder System
**Schedule**:
- 24 hours before: WhatsApp message to customer + notification to agent
- 1 hour before: WhatsApp message to customer
- 15 minutes before: Push notification to agent

**Content** (in customer's language):
```
Hi {name}! Reminder: Your property visit at {property} is tomorrow at {time}.
Address: {address}
Your agent {agent_name} will meet you there.
Reply YES to confirm or RESCHEDULE to change.
```

### 10.3 Follow-Up Automation
**Rules**:
- Lead status `contacted` for 48 hours without activity -> Auto follow-up WhatsApp
- Lead status `visit_scheduled` and visit completed -> Follow up next day asking feedback
- Lead status `negotiation` for 7 days -> Reminder to agent

### 10.4 Lead Assignment
**Methods**:
- Round-robin: Equal distribution
- Least-loaded: Agent with fewest active leads
- Manual: Company admin assigns

### 10.5 Analytics Aggregation
**Daily CRON job at midnight**:
- Count leads generated today
- Count visits scheduled/completed
- Count deals closed
- Calculate revenue
- Store in analytics table

---

## 10.6 WhatsApp Rich Media & Dynamic Property Ingestion

### Reality Check
This is not perfectly implemented end to end yet.

The codebase already has the beginning of the media model and import pipeline:
- `properties.images` already exists and is used by the property import flow.
- `properties.brochure_url` already exists and is persisted by imports and property CRUD.
- `floor_plan_urls`, `price_list_url`, `latitude`, and `longitude` are already present in the schema and validation layer.
- The property import service can persist drafted images and brochure URLs.

What is still missing or only partially designed:
- WhatsApp send methods for images, documents, location pins, quick replies, and CTA buttons.
- Webhook handling for interactive button/list replies.
- EMI calculator endpoint and UI flow.
- Company-specific Excel/brochure mapping profiles.
- OCR/table extraction from uploaded soft copies.
- Human-review queue with confidence scoring before publish.

### 10.6.1 What Real Estate Actually Needs on WhatsApp

| Sales action | What Investo needs | Current state |
|---|---|---|
| Sends brochure PDF | Brochure URL, WhatsApp document delivery | Partial: stored, not fully sent end to end |
| Sends floor plans | Floor plan URLs or uploaded pages | Partial: schema exists, delivery not wired |
| Sends property photos | Media asset storage + image delivery | Partial: stored, not sent end to end |
| Sends price list PDF | Versioned price book + document delivery | Partial: URL field exists, live pricing sync missing |
| Sends location map | Latitude/longitude + location pin send | Partial: fields exist, delivery missing |
| EMI calculator | EMI endpoint + formatted breakdown | Missing |
| Quick reply buttons | Interactive WhatsApp message support | Missing |
| Call me / Book visit buttons | Interactive CTA webhook handling | Missing |

### 10.6.2 Understanding

What we are actually solving is not “how to let users manually enter properties.” The real problem is this:
- Every company has a different source format.
- Pricing changes by offer, festival, stock, and tower/flat type.
- Brochures, Excel sheets, WhatsApp text, and soft copies are all source-of-truth candidates.
- The AI must answer from approved inventory, not from memory.

The wrong assumption is that one universal UI will solve all companies. It will not. The system needs a company-specific ingestion layer plus a canonical internal model.

### 10.6.3 Questions and Clarifications

Before building more features, these points must be fixed in the product rules:
1. Is Excel the pricing source of truth for each company, or only one of several inputs?
2. Are brochures authoritative for floor plans and amenities, or only for presentation?
3. Which source wins when brochure, Excel, and admin edits disagree?
4. How long can a price stay active before it is considered stale?
5. Which fields can auto-publish, and which fields must always be reviewed by a human?

### 10.6.4 Solution Architecture

The right architecture is a hybrid ingestion and delivery pipeline:

1. Company onboarding
- Company admin selects a source style: brochure-first, Excel-first, or mixed.
- The system stores a reusable import profile for that company.
- Field mapping is configured once, then reused.

2. Input channels
- PDF brochure upload.
- Excel/CSV price sheet upload.
- Property image upload.
- Optional API/CRM sync for advanced companies.
- Manual edits for exceptions only.

3. Extraction and normalization
- OCR/table extraction parses brochures and soft copies.
- Spreadsheet parser reads price changes, inventory, and unit availability.
- AI normalizes raw input into one internal schema.
- Duplicate and inconsistent records are flagged.

4. Human-in-the-loop review
- High-confidence fields auto-accept.
- Medium- and low-confidence fields go to review.
- Reviewer can accept, edit, reject, or defer.
- Nothing becomes customer-facing until it is approved or explicitly allowed by policy.

5. WhatsApp delivery
- Approved images, brochure PDFs, floor plans, price lists, maps, and CTAs are sent through WhatsApp Cloud API.
- The AI chooses media based on conversation stage and lead intent.
- Button/list clicks come back through the webhook and move the conversation forward.

### 10.6.5 Data Model

The current schema already covers the first layer of this model. For scale, the internal design should center on:
- `properties` for the canonical listing.
- `property_units` for flat-level inventory, floor, tower, facing, and availability.
- `price_books` or `price_versions` for offer/festival-driven changes.
- `source_documents` for brochures, Excel sheets, and uploads.
- `media_assets` for images, PDFs, and maps.
- `import_drafts` for AI-extracted drafts before publish.

Important design rule:
- Never overwrite price history.
- Store new pricing as a version with effective dates.
- Show only the active approved version to the AI and customers.

### 10.6.6 User Impact

Different users need different behavior:
- Sales teams should not retype the same flat details every time.
- Company admins should map a template once and then only fix exceptions.
- Customers should see rich, stage-appropriate media instead of plain text walls.
- Operations staff should review uncertain data, not manually maintain everything.

The experience should feel like this:
1. Upload brochure or Excel.
2. System extracts draft inventory.
3. Human reviews only flagged items.
4. Approved data becomes searchable and WhatsApp-ready.
5. AI uses that data to keep the conversation moving toward visit booking.

### 10.6.7 Scalability and Future

The design must survive company differences without rebuilding the app every time:
- Per-company field mapping profiles.
- Reusable document parsers with company-specific rules.
- Async background processing for OCR and spreadsheet jobs.
- Source priority rules that can be changed in config, not code.
- Versioned pricing so festival offers do not destroy history.

This creates some technical debt, but it is the right debt:
- More metadata.
- More validation.
- More review states.
- Less manual chaos.

### 10.6.8 Risks and Mitigations

- OCR mistakes: require confidence scores and human approval.
- Stale price lists: use effective dates and freshness checks.
- Duplicate flats across imports: dedupe by tower, unit number, and source version.
- Wrong WhatsApp promises: only answer from approved active inventory.
- Broken media links: use signed HTTPS URLs and fallback text.
- Cross-company leakage: enforce company_id filtering everywhere.

### 10.6.9 Implementation Phases

**MVP**
- Store brochure, image, floor plan, and price list URLs.
- Support manual property import and editing.
- Keep human review before publish.

**Phase 2**
- Add Excel/CSV mapping per company.
- Add OCR/table extraction for uploaded soft copies.
- Add draft confidence scoring and review queue.

**Phase 3**
- Add WhatsApp image/document/location/button delivery.
- Add webhook handling for interactive replies.
- Add stage-aware media selection in the AI engine.

**Phase 4**
- Add EMI calculator.
- Add price versioning and active-offer windows.
- Add advanced analytics for conversion by media type.

### 10.6.10 End-to-End Flow

```
Brochure / Excel / Images / Manual edit
  ↓
Upload or sync to company import profile
  ↓
OCR / table extraction / normalization
  ↓
Confidence scoring and dedupe
  ↓
Human review for uncertain fields
  ↓
Publish approved inventory and price versions
  ↓
AI fetches active approved data during chat
  ↓
WhatsApp sends text + media + location + buttons
  ↓
Webhook captures replies and CTA clicks
  ↓
Lead status, visit booking, and follow-up are updated
```

### 10.6.11 What Should NOT Be Claimed Yet

Do not claim the platform is fully complete for these items until the delivery path exists end to end:
- WhatsApp image/document/button sending.
- Interactive button/list webhook handling.
- EMI calculation API.
- Automatic brochure-to-inventory extraction with zero review.
- Fully live Excel price syncing for all companies.

The current code is a solid base, but it is not yet a perfect real-estate WhatsApp operating system.

---

## 11. Hard Decisions

### HD-1: Multi-tenancy Strategy
**Decision**: Shared database with `company_id` column on every table (not schema-per-tenant)
**Reason**: Simpler operations, easier to query across tenants for super admin, lower cost
**Tradeoff**: Must enforce tenant isolation at application layer religiously

### HD-2: AI Provider
**Decision**: Support Claude API as primary, OpenAI as fallback
**Reason**: Claude excels at Indian language conversations and nuanced persuasion
**Tradeoff**: Dual-provider maintenance cost

### HD-3: WhatsApp API
**Decision**: Meta WhatsApp Cloud API (official)
**Reason**: Reliable, scalable, compliant
**Tradeoff**: Higher cost, Meta approval process, template message requirements

### HD-4: No Native App
**Decision**: Responsive web only, NO native mobile app
**Reason**: Faster development, single codebase, instant updates
**Tradeoff**: No push notifications on mobile (use WhatsApp notifications instead)

### HD-5: Agent Takeover Model
**Decision**: AI handles all conversations by default, agents take over manually
**Reason**: Reduces staffing needs, AI handles 80% of initial conversations
**Tradeoff**: Risk of AI saying something wrong

### HD-6: Language Strategy
**Decision**: AI handles language dynamically (not pre-configured per customer)
**Reason**: Customers may switch languages mid-conversation, auto-detect is more natural
**Tradeoff**: Slightly higher AI token usage for language detection

---

## 12. What Is Forbidden

### F-1: Cross-Tenant Data Access
- **FORBIDDEN**: Any API endpoint returning data without company_id filter
- **FORBIDDEN**: SQL query without WHERE company_id = ? (except super admin aggregates)
- **ENFORCEMENT**: Middleware automatically injects company_id from JWT

### F-2: AI Behavior
- **FORBIDDEN**: AI discussing topics outside real estate
- **FORBIDDEN**: AI making promises about property prices or availability without database confirmation
- **FORBIDDEN**: AI sharing one company's data with another company's customer
- **FORBIDDEN**: AI sending messages when conversation is in `agent_active` state
- **FORBIDDEN**: AI responding to messages outside company working hours (configurable)

### F-3: Data Security
- **FORBIDDEN**: Storing passwords in plain text (must use bcrypt, min 12 rounds)
- **FORBIDDEN**: Transmitting data without TLS
- **FORBIDDEN**: Logging sensitive data (passwords, tokens, full phone numbers)
- **FORBIDDEN**: API endpoints without authentication (except webhook verification)
- **FORBIDDEN**: Direct database access from frontend

### F-4: Business Logic
- **FORBIDDEN**: Deleting companies (only deactivate)
- **FORBIDDEN**: Deleting leads (only close as lost)
- **FORBIDDEN**: Scheduling visits in the past
- **FORBIDDEN**: Assigning leads across companies
- **FORBIDDEN**: Skipping lead statuses in the pipeline
- **FORBIDDEN**: Double-booking agents (visits within 60 min of each other)

### F-5: System
- **FORBIDDEN**: Deploying without running full test suite
- **FORBIDDEN**: Raw SQL queries in route handlers (must use ORM/query builder)
- **FORBIDDEN**: Storing files locally in production (use S3/cloud storage)
- **FORBIDDEN**: Hardcoding configuration values (use environment variables)

---

## 13. Data Ownership Rules

### DO-1: Company Data Isolation
- All business data belongs to the company
- Super admin can VIEW but should not MODIFY company data
- If company deactivates, data is retained for 90 days then purged
- Companies can request data export (CSV format)

### DO-2: Customer Data
- Customer data (phone, name, chat history) belongs to the company that received the message
- If a customer contacts multiple companies, each company has its own copy
- Customer can request deletion via company (company admin processes)

### DO-3: AI Conversation Data
- All conversations are stored and belong to the company
- AI model providers do NOT retain conversation data (ensure API settings)
- Conversation data is used only for that company's AI context

### DO-4: Platform Data
- Aggregate analytics belong to platform owner (super admin)
- Individual company metrics are visible only to that company + super admin
- Billing data is platform-owned

---

## 14. Infrastructure Contract Spec Invariants

### INV-1: Response Time
- API endpoint response: < 500ms (p95)
- WhatsApp webhook processing: < 3 seconds
- AI response generation: < 10 seconds
- Dashboard page load: < 2 seconds

### INV-2: Availability
- System uptime: 99.5% (allows ~43 hours downtime/year)
- WhatsApp webhook: Must respond 200 within 5 seconds (Meta requirement)
- Database: Connection pool min 10, max 50 per instance

### INV-3: Data Integrity
- All monetary values stored as DECIMAL, never FLOAT
- All timestamps in UTC, converted to local timezone in UI
- Phone numbers stored in E.164 format (+91XXXXXXXXXX)
- UUIDs for all primary keys (no auto-increment for multi-tenant safety)

### INV-4: Security
- JWT tokens expire in 24 hours
- Refresh tokens expire in 7 days
- Rate limiting: 100 requests/minute per user, 1000/minute per company
- WhatsApp webhook verified via signature validation
- CORS restricted to known domains
- SQL injection prevented via parameterized queries
- XSS prevented via output encoding

### INV-5: Scalability
- Support 100+ companies simultaneously
- Support 10,000+ concurrent WhatsApp conversations
- Database query performance: < 100ms for indexed queries
- Message queue for async processing (WhatsApp, notifications, analytics)

---

## 15. Testing Strategy

### Test Pyramid
1. **Unit Tests** (70%): Business logic, state machines, validation, AI prompt construction
2. **Integration Tests** (20%): API endpoints, database operations, WhatsApp webhook
3. **E2E Tests** (10%): Critical user flows (login, lead creation, visit booking)

### Test-First Requirements
Every feature must have tests BEFORE implementation:

#### Unit Tests Must Cover:
- Lead status transitions (valid and invalid)
- Visit status transitions
- Conversation status transitions
- RBAC permission checks
- Data validation (phone format, email, budget range)
- AI prompt construction
- Language detection
- Tenant isolation in queries

#### Integration Tests Must Cover:
- Authentication flow (login, token refresh, logout)
- CRUD operations for all entities
- WhatsApp webhook processing
- AI conversation flow
- Visit scheduling with conflict detection
- Multi-language response
- Audit log creation

#### E2E Tests Must Cover:
- Super admin creates company and plan
- Company admin adds property and agent
- Customer WhatsApp message creates lead
- AI conversation leads to visit booking
- Agent takeover flow
- Dashboard analytics display correct data

---

## 16. Red-Team Scenarios

### RT-1: Tenant Breach
**Attack**: User modifies JWT company_id to access another company's data
**Defense**: Server-side company_id from authenticated session, ignore client-provided company_id

### RT-2: AI Manipulation
**Attack**: Customer tries to make AI discuss non-real-estate topics or extract system prompts
**Defense**: System prompt explicitly forbids off-topic, AI trained to redirect to real estate

### RT-3: WhatsApp Spam
**Attack**: Flood webhook with fake messages
**Defense**: Verify webhook signature (Meta's verification), rate limit per phone number

### RT-4: Agent Impersonation
**Attack**: Sales agent tries to access admin endpoints
**Defense**: RBAC middleware checks role on every request, not just frontend hiding

### RT-5: Data Exfiltration
**Attack**: Compromised account downloads all leads
**Defense**: Rate limiting on export endpoints, audit logging, alert on bulk data access

### RT-6: SQL Injection
**Attack**: Malicious input in search fields
**Defense**: Parameterized queries throughout, input validation

### RT-7: Privilege Escalation
**Attack**: Operations role tries to modify lead status
**Defense**: Permission matrix enforced at API level, not UI level

---

## 17. Integration Audit Checklist

- [ ] Every API endpoint checks authentication
- [ ] Every API endpoint checks authorization (RBAC)
- [ ] Every database query includes company_id filter
- [ ] All state transitions follow state machine rules
- [ ] WhatsApp webhook validates Meta signature
- [ ] AI responses stay within real estate domain
- [ ] AI responds in customer's detected language
- [ ] Visit scheduling prevents double-booking
- [ ] Lead assignment works (round-robin/least-loaded)
- [ ] Notifications fire on all trigger events
- [ ] Audit logs capture all write operations
- [ ] Error responses don't leak internal details
- [ ] Rate limiting active on all endpoints
- [ ] CORS properly configured
- [ ] File uploads validated (type, size)
- [ ] Passwords hashed with bcrypt (12+ rounds)
- [ ] JWT tokens contain minimal claims
- [ ] Refresh token rotation works
- [ ] Analytics CRON job runs daily
- [ ] Visit reminders send at correct times
- [ ] Follow-up automation fires on schedule
- [ ] Multi-language UI strings complete for all languages
- [ ] Mobile responsive on all pages
- [ ] WebSocket connections authenticated

---

## 18. Implementation Chunks

### Chunk 1: Foundation
- Project scaffolding (frontend + backend)
- Database schema and migrations
- Authentication system (JWT)
- Basic RBAC middleware
- Health check endpoint

### Chunk 2: Multi-Tenant Core
- Company CRUD
- User management
- Role-based access control
- Tenant isolation middleware
- Audit logging

### Chunk 3: CRM & Properties
- Lead management CRUD
- Lead status state machine
- Property management CRUD
- Search and filtering

### Chunk 4: WhatsApp AI Engine
- WhatsApp Cloud API integration
- Webhook handler
- Language detection
- AI conversation engine
- Property matching
- Visit booking via chat

### Chunk 5: Dashboard & UI
- React app scaffolding
- Multi-language i18n setup
- Responsive layout (mobile-first)
- All dashboard pages
- Calendar component
- Real-time updates (WebSocket)

### Chunk 6: Automation & Notifications
- Visit reminder system
- Follow-up automation
- Lead auto-creation from WhatsApp
- Notification system
- Analytics aggregation CRON

### Chunk 7: Billing & Super Admin
- Subscription plans management
- Company billing
- Super admin dashboard
- System monitoring
- Platform analytics

---

## 19. Service Catalog

### What Investo Serves
1. **Real Estate Developers**: Automate lead handling from WhatsApp inquiries
2. **Real Estate Agencies**: Manage multiple projects and agents efficiently
3. **Property Brokers**: AI-powered lead conversion without large sales teams

### Why It's Non-Optional
- 78% of Indian real estate inquiries start on WhatsApp
- Average agent handles 30 leads; AI handles 1000+ simultaneously
- 3x higher visit booking rate with AI follow-up vs manual
- Multi-language support reaches 95% of Indian population

### How It Conquers the Market
1. **Language**: Only platform with native support for 11+ Indian languages
2. **AI Persuasion**: Trained specifically for real estate objection handling
3. **Cost**: One AI replaces 10 junior sales agents at 1/5th the cost
4. **Speed**: Response in < 10 seconds vs hours for manual response
5. **24/7**: AI works nights, weekends, holidays

### How It Differs From Competition
| Feature | Investo | Generic CRM | Other AI |
|---------|---------|-------------|----------|
| Indian Languages | 11+ | 1-2 | 3-4 |
| Real Estate Specific | Yes | No | Partial |
| WhatsApp Native | Yes | Plugin | Limited |
| Visit Booking AI | Yes | No | No |
| Multi-tenant SaaS | Yes | Some | No |
| Persuasion Engine | Yes | No | No |

---

## Version History
- v0.2.0 - Dynamic roles, onboarding wizard, OpenAI AI bot integration
- v0.1.0 - Initial specification and architecture

---

## 20. Dynamic Company Customization

### Why Dynamic?
Every real estate organization is different. A small broker may only need an admin + agents. A large developer may need operations, marketing, custom viewer roles. Investo lets each org configure exactly what they need during onboarding.

### What's Dynamic Per Organization

| Feature | Description | Default |
|---------|-------------|---------|
| **Roles** | Company admin creates only the roles they need | company_admin + sales_agent |
| **Permissions** | Each custom role gets specific feature access | Full access for admin |
| **Feature Flags** | Enable/disable modules (AI bot, analytics, visit scheduling, etc.) | All enabled on plan |
| **AI Configuration** | Tone, languages, persuasion level, FAQ, working hours | Friendly, English, level 5 |
| **Branding** | Company name, logo, primary color | Default Investo |
| **Notification Preferences** | Which events trigger notifications | All enabled |
| **Working Hours** | When AI bot is active | 9 AM - 9 PM IST |
| **Lead Assignment** | Round-robin, least-loaded, or manual | Round-robin |

### Onboarding Flow

```
Step 1: Company Profile
  → Name, slug, WhatsApp number, logo, primary color

Step 2: Select Roles
  → Choose from: company_admin, sales_agent, operations, viewer, marketing, custom
  → For each role: toggle permissions (leads, properties, visits, analytics, AI, audit)

Step 3: Enable Features
  → AI WhatsApp Bot (on/off)
  → Analytics Dashboard (on/off)
  → Visit Scheduling (on/off)
  → Notifications (on/off)
  → Agent Management (on/off)
  → Conversation Center (on/off)

Step 4: AI Configuration (if AI enabled)
  → Business name, focus areas, tone, persuasion level
  → Working hours, languages, FAQ
  → Property matching preferences

Step 5: Invite Team
  → Add users with selected roles
  → Send invitation emails

Step 6: Complete
  → Onboarding marked complete
  → Redirect to dashboard
```

### Database Additions

```sql
-- Custom roles per company
company_roles:
  id UUID PK
  company_id UUID FK → companies
  role_name VARCHAR(50) -- e.g., "marketing_head", "branch_manager"
  display_name VARCHAR(100)
  permissions JSONB -- { leads: ["read","update"], properties: ["read"], ... }
  is_default BOOLEAN -- true for system roles (admin, agent)
  created_at, updated_at

-- Feature flags per company
company_features:
  id UUID PK
  company_id UUID FK → companies
  feature_key VARCHAR(50) -- e.g., "ai_bot", "analytics", "visit_scheduling"
  enabled BOOLEAN
  config JSONB -- feature-specific config (e.g., { max_conversations: 100 })
  created_at, updated_at

-- Onboarding tracking
company_onboarding:
  id UUID PK
  company_id UUID FK → companies
  step_completed INT -- 0-6
  company_profile BOOLEAN
  roles_configured BOOLEAN
  features_selected BOOLEAN
  ai_configured BOOLEAN
  team_invited BOOLEAN
  completed_at TIMESTAMP
  created_at, updated_at
```

### API Endpoints

```
# Onboarding
POST   /api/onboarding/setup          -- Step 1: Company profile
POST   /api/onboarding/roles          -- Step 2: Configure roles
POST   /api/onboarding/features       -- Step 3: Feature toggles
POST   /api/onboarding/ai             -- Step 4: AI config
POST   /api/onboarding/invite         -- Step 5: Invite team
POST   /api/onboarding/complete       -- Step 6: Mark done
GET    /api/onboarding/status         -- Check progress

# Dynamic Roles (company_admin only)
GET    /api/roles                     -- List company roles
POST   /api/roles                     -- Create custom role
PUT    /api/roles/:id                 -- Update role permissions
DELETE /api/roles/:id                 -- Delete custom role (non-default only)

# Feature Flags (company_admin only)
GET    /api/features                  -- List company features
PUT    /api/features/:key             -- Toggle feature on/off
```

### Dynamic RBAC Resolution

```
1. User logs in → JWT contains { userId, companyId, role }
2. Request hits authorize() middleware
3. If role is system role (super_admin, company_admin) → use hardcoded permissions
4. If role is custom → query CompanyRole table → check permissions JSON
5. Additionally check: is the requested feature enabled for this company?
6. Both role permission AND feature flag must pass
```

---

## 21. AI Bot Integration (OpenAI)

### Configuration
```env
# .env
OPENAI_API_KEY=sk-...          # Required for AI bot
AI_PROVIDER=openai             # 'openai' or 'claude'
AI_MODEL=gpt-4o                # Model to use
```

### Trained Real Estate Layer
The AI system prompt is a filtered, trained layer that:
1. **Only discusses real estate** — rejects off-topic questions
2. **Uses company context** — knows the company's properties, locations, price ranges
3. **Matches properties** — queries DB for budget/location/type matches
4. **Persuades visits** — handles objections (too expensive, not interested, busy)
5. **Speaks customer's language** — detects and responds in same Indian language
6. **Respects working hours** — sends "we'll respond during business hours" outside hours

### Conversation Flow
```
Customer: "Hi, I'm looking for a 3BHK in Whitefield"
AI: [Detects English] → [Queries properties: type=apartment, bedrooms=3, area=Whitefield]
    → "Hi! 🏠 I found 2 great options in Whitefield:
       1. Royal Orchid - 3BHK, ₹85L-1.2Cr, Gym+Pool
       2. Green Valley - 3BHK, ₹75L-95L, Garden+Clubhouse
       Would you like to schedule a visit this weekend? 📅"
```

---

## 22. Stabilization Audit (Mar 2026)

### Key Gaps Found
- Frontend auth contract mismatch: frontend expects `{ success, data: { user, tokens } }` and snake_case token keys.
- Onboarding payload mismatch:
  - status response shape mismatch (`currentStep`, `completedSteps`, `companyData` expected by UI).
  - features payload mismatch (UI sends array of `{ key, enabled }`, backend expected object map).
  - invite payload mismatch (UI sends `invites`, backend expected `members` with passwords).
- Visit workflow messaging gap: visit events were not emitting notifications because notification hooks were imported but never called.
- Organization role/title assignment gap: onboarding invite could not map custom role names to `customRoleId`.

### What Was Implemented
- Auth responses aligned to frontend contract for `/api/auth/login`, `/api/auth/refresh`, `/api/auth/me`, `/api/auth/logout`.
- Onboarding now accepts both object and array feature payload formats.
- Onboarding status now returns UI-friendly shape.
- Onboarding invite now accepts `invites` or `members`, supports custom role titles per org, and returns generated temporary passwords when password is omitted.
- Visit routes now trigger notification engine on schedule, status change, and reschedule.

### Better Approach Going Forward
- Keep one versioned API contract file (OpenAPI/JSON schema) and enforce both FE/BE against it.
- Add integration tests for critical lifecycle flows:
  1) lead → visit scheduled → customer confirm → visit complete,
  2) org owner setup → role config → invite → employee login.
- Keep tenant safety as invariant in all query handlers (`companyId` mandatory in where clauses).

### Implementation Chunks (Execution Order)
- [ ] Chunk A: Contract parity (auth + onboarding + notification payload normalization)
- [ ] Chunk B: Visit lifecycle automation (customer confirmation handlers + calendar lock assertions)
- [ ] Chunk C: Org/team lifecycle (invites, role assignment, join flow, first-login password reset)
- [ ] Chunk D: Tenant isolation hardening (query audit + negative tests)
- [ ] Chunk E: E2E validation and rollout checklist

### Local Run Commands
Backend:
```bash
cd backend
npm install
npm run dev
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

Optional (from project root):
```bash
docker-compose up --build
```
