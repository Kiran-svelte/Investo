# Investo — pages by role

Sidebar and URL access are enforced in `frontend/src/config/navigation.config.ts` (`RoleRoute` + nav filter).

## super_admin (platform)

| Page | Path |
|------|------|
| Companies | `/companies` |
| Audit logs | `/audit-logs` |
| Settings | `/settings` |

**Not shown:** Leads, properties, conversations, calendar, agents, analytics, AI settings, billing, EMI, notifications, tenant dashboard.

Login lands on **Companies**.

## company_admin (tenant owner)

| Page | Path |
|------|------|
| Dashboard | `/` |
| Leads | `/leads` |
| Properties + import | `/properties`, `/properties/import` |
| Conversations | `/conversations` |
| Calendar | `/calendar` |
| Agents | `/agents` |
| Analytics | `/analytics` |
| AI settings | `/ai-settings` |
| Billing | `/billing` |
| EMI calculator | `/emi-calculator` |
| Notifications | `/notifications` |
| Settings | `/settings` |

## sales_agent

| Page | Path |
|------|------|
| Dashboard | `/` |
| Leads (create, no export) | `/leads` |
| Properties | `/properties` |
| Conversations | `/conversations` |
| Calendar | `/calendar` |
| EMI calculator | `/emi-calculator` |
| Notifications | `/notifications` |
| Settings | `/settings` |

## operations

| Page | Path |
|------|------|
| Dashboard | `/` |
| Calendar | `/calendar` |
| Leads (view) | `/leads` |
| Properties (view) | `/properties` |
| Notifications | `/notifications` |
| Settings | `/settings` |

Login lands on **Calendar**.

## viewer (read-only)

| Page | Path |
|------|------|
| Dashboard | `/` |
| Leads (view) | `/leads` |
| Properties (view) | `/properties` |
| Conversations (view) | `/conversations` |
| Analytics (view) | `/analytics` |
| Settings | `/settings` |

No create/export/admin actions (UI uses `getRoleCapabilities()`).

Login lands on **Leads**.

## Buyers (WhatsApp)

No dashboard account. Inbound WhatsApp only — see `docs/ZERO_UI_BUYER.md`.

## Property uploads

Only **company_admin** — see `docs/PROPERTY_UPLOAD.md`.
