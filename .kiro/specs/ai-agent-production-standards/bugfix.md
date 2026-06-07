# Bugfix Requirements Document

## Introduction

The AI agent copilot for real estate CRM must comply with production standards defined in `backend/docs/ai.md`. Currently, the agent implementation in `agent-intent-orchestrator.service.ts` and `agent-router.service.ts` violates six core principles: Stateful, Proactive, Contextual, Idempotent, Graceful errors, and Transparent. These violations result in poor user experience, duplicate actions, lost context, and generic error messages that don't help users recover.

This bugfix addresses gaps between the current implementation and the production standard documented in ai.md sections 1-8.

## Bug Analysis

### Current Behavior (Defect)

#### 1. Generic Error Messages

1.1 WHEN the agent encounters any error during intent execution THEN the system returns "I hit an issue processing that request" with no specifics about what failed or how to fix it

1.2 WHEN the LLM fails to generate a response THEN the system returns a fallback message that lists all possible commands rather than explaining what specific error occurred

1.3 WHEN calendar API or external service fails THEN the system returns the same generic error as validation failures, providing no context about whether the issue is temporary or user-correctable

1.4 WHEN parameter validation fails in tool execution THEN the error message doesn't indicate which specific field is missing or invalid

#### 2. Missing Conversation Memory

2.1 WHEN a user books a visit for "Lake Vista" and later asks "when is my visit" THEN the system doesn't automatically retrieve the scheduled visit from conversation context

2.2 WHEN a user says "I can't make it Saturday" without specifying which visit THEN the system doesn't use conversation history to identify which visit needs rescheduling

2.3 WHEN a user refers to a lead by "that customer" or "the last one" THEN the system doesn't resolve the reference from conversation memory

2.4 WHEN multiple conversations happen across days THEN the system loses context about preferred properties, budget ranges, and past interactions mentioned in earlier messages

2.5 WHEN a user sends follow-up questions about a property or lead THEN the system requires the user to re-specify the entity name instead of using session context

#### 3. No Idempotency Protection

3.1 WHEN a user sends "book a visit for Saturday 4 PM" twice within seconds THEN the system creates two separate visit records for the same time slot

3.2 WHEN a user rapidly taps "confirm visit" multiple times due to network lag THEN the system sends duplicate confirmation messages

3.3 WHEN a workflow execution fails mid-transaction THEN partial state changes persist without rollback, leaving the database inconsistent

3.4 WHEN the same action message is received while the first execution is still in progress THEN both executions proceed in parallel instead of deduplicating

#### 4. Incomplete Intent Understanding

4.1 WHEN a user says "Can't make it" without context THEN the system doesn't recognize this as a reschedule intent

4.2 WHEN a user says "Postpone it" or "Push to Sunday" THEN the system doesn't map these variations to the reschedule_visit intent

4.3 WHEN a user says "I'm sick today" referring to a scheduled visit THEN the system doesn't understand this implies rescheduling

4.4 WHEN a user says "I'll come later" THEN the system doesn't prompt for a specific new time as a reschedule workflow

4.5 WHEN a user makes typos like "viste" or "vist" THEN the system fails to recognize the visit-related intent

4.6 WHEN a user says "What time am I coming?" or "My visit details" THEN the system doesn't recognize these as variations of view_upcoming_visits intent

#### 5. No Proactive Behavior

5.1 WHEN a visit is scheduled for tomorrow and user hasn't confirmed 24 hours before THEN the system doesn't send a proactive reminder asking for confirmation

5.2 WHEN a visit time passes and no outcome is recorded THEN the system doesn't prompt the agent to mark attendance

5.3 WHEN a user asks a vague question like "later" for rescheduling THEN the system doesn't proactively suggest available time slots

5.4 WHEN a user seems frustrated after multiple failed attempts THEN the system doesn't offer to connect with a human agent

5.5 WHEN a lead goes inactive for several days after a visit THEN the system doesn't trigger re-engagement workflows

#### 6. Inconsistent State Management

6.1 WHEN multiple visits exist for the same lead on the same day THEN the "confirm visit" command doesn't disambiguate which visit to confirm

6.2 WHEN a visit is cancelled but later referenced THEN the system doesn't prevent operations on the cancelled visit

6.3 WHEN visit status changes happen THEN the statusHistory array isn't updated with timestamps and reasons

6.4 WHEN concurrent updates happen to the same visit record THEN race conditions can result in lost status updates

6.5 WHEN a visit exists in both the database and calendar system THEN state inconsistencies aren't detected or reconciled

### Expected Behavior (Correct)

#### 1. Structured Error Messages

2.1 WHEN the agent encounters a validation error THEN the system SHALL return a message specifying which field is invalid and what format is expected (e.g., "I need more details to run scheduleVisit: scheduledAt: Invalid date format. Use YYYY-MM-DD")

2.2 WHEN an external service (calendar, CRM) is temporarily unavailable THEN the system SHALL return a message indicating the service name, that it's temporary, and offer to queue the request (e.g., "Calendar service is temporarily slow. I've queued your visit request and will confirm within 2 minutes")

2.3 WHEN no matching record is found for a user query THEN the system SHALL suggest actionable next steps (e.g., "You don't have any upcoming visits. Would you like to book one?")

2.4 WHEN ambiguous context prevents action THEN the system SHALL ask clarifying questions with options (e.g., "Which Saturday do you mean? June 10 or June 17?")

2.5 WHEN an LLM provider fails THEN the system SHALL fall back to deterministic responses for known commands and log the provider failure for monitoring

2.6 WHEN rate limiting is triggered THEN the system SHALL explain the throttling and when the user can retry (e.g., "You're sending messages very quickly. Please wait 30 seconds before trying again")

#### 2. Persistent Conversation Context

2.7 WHEN a user mentions a project name THEN the system SHALL store it in session memory under `interested_project` for future reference

2.8 WHEN a user schedules a visit THEN the system SHALL store the visitId, project, date, time, and agent in `upcoming_visits` array within clientMemory

2.9 WHEN a user refers to "my visit" or "that visit" THEN the system SHALL resolve the reference using sessionLeadId and sessionVisitId from clientMemory

2.10 WHEN a user asks "when is my visit?" THEN the system SHALL retrieve scheduled visits from `upcoming_visits` in memory without requiring re-specification

2.11 WHEN a conversation spans multiple days THEN the system SHALL maintain memory.conversation_summary and memory.last_interaction timestamp

2.12 WHEN a user completes a visit THEN the system SHALL move the visit from `upcoming_visits` to `past_visits` array in memory

#### 3. Idempotent Action Execution

2.13 WHEN the same action message is received within 60 seconds THEN the system SHALL generate an idempotency key from (leadId, intent, timestamp_minute) and return cached result if key exists

2.14 WHEN a visit booking is initiated THEN the system SHALL check for existing visits at the same (leadId, date, time) before creating a new record

2.15 WHEN a workflow execution begins THEN the system SHALL wrap all state changes in a database transaction with rollback on failure

2.16 WHEN confirmation messages are sent THEN the system SHALL track message IDs to prevent duplicate sends within the same workflow execution

2.17 WHEN concurrent duplicate requests arrive THEN the system SHALL use distributed locking or atomic operations to ensure only one execution proceeds

#### 4. Comprehensive Intent Recognition

2.18 WHEN a user says "Can't make it", "Postpone it", "Push to [day]", "I'm sick", or "I'll come later" THEN the system SHALL classify these as reschedule_visit intent

2.19 WHEN a user says "When is my visit?", "What time am I coming?", or "My visit details" THEN the system SHALL classify these as view_upcoming_visits intent

2.20 WHEN a user makes common typos like "viste", "vist", "schdule" THEN the system SHALL apply fuzzy matching to recognize the intended visit-related action

2.21 WHEN a user provides multi-intent messages like "Cancel Saturday and book Sunday" THEN the system SHALL decompose into sequential intents: cancel_visit followed by schedule_visit

2.22 WHEN a user provides ambiguous phrases like "later" THEN the system SHALL classify as reschedule_visit and include a clarification step in the workflow

#### 5. Proactive User Engagement

2.23 WHEN a visit is scheduled for tomorrow and remains unconfirmed 24 hours before THEN the system SHALL send a proactive reminder: "Reminder: You have a visit tomorrow at [time]. Please confirm if you're coming"

2.24 WHEN a visit time passes without status update THEN the system SHALL prompt the assigned agent: "[Lead name]'s visit was at [time]. Was the customer present?"

2.25 WHEN a user requests rescheduling with vague timing THEN the system SHALL proactively suggest 3 available slots: "When would work? I see Sunday at 11 AM, 2 PM, or Monday at 4 PM available"

2.26 WHEN a user fails the same action 3 times THEN the system SHALL offer human escalation: "I can connect you with a human agent immediately. Type 'TALK TO AGENT'"

2.27 WHEN a lead status is 'visited' but no follow-up note exists after 24 hours THEN the system SHALL prompt the agent: "Follow up with [lead name] - visited [project] yesterday. Add outcome note?"

#### 6. State Consistency Enforcement

2.28 WHEN multiple visits exist for the same lead on a given date THEN the system SHALL list all visits with project names and ask: "Which visit? You have Lake Vista (4 PM) and Sunset Heights (6 PM)"

2.29 WHEN a visit operation is attempted on a cancelled visit THEN the system SHALL reject with: "This visit was cancelled on [date]. Would you like to book a new one?"

2.30 WHEN a visit status changes THEN the system SHALL append to statusHistory array: { status, timestamp, triggeredBy, reason }

2.31 WHEN concurrent updates target the same visit THEN the system SHALL use optimistic locking (version field) and retry the conflicting operation with fresh data

2.32 WHEN a visit exists in both database and external calendar THEN the system SHALL validate calendarEventId linkage and log reconciliation errors for admin review

### Unchanged Behavior (Regression Prevention)

#### 3.1 Deterministic Fast Paths

3.1 WHEN a user sends a greeting like "hi" or "hello" THEN the system SHALL CONTINUE TO return buildCopilotWelcomeMessage without invoking the LLM

3.2 WHEN a user sends "visits today" or "visits tomorrow" THEN the system SHALL CONTINUE TO execute tryDeterministicAgentCrmReply before any LLM classification

3.3 WHEN the user's message matches known CRM query patterns THEN the system SHALL CONTINUE TO prioritize deterministic handlers over intent orchestration

#### 3.2 Intent Classification Pipeline

3.4 WHEN intent confidence is below 0.55 THEN the system SHALL CONTINUE TO fall through to deterministic CRM or agent graph invocation

3.5 WHEN intent is classified as 'unknown' THEN the system SHALL CONTINUE TO return null and defer to downstream handlers

3.6 WHEN DETERMINISTIC_DELEGATE_INTENTS are classified (list_leads_today, list_visits_today, etc.) THEN the system SHALL CONTINUE TO return null without execution

#### 3.3 LLM Fallback Chain

3.7 WHEN OpenAI API fails THEN the system SHALL CONTINUE TO fall back to Claude (Anthropic) API as first alternative

3.8 WHEN both OpenAI and Claude fail THEN the system SHALL CONTINUE TO fall back to Kimi (Moonshot) API as second alternative

3.9 WHEN all LLM providers fail THEN the system SHALL CONTINUE TO attempt deterministic CRM fallback before returning generic error

#### 3.4 Tool Execution

3.10 WHEN tool schema validation fails THEN the system SHALL CONTINUE TO return formatted error messages with field-specific issues using toolSchemaIssues()

3.11 WHEN tool execution succeeds THEN the system SHALL CONTINUE TO log agent actions with logAgentAction including duration, status, and result

3.12 WHEN leadId is resolved during tool execution THEN the system SHALL CONTINUE TO call setAgentSessionClientContext and syncLeadClientMemory

#### 3.5 Session Management

3.13 WHEN agent copilot messages are exchanged THEN the system SHALL CONTINUE TO record exchanges using recordAgentCopilotExchange when sessionId exists

3.14 WHEN getOrCreateThreadId is called THEN the system SHALL CONTINUE TO create or retrieve thread IDs for LangGraph state persistence

3.15 WHEN pending confirmation actions exist THEN the system SHALL CONTINUE TO check and resolve using checkAndResolvePendingConfirmation before processing new intents

#### 3.6 Response Formatting

3.16 WHEN successful tool execution returns text THEN the system SHALL CONTINUE TO send the result via sendWhatsAppResponse

3.17 WHEN agent copilot welcome is triggered THEN the system SHALL CONTINUE TO send quick action buttons via sendStaffCopilotQuickActions

3.18 WHEN LLM generates refusal messages for short generic inputs THEN the system SHALL CONTINUE TO replace with deterministic help menu
