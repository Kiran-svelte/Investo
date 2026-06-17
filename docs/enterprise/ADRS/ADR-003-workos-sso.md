# ADR-003: WorkOS for enterprise SSO

Date: 2026-06-17  
Status: accepted

## Context

Enterprise agency customers expect SAML/OIDC single sign-on for company admins. Building and maintaining IdP integrations in-house is slow and security-sensitive.

## Decision

Integrate **WorkOS** (or compatible OIDC/SAML broker) behind feature flags (`FEATURE_SSO`) with tenant-scoped identity settings and SCIM provisioning as a follow-on path.

## Consequences

- Faster time-to-market for SSO without owning SAML edge cases.
- Vendor dependency and per-connection configuration in staging/prod.
- MFA remains a separate enforced layer (`FEATURE_MFA`) for defense in depth.

## Alternatives considered

- Auth0 / Clerk: strong products; WorkOS chosen for B2B SSO + SCIM positioning.
- Self-hosted Keycloak: full control, higher ops burden for a small platform team.
