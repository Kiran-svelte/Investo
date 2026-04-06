# ONBOARDING FLOW - COMPLETE ANALYSIS

**Date**: 2026-04-06  
**Analysis Framework**: 7-Point Systematic Review

---

## 1. UNDERSTANDING - What Am I Actually Trying to Solve?

### The Problem:
When a new company signs up to Investo CRM, they need a guided onboarding experience that:
- Collects company profile information
- Configures roles and permissions based on their team structure
- Selects which features they want to use
- Configures AI agent behavior for their business
- Invites team members
- Dynamically customizes the application based on their selections

### Current Assumptions:
1. **Only `company_admin` role gets onboarding** - Other roles (super_admin, sales_agent, operations, viewer) skip it
2. **Onboarding is mandatory** - Company admin cannot access dashboard until onboarding is complete
3. **Onboarding is one-time** - Once completed, user never sees it again (unless manually triggered)
4. **6-step linear flow** - Must complete steps in order
5. **Company settings persist** - Selections during onboarding customize the entire company experience

---

## 2. QUESTIONS & CLARIFICATIONS

### What Don't I Know That I Need to Know?

#### Q1: Does onboarding work for all roles or just company_admin?
**Answer**: Only `company_admin` role.
- **Source**: `frontend/src/App.tsx:64-70`
```typescript
// Super admin doesn't need onboarding
if (user?.role === 'super_admin') {
  setCheckingOnboarding(false);
  return;
}
// Company admin or first user - check onboarding status
if (user?.role === 'company_admin') {
  // Check onboarding status and redirect if incomplete
}
```

#### Q2: What happens if a sales_agent logs in for the first time?
**Answer**: They skip onboarding entirely and go straight to the dashboard.
- Sales agents are invited by company_admin during onboarding (Step 5)
- They don't set up the company - they inherit the config

#### Q3: Can onboarding be restarted or edited later?
**Answer**: Partially yes.
- Settings page allows editing company profile (Step 1)
- AI settings page allows editing AI config (Step 4)
- But full onboarding flow cannot be restarted

#### Q4: What if onboarding is abandoned mid-way?
**Answer**: User is blocked from dashboard.
- `OnboardingGuard` checks `completedSteps.includes(6)`
- If step 6 not completed, redirects to `/onboarding`
- User can resume from last completed step

### Edge Cases That Could Break This:

1. **Multi-company scenario**: 
   - If a user is in multiple companies, which company's onboarding do they see?
   - **Current**: User has single `company_id` - one company only

2. **Role changes during onboarding**:
   - What if admin demotes themselves to viewer mid-onboarding?
   - **Current**: No role change during onboarding

3. **Partial data loss**:
   - What if step 3 saves but step 2 fails?
   - **Current**: Each step is independent transaction

4. **Super admin creating first company**:
   - Does super_admin need onboarding when creating a company?
   - **Current**: Super admin skips onboarding entirely

---

## 3. SOLUTION ARCHITECTURE

### Core Components:

#### Backend (Express + Prisma)
```
/api/onboarding/
├── GET  /status          → Get current onboarding progress
├── POST /setup           → Step 1: Company profile
├── PUT  /setup           → Update company profile (from settings)
├── GET  /setup           → Get company profile
├── POST /roles           → Step 2: Configure roles
├── POST /features        → Step 3: Enable features
├── POST /ai              → Step 4: AI configuration
├── POST /invite          → Step 5: Invite team
└── POST /complete        → Step 6: Mark complete
```

**Database Tables**:
1. `CompanyOnboarding` - Tracks progress
   - `stepCompleted` (1-6)
   - `companyProfile` (boolean)
   - `rolesConfigured` (boolean)
   - `featuresSelected` (boolean)
   - `aiConfigured` (boolean)
   - `teamInvited` (boolean)
   - `completedAt` (timestamp)

2. `Company` - Stores profile
   - `name`, `whatsappPhone`, `settings` (JSON)

3. `CompanyRole` - Stores custom roles
   - `roleName`, `displayName`, `permissions` (JSON)

4. `CompanyFeature` - Stores feature toggles
   - `featureKey`, `enabled` (boolean)

5. `AiSetting` - Stores AI config
   - `businessName`, `responseTone`, `persuasionLevel`, etc.

#### Frontend (React + React Router)
```
OnboardingPage.tsx
├── Step 1: Company Setup
│   ├── Company name, description
│   ├── WhatsApp phone number
│   └── Primary brand color
├── Step 2: Role Configuration
│   ├── Select default roles (sales_agent, operations, viewer)
│   └── Create custom roles with permissions
├── Step 3: Feature Selection
│   ├── AI Bot, Lead Automation, Visit Scheduling
│   ├── Notifications, Agent Management
│   └── Analytics, Audit Logs, CSV Export
├── Step 4: AI Configuration
│   ├── Business description
│   ├── Operating locations, budget ranges
│   ├── Response tone, persuasion level
│   └── Greeting template, language
├── Step 5: Team Invitations
│   ├── Add team members
│   ├── Assign roles
│   └── Set passwords
└── Step 6: Complete
    └── Redirect to dashboard
```

**Route Guard**:
```typescript
// App.tsx lines 55-99
const OnboardingGuard: React.FC = () => {
  // For super_admin: Skip onboarding
  // For company_admin: Check if step 6 completed
  // If incomplete: Redirect to /onboarding
  // If complete: Allow dashboard access
}
```

### Data Flow:

```
1. User Sign-Up (company_admin)
   ↓
2. Login → JWT token issued
   ↓
3. Navigate to "/" (dashboard)
   ↓
4. OnboardingGuard checks:
   - GET /api/onboarding/status
   - Returns completedSteps: []
   ↓
5. Redirect to /onboarding
   ↓
6. Step 1: Company Setup
   - POST /api/onboarding/setup
   - Updates Company table
   - Sets stepCompleted = 1
   ↓
7. Step 2: Role Configuration
   - POST /api/onboarding/roles
   - Creates CompanyRole records
   - Sets stepCompleted = 2
   ↓
8. Step 3: Feature Selection
   - POST /api/onboarding/features
   - Creates CompanyFeature records
   - Sets stepCompleted = 3
   ↓
9. Step 4: AI Configuration
   - POST /api/onboarding/ai
   - Creates/Updates AiSetting
   - Sets stepCompleted = 4
   ↓
10. Step 5: Team Invitations
    - POST /api/onboarding/invite
    - Creates User records (via authService.register)
    - Sets stepCompleted = 5
    ↓
11. Step 6: Complete
    - POST /api/onboarding/complete
    - Sets completedAt = now()
    ↓
12. Redirect to dashboard
```

---

## 4. USER IMPACT

### How This Affects Different User Types:

#### 1. Super Admin (`super_admin`)
**Experience**: 
- ❌ **Never sees onboarding**
- ✅ Can access all companies
- ✅ Can create companies via API
- ❌ Cannot onboard companies through UI

**Use Case**: Platform administrator managing multiple companies

#### 2. Company Admin (`company_admin`)
**Experience**:
- ✅ **MUST complete onboarding**
- ✅ First login → redirected to onboarding
- ✅ Cannot access dashboard until complete
- ✅ Can edit settings later

**Flow**:
```
Sign Up → Login → Onboarding (blocked) → Complete → Dashboard (unlocked)
```

**What They Configure**:
1. Company profile (name, phone, branding)
2. Team roles (sales_agent, operations, custom roles)
3. Features (which modules to enable)
4. AI behavior (tone, language, greeting)
5. Team members (invite sales agents)

#### 3. Sales Agent (`sales_agent`)
**Experience**:
- ❌ **Skips onboarding**
- ✅ Invited by company_admin during Step 5
- ✅ Receives pre-configured workspace
- ✅ Restricted by role permissions

**Flow**:
```
Invited → Login → Dashboard (direct access)
```

**Inherits**:
- Company branding
- AI configuration
- Feature access (based on permissions)

#### 4. Operations / Viewer (`operations`, `viewer`)
**Experience**: Same as sales_agent
- ❌ Skips onboarding
- ✅ Inherits company configuration
- ✅ Limited permissions

### What Happens When Things Change?

#### Scenario 1: Admin Changes Company Name
- Updated via Settings page
- Reflects across all users in that company
- AI greeting updates with `{business_name}` placeholder

#### Scenario 2: Admin Disables a Feature
- Feature toggle updated in `CompanyFeature` table
- All users lose access to that feature
- Frontend `FeatureRoute` blocks access

#### Scenario 3: Admin Changes AI Tone
- Updated via AI Settings page
- Next WhatsApp message uses new tone
- Existing conversations retain old tone

#### Scenario 4: Admin Deletes a Custom Role
- Users with that role become "viewer" (fallback)
- Lose custom permissions

---

## 5. SCALABILITY & FUTURE

### How Does This Handle Growth?

#### Current Design Strengths:
✅ **Multi-tenant** - Each company has isolated onboarding
✅ **Feature flags** - Easy to enable/disable modules
✅ **Custom roles** - Flexible permission model
✅ **Resumable** - Can abandon and resume onboarding

#### Scalability Concerns:

1. **Feature Flag Explosion**:
   - Currently 10 features
   - What happens with 50+ features?
   - **Solution**: Category-based grouping

2. **Permission Matrix Complexity**:
   - Currently 5 resources × 4 actions = 20 permissions
   - What about nested resources (lead.notes, lead.visits)?
   - **Solution**: Hierarchical permission model

3. **Onboarding Step Limit**:
   - Currently 6 steps
   - What if we add billing, integrations, reporting config?
   - **Solution**: Optional steps or multi-phase onboarding

### How Do We Change Rules Later Without Rebuilding?

#### Current Flexibility:

1. **Add New Roles**:
   - Just add to `DEFAULT_ROLES` array
   - No code change needed

2. **Add New Features**:
   - Add to `CompanyFeature` table
   - Update `DEFAULT_FEATURES` in frontend

3. **Add New AI Settings**:
   - Add column to `AiSetting` table
   - Update `POST /api/onboarding/ai` handler

4. **Change Step Order**:
   - Update step numbers in `CompanyOnboarding`
   - Reorder frontend steps

#### Future-Proofing Needed:

1. **Conditional Steps**:
   - Show/hide steps based on company type
   - Example: SaaS vs Self-hosted onboarding

2. **Dynamic Step Insertion**:
   - Plugin-based onboarding
   - Third-party integrations can add steps

3. **Versioned Onboarding**:
   - Track which onboarding version was used
   - Migrate old companies to new flow

### What Technical Debt Might We Create?

#### Debt Item 1: Hardcoded Steps
**Problem**: Step numbers (1-6) are magic numbers  
**Impact**: Adding/removing steps breaks existing companies  
**Mitigation**: Use step names instead of numbers

#### Debt Item 2: Mixed Concerns
**Problem**: Settings page can edit onboarding data  
**Impact**: Unclear separation between onboarding and settings  
**Mitigation**: Dedicated onboarding edit mode

#### Debt Item 3: No Onboarding Audit Trail
**Problem**: Can't see who completed which step when  
**Impact**: Hard to debug abandoned onboardings  
**Mitigation**: Add `CompanyOnboardingLog` table

---

## 6. RISKS & MITIGATIONS

### What Could Go Wrong?

#### Risk 1: Incomplete Onboarding Blocks Access
**Scenario**: Admin completes Step 5, database fails, can't access dashboard  
**Impact**: Company is locked out  
**Probability**: Low (Prisma transactions)  
**Mitigation**:
- Add super_admin override to bypass onboarding
- Add `/api/onboarding/reset` endpoint
- Log onboarding failures for support team

#### Risk 2: Multiple Admins Onboarding Simultaneously
**Scenario**: Two company_admins complete onboarding at same time  
**Impact**: Race condition, duplicate data  
**Probability**: Low (single company_admin typically)  
**Mitigation**:
- Lock onboarding when first admin starts
- Use database constraints (unique indexes)
- Show "Onboarding in progress by [admin name]"

#### Risk 3: Default Roles Out of Sync
**Scenario**: Backend `DEFAULT_ROLES` differs from frontend  
**Impact**: Role selection UI shows wrong options  
**Probability**: Medium (manual sync required)  
**Mitigation**:
- `GET /api/onboarding/default-roles` endpoint
- Frontend fetches from API instead of hardcoding

#### Risk 4: Onboarding Never Completed
**Scenario**: Admin abandons onboarding, company inactive  
**Impact**: Wasted database records  
**Probability**: High (typical for SaaS)  
**Mitigation**:
- Email reminders "Complete your onboarding"
- Auto-expire inactive companies after 30 days
- Analytics: Track onboarding dropout rates

#### Risk 5: Breaking Changes to Onboarding Flow
**Scenario**: Add new required field in Step 1  
**Impact**: Existing incomplete onboardings break  
**Probability**: Medium (as product evolves)  
**Mitigation**:
- Versioned onboarding schemas
- Backward compatibility for old versions
- Data migration scripts

### How Do We Prevent or Recover?

#### Prevention Strategies:

1. **Validation at Every Step**:
   - Backend validates all inputs
   - Frontend shows clear error messages
   - Don't allow progression with invalid data

2. **Save Progress Automatically**:
   - Each step saves immediately
   - No "Save Draft" button needed
   - Uses `upsert` for idempotency

3. **Provide Help Context**:
   - Tooltips for each field
   - Example values
   - Link to documentation

4. **Allow Editing**:
   - Settings page shows onboarding data
   - Admin can fix mistakes later

#### Recovery Mechanisms:

1. **Support Dashboard**:
   - Internal tool to view onboarding status
   - Can manually mark steps complete
   - Can reset onboarding

2. **Onboarding Reset API**:
   ```sql
   DELETE FROM CompanyOnboarding WHERE companyId = ?;
   DELETE FROM CompanyRole WHERE companyId = ?;
   DELETE FROM CompanyFeature WHERE companyId = ?;
   ```

3. **Partial Completion**:
   - Allow skipping optional steps
   - Mark as "minimum viable onboarding"

---

## 7. IMPLEMENTATION PHASES

### What's MVP vs Future?

#### MVP (Current Implementation) ✅
- ✅ 6-step linear onboarding
- ✅ Company profile setup
- ✅ Role and feature selection
- ✅ AI configuration
- ✅ Team invitations
- ✅ Route guard blocking access
- ✅ Resume from last step
- ✅ Edit via Settings page

#### Phase 2: Enhanced UX 🔄
- [ ] Progress bar showing % complete
- [ ] Skip optional steps
- [ ] Onboarding tour/walkthrough
- [ ] Video tutorials per step
- [ ] Sample data (demo leads, properties)
- [ ] Preview mode (see dashboard before complete)

#### Phase 3: Advanced Features 📋
- [ ] Multi-phase onboarding (basic + advanced)
- [ ] Industry-specific templates (residential, commercial, luxury)
- [ ] Import from other CRMs
- [ ] Bulk team import (CSV)
- [ ] Custom branding upload (logo, colors)
- [ ] Integration setup (WhatsApp, Zapier, etc.)

#### Phase 4: Analytics & Optimization 📊
- [ ] Onboarding analytics dashboard
- [ ] A/B testing different flows
- [ ] Drop-off analysis
- [ ] Time-to-value metrics
- [ ] Onboarding score (completion quality)

### Dependency Order:

```
Phase 1 (MVP):
1. Database schema (CompanyOnboarding, etc.)
2. Backend API endpoints
3. Frontend onboarding page
4. Route guard
5. Settings integration

Phase 2:
1. Progress tracking UI
2. Skip logic
3. Demo data generation
4. Preview dashboard

Phase 3:
1. Template system
2. CSV import
3. File upload (logo)
4. Integration API

Phase 4:
1. Analytics tracking
2. Reporting dashboard
3. A/B testing framework
```

---

## ROLE-BASED ONBOARDING MATRIX

| Role | Sees Onboarding? | Can Skip? | Can Edit Later? | Purpose |
|------|------------------|-----------|-----------------|---------|
| `super_admin` | ❌ No | N/A | ✅ Via Companies API | Platform admin |
| `company_admin` | ✅ **Yes** | ❌ No | ✅ Via Settings | Company owner |
| `sales_agent` | ❌ No | N/A | ❌ No | Invited team member |
| `operations` | ❌ No | N/A | ❌ No | Invited team member |
| `viewer` | ❌ No | N/A | ❌ No | Read-only user |

---

## DYNAMIC BEHAVIOR BASED ON SELECTIONS

### 1. Role Selection (Step 2) Affects:
- **Dashboard**: Role counts in analytics
- **User Creation**: Available roles in dropdown
- **Permissions**: What each role can do
- **Onboarding Step 5**: Which roles to assign to team members

### 2. Feature Selection (Step 3) Affects:
- **Dashboard**: Which tiles/widgets appear
- **Sidebar**: Which menu items show
- **Routes**: Which pages are accessible
- **API**: Which endpoints are enabled

**Example**:
```typescript
// If ai_bot disabled during onboarding:
<Route element={<FeatureRoute featureKey="ai_bot" />}>
  <Route path="/ai-settings" element={<AISettingsPage />} />
</Route>
// → User sees "Feature not available" when trying to access
```

### 3. AI Configuration (Step 4) Affects:
- **WhatsApp Responses**: Tone, language, greeting
- **Property Suggestions**: Budget range filters
- **Working Hours**: When AI responds vs hands off to agent
- **FAQ Knowledge**: What AI knows about the business

### 4. Company Profile (Step 1) Affects:
- **Branding**: Primary color throughout app
- **WhatsApp**: Which phone number receives messages
- **AI Greeting**: `"Welcome to {business_name}"`
- **Dashboard Title**: Company name in header

---

## CURRENT STATUS: PRODUCTION READY ✅

### Onboarding Flow Implementation:
- ✅ Backend API: All 6 steps implemented
- ✅ Frontend UI: Full onboarding wizard
- ✅ Route Guard: Blocks incomplete onboarding
- ✅ Database: Schema supports all features
- ✅ Resume Support: Can abandon and continue
- ✅ Settings Integration: Can edit later

### Known Limitations:
- ⚠️ No onboarding analytics
- ⚠️ Cannot skip steps
- ⚠️ No multi-language support in onboarding UI
- ⚠️ No email notifications for abandoned onboarding
- ⚠️ No demo data pre-population

### Ready for Production Use: **YES**

---

**Generated**: 2026-04-06  
**Analyzed By**: GitHub Copilot CLI  
**Methodology**: Code review + API testing + Architecture analysis
