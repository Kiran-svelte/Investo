# Investo AI Handset Matrix — §7 of AI_MASTER_REALITY_AND_A_PLUS_PLAN.md
# 12-scenario manual verification guide for Railway production.
#
# Usage:
#   .\scripts\verify-ai-handset-matrix.ps1 [-Base <url>] [-CompanyId <uuid>] [-BuyerPhone <phone>]
#
# Each scenario lists:
#   - The WhatsApp message to send manually from a real handset
#   - The DB query to verify the outcome
#   - The pass/fail criteria
#
# IMPORTANT: Run this AFTER deploying to Railway. All DB queries are READ-ONLY.
# Gate for A+: 12/12 prod handset PASS + npm test green.

param(
  [string]$Base        = 'https://investo-backend-production.up.railway.app',
  [string]$CompanyId   = 'e12e7540-8218-4b25-b427-ff8b800df116',
  [string]$BuyerPhone  = '<your-buyer-test-phone>',
  [string]$StaffPhone  = '<your-staff-test-phone>'
)

$ErrorActionPreference = 'Continue'

function Section($title) {
  Write-Host ''
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

function Scenario($num, $actor, $message, $passCriteria, $dbQuery) {
  Write-Host ''
  Write-Host "[$num] Actor: $actor" -ForegroundColor Yellow
  Write-Host "     Send:  $message"
  Write-Host "     Pass:  $passCriteria"
  if ($dbQuery) {
    Write-Host "     DB:    $dbQuery" -ForegroundColor DarkGray
  }
}

Write-Host '============================================================'
Write-Host ' Investo WhatsApp AI — Production Handset Matrix (§7)'
Write-Host " API: $Base"
Write-Host " Buyer phone: $BuyerPhone"
Write-Host " Staff phone: $StaffPhone"
Write-Host '============================================================'

# ── Pre-flight: health check ──────────────────────────────────────────
Section 'Pre-flight'
try {
  $h = Invoke-RestMethod -Uri "$Base/api/health/live" -TimeoutSec 30
  $ok = $h.status -eq 'ok'
  $mark = if ($ok) { '[PASS]' } else { '[FAIL]' }
  Write-Host "$mark Health live: $($h.status)"
} catch {
  Write-Host "[FAIL] Health live: $($_.Exception.Message)" -ForegroundColor Red
}

try {
  $r = Invoke-WebRequest -Uri "$Base/api/agent-action-logs" -UseBasicParsing -TimeoutSec 10
  $mark = if ($r.StatusCode -eq 401) { '[PASS]' } else { '[FAIL]' }
  Write-Host "$mark agent-action-logs route exists (expect 401): HTTP $($r.StatusCode)"
} catch {
  # 401 throws in PowerShell — that is the correct behaviour
  if ($_.Exception.Response.StatusCode.value__ -eq 401) {
    Write-Host '[PASS] agent-action-logs route exists (401 unauthenticated)'
  } else {
    Write-Host "[FAIL] agent-action-logs: $($_.Exception.Message)" -ForegroundColor Red
  }
}

# ── Buyer scenarios ───────────────────────────────────────────────────
Section 'Buyer WhatsApp (unknown phone) — send from: $BuyerPhone'

Scenario 1 'Buyer' `
  'Send brochure for [project name]' `
  'Brochure sent via WhatsApp; lead_memory.projectsDiscussed updated in DB' `
  "SELECT lead_memory->>'projectsDiscussed' FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))';"

Scenario 2 'Buyer' `
  'Book a visit for Saturday 4pm' `
  'One visit row created; confirmation sent; lead_memory.upcomingVisits updated' `
  "SELECT id, scheduled_at, status FROM visits WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))') ORDER BY created_at DESC LIMIT 3;"

Scenario 3 'Buyer' `
  'Book a visit for Saturday 4pm  [SEND SAME MESSAGE AGAIN with new WhatsApp message ID]' `
  'Idempotent: reply identical to scenario 2; still exactly ONE visit row for that slot' `
  "SELECT COUNT(*) FROM visits WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))') AND DATE(scheduled_at) = CURRENT_DATE + INTERVAL '6 days';"

Scenario 4 'Buyer (with active visit from #2)' `
  'Push my appointment to next Sunday' `
  'Reschedule workflow triggers (not schedule_visit); one visit row rescheduled; no duplicate' `
  "SELECT id, scheduled_at, status FROM visits WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))') ORDER BY updated_at DESC LIMIT 1;"

Scenario 5 'Buyer (after scenario 1 budget mention)' `
  "What's my budget preference?" `
  'AI answers from lead_memory without asking again; no re-ask' `
  "SELECT lead_memory->'budget' FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))';"

Scenario 6 'Buyer' `
  'When is my visit?' `
  'Deterministic DB reply with visit date; no LLM hallucination' `
  "SELECT scheduled_at, status FROM visits WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))') AND status IN ('scheduled','confirmed') ORDER BY scheduled_at ASC LIMIT 1;"

# ── Staff scenarios ───────────────────────────────────────────────────
Section 'Staff WhatsApp Copilot — send from: $StaffPhone'

Scenario 7 'Staff (sales_agent)' `
  'Visits today' `
  'Deterministic list of today IST visits for that agent; no crash' `
  "SELECT COUNT(*) FROM visits v JOIN users u ON v.agent_id = u.id WHERE u.phone LIKE '%$($StaffPhone.Substring([Math]::Max(0,$StaffPhone.Length-10)))' AND DATE(v.scheduled_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata';"

Scenario 8 'Staff' `
  'Update lead [name] status to visited' `
  'Lead status updated in DB; action log entry created in agent_action_logs' `
  "SELECT action, status, created_at FROM agent_action_logs WHERE company_id = '$CompanyId' AND action LIKE '%update%status%' ORDER BY created_at DESC LIMIT 3;"

Scenario 9 'Staff (with AGENT_AI_LLM_ENABLED=false kill switch active)' `
  'Visits today' `
  'Deterministic CRM reply still works; no LLM crash; copilot degraded gracefully' `
  "-- No DB query; verify response text contains today's visit count without LLM error"

Scenario 10 'Admin (browser)' `
  '[Open dashboard] Navigate to /dashboard/ai-action-logs' `
  'Page loads; recent AI actions visible including workflow_clarification rows if any occurred' `
  "SELECT action, status, created_at FROM agent_action_logs WHERE company_id = '$CompanyId' ORDER BY created_at DESC LIMIT 20;"

# ── System / admin scenarios ──────────────────────────────────────────
Section 'System / Admin scenarios'

Scenario 11 'System (inject failure)' `
  '[Dev only] In a test tenant: trigger a bookVisit then inject a send failure after it commits' `
  'visit row stays but tagged needs_reconciliation; admin notified within 5 min; visible in action logs' `
  "SELECT id, status, failed_step FROM workflow_run_records WHERE company_id = '$CompanyId' AND status = 'needs_reconciliation' ORDER BY created_at DESC LIMIT 5;"

Scenario 12 'Buyer (after staff dashboard takeover)' `
  '[Admin takes over conversation in dashboard] Then buyer sends a new message' `
  'Documented behavior: AI remains active (always-on mode) OR AI paused per P6 decision — verify whichever is product-decided' `
  "SELECT ai_active, status FROM conversations WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%$($BuyerPhone.Substring([Math]::Max(0,$BuyerPhone.Length-10)))') ORDER BY updated_at DESC LIMIT 1;"

# ── Summary ───────────────────────────────────────────────────────────
Section 'Completion'
Write-Host ''
Write-Host 'Mark each scenario PASS/FAIL in the §7 table of:'
Write-Host '  backend/docs/AI_MASTER_REALITY_AND_A_PLUS_PLAN.md'
Write-Host ''
Write-Host 'A+ gate: 12/12 prod handset PASS + npm test green.'
Write-Host ''
Write-Host 'Automated gate commands:'
Write-Host '  cd backend && npm test'
Write-Host "  curl.exe -s $Base/api/health/live"
Write-Host "  .\\scripts\\verify-workflow-scenarios-production.ps1 -Base $Base"
