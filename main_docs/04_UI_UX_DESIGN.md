# Investo — UI/UX Design

| Field | Value |
|-------|-------|
| Document | UI/UX Design System & Specification |
| Scope | Responsive web dashboard (React) + WhatsApp conversational UX |
| Last updated | 2026-06-07 |

> Investo is **responsive web only** (no native app). Two surfaces: the **dashboard** (staff) and the **WhatsApp conversation** (buyers + staff copilot). This document covers the design system, layout, components, accessibility, and conversational UX.

---

## 1. Design principles

1. **Mobile-first, responsive** — explicit `<768px` collapse, safe-area aware, 44px touch targets.
2. **Calm, professional, trustworthy** — real estate is a high-trust purchase; clean editorial feel, no clutter.
3. **Role-aware** — each role sees only what it can act on; no dead UI.
4. **One source of clarity** — surface "what the AI knows" and "what the AI did" transparently.
5. **Fast** — dashboard load < 2 s; optimistic UI + WebSocket realtime updates.
6. **Localized** — full i18n; the dashboard supports a language selector, buyer chat is per-message multilingual.

---

## 2. Design tokens

### 2.1 Typography
| Token | Value | Use |
|-------|-------|-----|
| `font-sans` | Plus Jakarta Sans, system-ui | Body, UI |
| `font-display` | Instrument Serif, Georgia | Headlines, hero |

### 2.2 Color palette
| Group | Token | Hex |
|-------|-------|-----|
| Brand (teal) | `brand-500` | `#14b8a6` |
| | `brand-600` | `#0d9488` |
| | `brand-700` | `#0f766e` |
| | `brand-50` | `#f0fdfa` |
| Ink (text) | `ink-primary` | `#0f172a` |
| | `ink-secondary` | `#334155` |
| | `ink-muted` | `#64748b` |
| | `ink-faint` | `#94a3b8` |
| Surface | `surface-base` | `#ffffff` |
| | `surface-muted` | `#f8fafc` |
| | `surface-subtle` | `#f1f5f9` |
| | `surface-border` | `#e2e8f0` |
| | `surface-border-strong` | `#cbd5e1` |
| Sidebar | `sidebar` | `#0f172a` (dark slate) |
| | `sidebar-accent` | `#14b8a6` |

**Semantic status colors** (leads/visits): new/info → slate/blue; in-progress → amber; success/won → brand/green; lost/cancelled → red; AI messages → brand tint; agent messages → neutral; customer → white.

### 2.3 Radius, shadow, spacing
| Token | Value |
|-------|-------|
| `rounded-investo` | 8px |
| `rounded-investo-lg` | 12px |
| `shadow-investo` | `0 4px 12px rgba(15,23,42,0.08)` |
| `shadow-investo-lg` | `0 12px 32px rgba(15,23,42,0.12)` |
| Page max width | 1400px |
| Sidebar width | 260px (lg+) |
| Topbar height | 56px (h-14) |
| Breakpoint `xs` | 375px |

---

## 3. Layout system

### 3.1 App shell
```
┌───────────────────────────────────────────────┐
│ Topbar (h-14): logo · search · lang · notifs · │
│                 profile menu                    │
├──────────┬────────────────────────────────────┤
│ Sidebar  │  Main column (.investo-main-column) │
│ (260px,  │  .investo-page (max-w 1400, padded) │
│ dark)    │                                     │
│ nav by   │  Page content                       │
│ role     │                                     │
└──────────┴────────────────────────────────────┘
```
- **Desktop (lg+)**: persistent dark sidebar (`#0f172a`), content offset by `--investo-sidebar-w`.
- **Mobile (<lg)**: sidebar collapses to a drawer/overlay; bottom-anchored modals (`investo-modal-overlay` ends, `items-center` on sm+).
- Helper classes: `investo-page`, `investo-app-shell`, `investo-scroll-x`, `investo-touch-target`, `investo-topbar`.

### 3.2 Responsive rules
- Tables scroll horizontally on mobile (`investo-table-scroll`, min-width 640px) and reflow on sm+.
- Modals slide up from bottom on mobile, centered card on desktop.
- Touch targets ≥ 44×44px; safe-area padding on bottom.

---

## 4. Navigation by role

Enforced in `frontend/src/config/navigation.config.ts` (`RoleRoute` + nav filter). Capabilities via `getRoleCapabilities()`.

| Role | Landing | Visible pages |
|------|---------|---------------|
| **super_admin** | Companies | Companies, Audit logs, Settings |
| **company_admin** | Dashboard | Dashboard, Leads, Properties (+import), Conversations, Calendar, Agents, Analytics, AI settings, Billing, EMI, Notifications, Settings |
| **sales_agent** | Dashboard | Dashboard, Leads (create, no export), Properties, Conversations, Calendar, EMI, Notifications, Settings |
| **operations** | Calendar | Dashboard, Calendar, Leads (view), Properties (view), Notifications, Settings |
| **viewer** | Leads | Dashboard, Leads (view), Properties (view), Conversations (view), Analytics (view), Settings |

Buyers have **no dashboard account** — WhatsApp only.

---

## 5. Page inventory (dashboard)

| Page | Path | Purpose |
|------|------|---------|
| Landing | `/landing` | Public marketing page |
| Login / Forgot / Reset / Change password | `/auth/*` | Auth |
| Onboarding | `/onboarding` | 6-step wizard |
| Dashboard | `/` | Role KPIs, funnel, trends, leaderboard |
| Leads | `/leads` | CRM list + filters |
| Lead detail | `/leads/:id` | Profile, timeline, **lead_memory panel**, conversations, visits |
| Properties | `/properties` | Inventory list |
| Property projects board | `/properties` | Project grouping |
| Property import | `/properties/import` | Upload → extract → review → publish wizard |
| Conversations | `/conversations` | Chat center, realtime, takeover |
| Calendar | `/calendar` | Day/week/month visit scheduling |
| Copilot | `/copilot` | Staff AI chat (dashboard parity with WhatsApp) |
| AI action logs | `/ai-action-logs` | AI transparency / decision trace |
| Agents | `/agents` | Team management |
| Analytics | `/analytics` | Charts + export |
| AI settings | `/ai-settings` | Per-company AI config |
| Billing | `/billing` | Plan + invoices |
| EMI calculator | `/emi-calculator` | Loan breakdown |
| Notifications | `/notifications` | In-app notifications |
| Companies | `/companies` | Super admin tenant management |
| Audit logs | `/audit-logs` | Write trail |
| Error logs | `/error-logs` | Ops |
| Settings / Profile | `/settings`, `/profile` | User + company settings |
| Privacy policy | `/legal/privacy` | Compliance |

---

## 6. Core component patterns

| Component | Class / pattern | Notes |
|-----------|-----------------|-------|
| Primary button | brand-600 bg, white, rounded-lg | CTA |
| Secondary button | `investo-btn-secondary` | bordered, neutral |
| Ghost button | `investo-btn-ghost` | low-emphasis |
| Input/select | `investo-input` / `investo-select` | focus ring brand-500/20 |
| Card | `investo-card` | white, border, `shadow-investo` |
| Table | `investo-table-wrap` + `investo-table-head` | uppercase muted headers, horizontal scroll on mobile |
| Modal | `investo-modal-overlay` + `investo-modal-panel` | bottom-sheet on mobile |
| Dropdown | `investo-dropdown-panel` | animated in |
| Icon button | `investo-icon-btn` | 44px touch target |
| Status badge | semantic color pill | lead/visit status |

---

## 7. Key screen UX specs

### 7.1 Dashboard
- KPI cards (leads today, visits scheduled, deals closed, conversion rate, AI conversations active).
- Time filters: today / week / month / custom.
- Charts: lead funnel, daily leads trend, agent leaderboard.
- Auto-refresh; super admin variant aggregates across companies + server health.

### 7.2 Leads list & detail
- List: searchable, filter by status/agent/date, bulk assign, CSV export (role-gated), status badges.
- Detail: header (name, phone, status, assigned agent), timeline of activity, **"What AI knows" panel** rendering `lead_memory` (budget, projects discussed, summary, open questions), embedded conversation, visit history, action buttons (status FSM-aware — only valid transitions shown).

### 7.3 Conversations center
- Two-pane: conversation list (left) + transcript (right).
- Messages color-coded: customer (white/neutral), AI (brand tint), agent (secondary).
- Realtime new-message insertion (WebSocket); typing/presence indicators.
- **Takeover toggle** — clear visual state when `agent_active` (AI paused banner).
- Internal notes drawer.

### 7.4 Calendar
- Day/week/month toggle; visits as blocks colored by status.
- Create-visit modal: lead, property, agent, datetime; inline validation (no past, no double-book within 60 min).
- Conflict warnings surfaced before save.

### 7.5 Property import wizard
- Stepper: Upload → Extract (progress) → Review/Map → Publish.
- Confidence indicators on extracted fields; accept/edit/reject per field; unit editor for flat-level inventory.
- Bulk CSV section for mass import.
- Nothing customer-facing until published.

### 7.6 AI settings
- Sections: business profile, operating areas, tone (formal/friendly/casual), persuasion slider (1–10), working hours, FAQ knowledge, greeting template, languages, persona name, Never-Say-No conversion brain (offers, fractional/rent-to-own toggles, budget stretch %).

### 7.7 Copilot & AI action logs
- Copilot: WhatsApp-like chat panel in browser (same backend).
- AI action logs: chronological table (trigger, actor, action, resource, result, status, duration) — the "decision trace."

---

## 8. WhatsApp conversational UX (buyer)

The buyer never sees the dashboard; the WhatsApp thread *is* the UI.

### 8.1 Message design rules
- **One reply per message** — a single primary bubble (text or one interactive message), optionally plus media. No multi-bubble spam.
- **Buyer's language** — reply in the detected language; mirror Hinglish/mixed in dominant language.
- **Persona** — friendly assistant (default name "Riya"), warm and concise; never robotic openers, never re-welcomes mid-chat, never invents outages.
- **Grounded** — only states facts present in approved inventory (price, RERA, amenities).

### 8.2 Interactive elements
| Element | When |
|---------|------|
| Quick-reply buttons (Book Visit / Property Details / Call Me / EMI) | After shortlisting a property |
| Time-slot buttons | During `visit_booking` |
| List picker | Choosing among multiple properties |
| Location pin | Sharing property location |
| Media (images, brochure PDF, floor plan, price list) | Stage-appropriate, from approved assets |

Buttons are suppressed for bare greetings and during pure `visit_booking` confirmation to avoid clutter (`buyerButtonPolicy.service.ts`).

### 8.3 Conversational tone by stage
| Stage | Tone / intent |
|-------|---------------|
| rapport | Warm greeting, light qualification |
| qualify | Curious, gathers budget/location/type |
| shortlist | Confident, presents 2–3 matches with value framing |
| objection_handling | Empathetic, offers alternatives (never "no") |
| commitment | Encouraging, low-commitment "just come see" |
| visit_booking | Focused, only confirms date/time/property |
| confirmation | Reassuring, sets expectations + reminders |
| human_escalated | Hands off gracefully ("connecting you with our expert") |

---

## 9. Internationalization (i18n)

- Library: `i18next` + `react-i18next` + browser language detector.
- All dashboard strings externalized; language selector in topbar.
- Supported: English, Hindi, Kannada, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia.
- No RTL needed (no RTL Indian languages). Default English.
- Buyer WhatsApp language is dynamic per-message (independent of dashboard locale).

---

## 10. Accessibility

- Touch targets ≥ 44×44px (`investo-touch-target`).
- Focus-visible rings (brand-600 outline) on interactive elements.
- Color contrast: ink-primary on surface-base meets WCAG AA.
- Semantic HTML + ARIA on modals, dropdowns, tables.
- Keyboard navigable nav, forms, and dialogs.
- `prefers-reduced-motion` respected for animations (motion library).

---

## 11. Motion & feedback

- Subtle entrance animations (dropdowns `investo-dropdown-in`, page enters).
- Optimistic UI for status changes; toast/notification feedback.
- WebSocket-driven live updates in conversations and dashboard counters.
- Loading skeletons for data-heavy pages.

---

## 12. Empty, error & loading states

| State | Pattern |
|-------|---------|
| Empty list | Friendly illustration + primary CTA (e.g., "Add your first property") |
| Loading | Skeleton rows / spinners |
| Error | Inline message + retry; never leak internal errors |
| Permission denied | Hidden in nav + guarded route redirect |
| Offline/realtime drop | Reconnect indicator |
