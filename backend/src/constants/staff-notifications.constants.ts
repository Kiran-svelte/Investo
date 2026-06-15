/**
 * Investo staff (company users) WhatsApp outbound catalog.
 * Each entry documents who gets messaged, when, and which code path sends it.
 */
export const STAFF_WHATSAPP_NOTIFICATIONS = [
  { id: 'new_lead_assigned', recipient: 'assigned_agent', trigger: 'Lead assigned / new_lead workflow', sender: 'leadAssignment.notifyAgentOfNewLead' },
  { id: 'lead_reassigned', recipient: 'old + new agent', trigger: 'assign_agent workflow', sender: 'notificationEngine.onLeadReassigned (DB); notifyAgentChange (WA)' },
  { id: 'visit_scheduled', recipient: 'agent + admins', trigger: 'schedule_visit workflow / visit booked', sender: 'notificationEngine.onVisitScheduled' },
  { id: 'visit_rescheduled', recipient: 'agent + admins', trigger: 'reschedule_visit workflow / customer reschedule', sender: 'notificationEngine.onVisitRescheduled' },
  { id: 'visit_status_change', recipient: 'agent + customer', trigger: 'confirm / complete / cancel visit', sender: 'notificationEngine.onVisitStatusChange' },
  { id: 'visit_reminder_1h', recipient: 'agent', trigger: '1h before visit', sender: 'cron-scheduler.sendVisitReminders' },
  { id: 'visit_reminder_24h', recipient: 'customer', trigger: '24h before visit', sender: 'automation.service visit_reminder_24h' },
  { id: 'visit_reminder_1h_customer', recipient: 'customer', trigger: '1h before visit', sender: 'automation.service visit_reminder_1h' },
  { id: 'visit_pending_approval', recipient: 'agent', trigger: 'Customer books pending approval', sender: 'visitPendingApproval.service' },
  { id: 'escalation_urgent', recipient: 'all agents', trigger: 'escalate_to_human workflow', sender: 'escalate-actions.notifyAllAgents' },
  { id: 'escalation_takeover', recipient: 'assigned agent', trigger: 'takeover conversation', sender: 'escalate-actions.pushEscalationToAgent' },
  { id: 'morning_briefing', recipient: 'sales_agent', trigger: 'Daily cron + CHECK IN reply', sender: 'cron-scheduler.sendMorningBriefings / staffShiftBriefing' },
  { id: 'eod_summary', recipient: 'sales_agent', trigger: 'Daily cron + CHECK OUT reply', sender: 'cron-scheduler.sendEndOfDaySummaries / staffShiftBriefing' },
  { id: 'follow_up_due_reminder', recipient: 'sales_agent', trigger: 'Every 15 min cron', sender: 'cron-scheduler.processDueFollowUps' },
  { id: 'follow_up_alert', recipient: 'sales_agent', trigger: 'Stale leads cron', sender: 'cron-scheduler.sendFollowUpAlerts' },
  { id: 'copilot_reply', recipient: 'staff user', trigger: 'Staff WhatsApp inbound', sender: 'agent-router.routeIfInternalUserForCompany' },
  { id: 'visit_confirmation_customer', recipient: 'customer', trigger: 'sendVisitConfirmation workflow step', sender: 'visit-actions.sendVisitConfirmation' },
] as const;
