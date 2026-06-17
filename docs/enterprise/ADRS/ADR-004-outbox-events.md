# ADR-004: Outbox pattern for domain events

Date: 2026-06-17  
Status: accepted

## Context

Downstream systems (webhooks, analytics warehouse, search index) need reliable notification when CRM data changes. Dual writes (DB + message bus) risk inconsistency on partial failure.

## Decision

Use a **transactional outbox table** written in the same database transaction as OLTP mutations. A worker publishes outbox rows to subscribers with at-least-once delivery and idempotent consumers.

## Consequences

- Event delivery aligns with committed database state.
- Adds outbox polling worker and replay tooling.
- Public signed webhooks (chunk 10) and warehouse CDC (chunk 09) consume the same pattern.

## Alternatives considered

- Change data capture only: good for analytics, weaker for application-level event payloads.
- Immediate fire-and-forget HTTP: simple, loses events on process crash.
