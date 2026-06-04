# WhatsApp AI stack — honest proof & how to feel it

## Your OpenAI key (tested 2026-06-04)

| Test | Result |
|------|--------|
| `POST /v1/chat/completions` (gpt-4o-mini) | **Works** — model replied `OK!` |
| Production server `OPENAI_API_KEY` | **Works** — health: `OpenAI API key valid and embeddings reachable` |

**Revoke the key you pasted in chat immediately** — it was exposed in plain text.

To test another key locally without committing it:

```powershell
$env:OPENAI_API_KEY = 'sk-...'
.\scripts\prove-full-ai-stack.ps1
```

---

## Why it felt like “nothing works”

Several features were **implemented in code but not wired** to the live message path:

| Feature | Before | After this fix |
|---------|--------|----------------|
| Quick-reply buttons after buyer AI | `sendContextualQuickReplies` existed, **never called** | Called after every AI turn (CHUNK 7) |
| Staff copilot shortcuts | Text only | **3 CRM buttons** after each staff reply |
| Broken `whatsapp.service.ts` JSDoc | Broke TS / class methods | Fixed syntax at `sendPropertyImages` |
| Health “proof” | DB + OpenAI only | Adds `ai_capabilities` map on `/api/health` |

**Provider note:** If your company uses **GreenAPI**, Meta-only UI (native buttons/lists) becomes a **numbered text menu** — still interactive, not broken.

---

## What is wired today (buyer)

1. **RAG memory per chat** — `ai.service.ts` syncs lead memory + searches `client_memory_chunks` + property knowledge embeddings on each buyer message.
2. **Workflow engine** — `tryRunBuyerWorkflow` for price / brochure / availability / amenities before full LLM.
3. **LLM conversation** — state machine + polished outbound text.
4. **Interactive list** — property filter → dropdown list (`sendInteractiveList`).
5. **Quick-reply buttons** — stage-based (2 BHK, Book Visit, EMI, etc.) after AI text.
6. **Media** — brochures, property images when stage allows.
7. **Location / contact / reactions / flows** — methods exist; location & list work from button IDs; Flow needs Meta Flow ID in settings.

## What is wired today (staff copilot)

1. Deterministic CRM (visits today, status update, etc.)
2. **15 workflows** + intent orchestrator + LangGraph with **client memory RAG**
3. **Shortcut buttons**: Visits today | New leads today | Visits tomorrow (titles sent as next message)

---

## Automated proof commands

```powershell
# Full local + production smoke
.\scripts\prove-full-ai-stack.ps1

# 49 scenario tests (15 workflows × phrases + execution)
cd backend
npm test -- workflow-scenario-matrix

# Production webhooks (no login required)
.\scripts\verify-workflow-scenarios-production.ps1
```

Latest local bundle: **79+ unit tests** across intent, workflow, RAG, visit mutation, router.

---

## How to see it on a real phone (100% feel test)

1. Use a phone number **not** registered as staff in Investo.
2. WhatsApp your company’s buyer line (Geeky / configured WABA).
3. Send: `Hi, looking for 3BHK in Whitefield under 80L`
4. You should get:
   - AI text reply
   - Then **buttons** (Meta) or **numbered menu** (GreenAPI)
5. Tap **2 BHK** / **Book Visit** — list or booking flow continues.
6. For staff: message from a **sales_agent** phone → answer + **Visits today / New leads today / Visits tomorrow** shortcuts.

---

## Deploy to see `ai_capabilities` on production health

Push backend and redeploy `investo-backend-v2`, then:

```powershell
(Invoke-RestMethod https://investo-backend-v2.onrender.com/api/health).ai_capabilities
```
