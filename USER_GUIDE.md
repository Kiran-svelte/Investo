# INVESTO - User Setup Guide & FAQs

## 🚀 HOW TO GET STARTED - COMPLETE FLOW

---

## 1️⃣ SUPER ADMIN CREATES COMPANY

**Who**: Super Admin (admin@investo.in)  
**When**: First time setup for new client

### Steps:
1. Login at http://localhost:3000 with `admin@investo.in / admin@123`
2. Click **Companies** in sidebar
3. Click **Create Company** button
4. Fill in:
   - **Company Name**: "XYZ Realty"
   - **Slug**: "xyz-realty" (must be unique, URL-friendly)
   - **WhatsApp Phone**: "+919876543210" (must be unique, include country code)
   - **Plan**: Select from dropdown (Starter/Growth/Enterprise)
5. Click **Save**

**What Happens**:
- Company created in database
- **WhatsApp number stored** (this is the number customers will message)
- Company gets default status: 'active'
- Company admin account needs to be created next

---

## 2️⃣ SUPER ADMIN CREATES COMPANY ADMIN

**Who**: Super Admin  
**When**: Right after company creation

### Steps:
1. Still logged in as Super Admin
2. Click **Agents** in sidebar
3. Click **Add User/Agent** button
4. Fill in:
   - **Name**: "Rajesh Kumar"
   - **Email**: "rajesh@xyzrealty.in"
   - **Password**: "admin@123" (or custom)
   - **Role**: Select **Company Admin**
   - **Company**: Select "XYZ Realty" from dropdown
5. Click **Save**

**What Happens**:
- Company admin user created
- Password is hashed with bcrypt (12 rounds)
- User can now login with those credentials
- **Onboarding status**: 0 steps completed

---

## 3️⃣ COMPANY ADMIN ONBOARDING (6 STEPS)

**Who**: Company Admin (rajesh@xyzrealty.in)  
**When**: First login

### Login:
1. Go to http://localhost:3000
2. Login: `rajesh@xyzrealty.in / admin@123`
3. **System will AUTO-REDIRECT to /onboarding** (because 0 steps completed)

### Step 1: Company Profile
- Business name
- Description
- Primary color (branding)
- WhatsApp phone (pre-filled, can edit)

### Step 2: Roles Configuration
- View default roles (super_admin, company_admin, sales_agent, operations, viewer)
- Add custom roles if needed (e.g., "Senior Sales Manager")
- Configure permissions for each role

### Step 3: Feature Selection
**Select which features to enable**:
- ✅ AI Bot (WhatsApp automation)
- ✅ Visit Scheduling
- ✅ Analytics Dashboard
- ✅ Conversation Center
- ✅ Lead Automation
- ✅ Notifications
- ✅ Audit Logs
- ✅ CSV Export
- ✅ Advanced Reporting
- ✅ Multi-language Support

### Step 4: AI Configuration
**Configure WhatsApp AI behavior**:
- Business name (e.g., "XYZ Realty")
- Response tone: Formal / Friendly / Casual
- Business description
- Operating locations (Mumbai, Pune, Bangalore)
- Budget ranges (Min: ₹50L, Max: ₹2Cr)
- Default language: English (or Hindi/Kannada/etc.)
- Working hours: 9:00 AM - 6:00 PM
- Persuasion level: 1-10 (how aggressive AI is in booking visits)
- FAQ Knowledge Base (add common Q&A)

### Step 5: Team Invitation
**Invite sales agents and other team members**:
- Add rows with:
  - Name: "Priya Sharma"
  - Email: "priya@xyzrealty.in"
  - Role: sales_agent

**⚠️ IMPORTANT - DEFAULT PASSWORD**:
- **All invited users get password**: `Welcome@123`
- **Display message shows**: "Invited members will receive a default password (Welcome@123) and be prompted to change it on first login."
- **How agents login**: They use their email + `Welcome@123`
- **Security**: They should change password after first login

### Step 6: Complete
- Review summary
- Click **Complete Onboarding**
- **System redirects to Dashboard**

**What Happens After Onboarding**:
- Company onboarding status: all 6 steps completed
- User can now access full dashboard
- AI is configured and ready
- Team members can login

---

## 4️⃣ CONNECT WHATSAPP TO INVESTO

**Who**: Company Admin (or technical team)  
**When**: After onboarding, before customers start messaging

### ⚠️ CURRENT STATUS: NOT DOCUMENTED IN UI

**The system is ready but needs Meta WhatsApp Business API setup.**

### What You Need:

#### A. Meta WhatsApp Business Account
1. Go to https://business.facebook.com
2. Create or login to Business Account
3. Go to **WhatsApp Manager**
4. Click **Add Phone Number**
5. Verify your business phone number (the one you entered during company creation)
6. Complete Meta's verification process

#### B. Get WhatsApp API Credentials
From Meta Business Manager, you need:
- **Phone Number ID** (provided by Meta after verification)
- **WhatsApp Business Account ID**
- **Access Token** (permanent token from Meta)

#### C. Configure Webhook in Meta
1. In Meta WhatsApp Manager → Configuration → Webhooks
2. Set **Callback URL**: `https://your-domain.com/api/webhook/whatsapp`
   - For local testing: Use ngrok or similar tunnel
   - For production: Your deployed server URL
3. Set **Verify Token**: (any secret string, e.g., `investo_webhook_secret_123`)
4. Subscribe to events: `messages`

#### D. Configure Investo Backend
**Current system**: Reads from environment variables

**File**: `backend/.env`

Add these lines:
```env
# WhatsApp Configuration
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_from_meta
WHATSAPP_BUSINESS_ACCOUNT_ID=your_account_id_from_meta
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token_from_meta
WHATSAPP_VERIFY_TOKEN=investo_webhook_secret_123
```

Restart backend server after adding these.

### Testing WhatsApp Connection:
1. Send a WhatsApp message to your business number
2. Check backend logs: Should see "WhatsApp webhook received"
3. Check database: New lead should be auto-created
4. AI should respond within 10 seconds

---

## 5️⃣ HOW AGENTS LOGIN & GET PASSWORDS

### Scenario 1: Agent Invited During Onboarding

**What company admin did**:
- Step 5 of onboarding
- Added: "Priya Sharma" / priya@xyzrealty.in / sales_agent
- Clicked Complete

**What agent receives**:
- ❌ **NO EMAIL IS SENT** (current implementation)
- ℹ️ Company admin must **manually communicate** credentials

**How agent logs in**:
1. Company admin tells agent:
   - Email: `priya@xyzrealty.in`
   - Password: `Welcome@123`
2. Agent goes to http://localhost:3000
3. Logs in with those credentials
4. **Should be prompted to change password** (feature not confirmed)

### Scenario 2: Super Admin Creates Agent

**Steps**:
1. Super Admin → Agents page → Add User
2. Fills in:
   - Name, Email, **Password** (custom), Role, **Company**
3. Super admin can set custom password (not default Welcome@123)

**How agent logs in**:
- Uses email + password set by super admin

---

## 6️⃣ DAILY USAGE - HOW IT WORKS

### For Company Admin:
1. **Monitor Dashboard**: See leads today, visits scheduled, conversion rate
2. **Manage Leads**: View all leads, assign to agents, update status
3. **Manage Properties**: Add new listings, update prices, upload images
4. **View Conversations**: See WhatsApp chats between AI/agents and customers
5. **Schedule Visits**: Book site visits, check calendar
6. **Analytics**: Track performance, lead sources, revenue

### For Sales Agents:
1. **My Leads**: See only leads assigned to them
2. **My Calendar**: See only their scheduled visits
3. **Conversations**: Take over from AI when customer requests human
4. **Update Lead Status**: new → contacted → visit_scheduled → visited → negotiation → closed_won/lost
5. **Log Visit Notes**: After site visit, mark as completed/no-show

### Automation (Happens Automatically):
- ✅ Customer messages WhatsApp → Lead auto-created → AI responds
- ✅ 24 hours before visit → WhatsApp reminder sent to customer
- ✅ 1 hour before visit → WhatsApp reminder sent to customer
- ✅ 15 minutes before visit → Notification sent to agent
- ✅ 48 hours no response → Follow-up message sent
- ✅ 7 days in negotiation → Follow-up message sent
- ✅ Midnight daily → Analytics aggregated

---

## 7️⃣ CUSTOMER JOURNEY (How Leads Flow)

### Step 1: Customer Messages WhatsApp
**Example**: "I want 3 BHK in Bangalore under 1 crore"

**What Happens**:
1. Message received at `/api/webhook/whatsapp`
2. System checks: Is phone number known?
   - ❌ No → Create new lead (status: 'new') + conversation
   - ✅ Yes → Add message to existing conversation
3. AI detects language (Kannada in this case)
4. AI responds in Kannada within 10 seconds
5. Lead assigned to agent (round-robin or least-loaded)
6. Notification sent to company admin: "New lead created"

### Step 2: AI Conversation
**AI Collects**:
- Budget: ₹1 crore
- Location: Bangalore
- Property type: 3 BHK apartment
- Timeline: Immediate / 3 months / 6 months

**AI Queries Database**:
```sql
SELECT * FROM properties 
WHERE company_id = 'xyz' 
  AND location_city = 'Bangalore' 
  AND bedrooms = 3 
  AND price_min <= 10000000 
  AND price_max >= 10000000
  AND status = 'available'
```

**AI Presents**:
- "Here are 3 properties matching your needs:"
- Property 1: Name, location, price, amenities
- Property 2: ...
- Property 3: ...

### Step 3: AI Books Visit
**AI Asks**: "Would you like to schedule a site visit?"  
**Customer**: "Yes, tomorrow 3pm"  

**System**:
1. Checks agent availability (no double-booking)
2. Creates visit record (status: 'scheduled')
3. Sends confirmation to customer
4. Sends notification to assigned agent
5. Sets up reminders (24h, 1h, 15min before)

### Step 4: Agent Completes Visit
**Agent**:
1. Receives 15-min reminder notification
2. Meets customer at site
3. After visit: Opens calendar → Marks visit as "completed"
4. Adds notes: "Customer liked the property, negotiating price"
5. Updates lead status: visited → negotiation

### Step 5: Follow-up
**System**:
- 48 hours after visit → Auto follow-up message
- 7 days in negotiation → Reminder to agent
- Agent closes deal → Updates status: closed_won

---

## 8️⃣ FAQs

### Q1: Where is the WhatsApp setup guide in the UI?
**A**: ❌ **NOT CURRENTLY IN UI**. Setup requires manual Meta WhatsApp Business API configuration (see Section 4 above).

**Recommendation**: Add a "WhatsApp Setup" page in Settings with step-by-step guide.

---

### Q2: Why didn't onboarding ask for agent passwords?
**A**: System uses **default password**: `Welcome@123` for all invited users during onboarding.

**Why**: Simplifies onboarding flow. Company admin doesn't need to remember multiple passwords.

**Security**: Agents should change password on first login (this feature should be enforced).

---

### Q3: How do agents get their login credentials?
**A**: **Company admin must manually communicate**:
- Email: what they entered in onboarding
- Password: `Welcome@123`

**No email is sent automatically** (email service not configured).

**Recommendation**: Add email invitation system that sends:
- "You've been invited to join XYZ Realty on Investo"
- "Your temporary password is: Welcome@123"
- "Login at: https://investo-app.com"
- "You'll be prompted to change password"

---

### Q4: Which role configures WhatsApp?
**A**: **Company Admin** during onboarding (Step 4: AI Configuration).

**What they configure**:
- AI behavior (tone, persuasion level)
- Business details
- Operating locations
- Budget ranges

**What they DON'T configure** (requires technical setup):
- WhatsApp API credentials (done in backend .env)
- Webhook URL (done in Meta Business Manager)

---

### Q5: Is there a guide for everything?
**A**: ❌ **NO USER-FACING GUIDES CURRENTLY**.

**What exists**:
- ✅ README.md (technical specification, 1000+ lines) - for developers
- ✅ CHECKLIST_FINAL.md (implementation status) - for developers
- ✅ This file (USER_GUIDE.md) - for users

**What's missing**:
- ❌ In-app help tooltips
- ❌ Video tutorials
- ❌ User documentation website
- ❌ Company admin handbook
- ❌ Agent training manual
- ❌ WhatsApp setup wizard

**Recommendation**: Add help system in UI:
- "?" icon next to each feature
- Tooltips on hover
- "Help Center" page with FAQs
- Video walkthrough links

---

### Q6: When does everything start working?
**A**: **After 3 steps**:
1. ✅ Super admin creates company + company admin
2. ✅ Company admin completes onboarding
3. ⚠️ **WhatsApp API configured** (requires Meta Business API setup)

**Until Step 3 is done**: 
- Dashboard works
- Manual lead creation works
- Agent management works
- Property management works
- **WhatsApp AI does NOT work** (no API connection)

---

### Q7: Can we test without WhatsApp?
**A**: ✅ **YES!**

**Manual lead creation**:
1. Company admin → Leads page
2. Click "Create Lead"
3. Fill in:
   - Customer name: "Test Customer"
   - Phone: "+919999999999"
   - Budget: ₹50L - ₹1Cr
   - Location: Bangalore
   - Status: new
   - Assigned agent: Select from dropdown
4. Click Save

**Manual conversation**:
1. Click on lead → View conversation
2. Agent can chat manually (not AI)

**Test AI responses** (without WhatsApp):
- Use Postman to send POST to `/api/webhook/whatsapp`
- Mock WhatsApp message format
- Check AI response in database

---

## 9️⃣ MISSING FEATURES (Recommendations)

### High Priority:
1. **Email Invitation System**
   - Send email when agent is invited
   - Include login link + temporary password
   - Track invitation status (sent/accepted/expired)

2. **WhatsApp Setup Wizard**
   - In-app guide for Meta Business API setup
   - Step-by-step with screenshots
   - Webhook URL auto-generated
   - Test connection button

3. **Password Change on First Login**
   - Force password change for users with default password
   - Strong password requirements
   - "Your password is weak" warnings

4. **In-App Help System**
   - Tooltips for all form fields
   - "?" help icons
   - Context-sensitive help
   - Video tutorials embedded

### Medium Priority:
5. **User Management Improvements**
   - "Resend invitation" button
   - "Reset password" link
   - Bulk user import (CSV)
   - Deactivate/reactivate users

6. **Company Settings Page**
   - Edit company profile after creation
   - Change WhatsApp number
   - Change plan
   - View billing history

7. **Agent Onboarding Checklist**
   - First login tutorial
   - "Getting Started" guide
   - Sample lead to practice with

---

## 🎯 QUICK REFERENCE

### Test Credentials:
| Role | Email | Password | Company |
|------|-------|----------|---------|
| Super Admin | admin@investo.in | admin@123 | Platform |
| Company Admin | admin@demorealty.in | demo@123 | Demo Realty |
| NEW Company Admin | admin@freshtest.in | test@123 | Fresh Test |
| Sales Agent | rahul@demorealty.in | demo@123 | Demo Realty |

### Default Passwords:
- **Onboarding invites**: `Welcome@123`
- **Manual creation**: Set by creator

### Key URLs:
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **Webhook**: http://localhost:3001/api/webhook/whatsapp

### WhatsApp Webhook Format:
```
POST /api/webhook/whatsapp
Headers:
  - X-Hub-Signature-256: (Meta signature)
Body:
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "919876543210",
          "text": { "body": "I want 3 BHK" }
        }]
      }
    }]
  }]
}
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-03-18  
**Status**: System 95% functional, WhatsApp requires external setup
