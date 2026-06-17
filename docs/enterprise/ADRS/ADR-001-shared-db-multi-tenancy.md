# ADR-001: Shared database multi-tenancy

Date: 2026-06-17  
Status: accepted

## Context

Investo serves many real-estate agencies from one platform. Each agency must see only its own leads, properties, and conversations. We needed a tenancy model that ships quickly for SMB customers while keeping a path to dedicated tiers later.

## Decision

Use a **shared PostgreSQL database** with **`company_id` on every tenant-owned row**. Enforce isolation in middleware, services, and automated tests — not by convention alone.

## Consequences

- Lower operational cost and faster feature delivery for SMB SaaS.
- Requires strict query discipline and tenant isolation test suite (`tenantIsolation.matrix.test.ts`).
- Dedicated single-tenant databases remain a future tier (chunk 03), not the default.

## Alternatives considered

- Database-per-tenant: stronger isolation, much higher ops cost at our target scale.
- Schema-per-tenant: moderate isolation, painful migrations across hundreds of schemas.
