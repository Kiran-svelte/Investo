# ADR-002: BullMQ for WhatsApp inbound queue

Date: 2026-06-17  
Status: accepted

## Context

Meta WhatsApp webhooks must ACK quickly (<200 ms). Heavy buyer AI work cannot run synchronously in the webhook handler without risking timeouts, retries, and duplicate processing.

## Decision

Process inbound WhatsApp messages through an **async queue** (BullMQ on Redis) with idempotent job keys, dead-letter handling, and a circuit breaker around Meta outbound calls.

## Consequences

- Webhook ACK latency stays within SLO; worker scales independently.
- Requires Redis (Upstash) and a dedicated worker process in production.
- Operational complexity: DLQ replay, queue monitoring, and staging parity for Redis.

## Alternatives considered

- Synchronous processing in Express: simpler locally, fails under burst load.
- External managed queue only (SQS): viable at L5; added vendor surface before we needed it.
