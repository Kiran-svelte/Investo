# Investo Partner Certification Program

Partner tiers for agencies, SIs, and regional resellers implementing Investo for customers.

## Levels

| Level | Requirements | Benefits |
|-------|--------------|----------|
| **Registered** | Complete 2-hour product training | Partner directory listing, sandbox tenant |
| **Certified** | Pass written exam + deploy 1 production tenant | Co-marketing badge, priority support queue |
| **Premier** | 5 live tenants, <2% support escalation rate | Release preview, joint case studies |

## Training curriculum (Registered)

1. Product north star — WhatsApp-first CRM for Indian real-estate agencies  
2. Tenant onboarding — WhatsApp WABA, property import, AI settings  
3. Enterprise modules — IAM, quotas, compliance, public API  
4. Support boundaries — impersonation policy, incident runbooks  
5. Handset proof — buyer UX regression checklist  

## Certification exam (Certified)

- 40 questions: tenancy, RBAC, WhatsApp webhook flow, DPDP basics  
- Passing score: 80%  
- Practical: deploy staging tenant with smoke + handset proof sign-off  

## Deployment checklist (Certified practical)

- [ ] Staging parity script passes (`npm run staging-env-diff` when configured)  
- [ ] `npm run smoke` green on target environment  
- [ ] Company admin MFA/SSO configured (if customer requires)  
- [ ] Property knowledge indexed for published listings  
- [ ] Buyer handset proof on Book Visit / View Listings / sold-property paths  

## Premier review (quarterly)

- Tenant count and active WhatsApp volume  
- Support ticket volume vs active tenants (escalation rate)  
- No open P0 incidents attributed to partner misconfiguration  

## Deliverables

| Asset | Location |
|-------|----------|
| Training deck | `docs/marketing/` (extend as needed) |
| Exam questionnaire | Internal Notion / LMS |
| Deployment checklist | This document § Deployment checklist |
| Partner badge assets | Request from product marketing |

## Contact

Platform team owns partner onboarding. Open an internal ticket with label `partner-certification`.
