import type { ActionContext } from './action-helpers';
import type { ActionResult } from '../workflow.types';
import * as lead from './lead-actions';
import * as visit from './visit-actions';
import * as inquiry from './inquiry-actions';
import * as agent from './agent-actions';
import * as escalate from './escalate-actions';

export type WorkflowActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

export const WORKFLOW_ACTION_HANDLERS: Record<string, WorkflowActionHandler> = {
  resolveLead: lead.resolveLead,
  createLead: lead.createLead,
  assignAgent: lead.assignAgent,
  sendWelcome: lead.sendWelcome,
  notifyAgent: lead.notifyAgent,
  updateLeadStatus: lead.updateLeadStatus,
  logLeadHistory: lead.logLeadHistory,
  notifyIfCritical: lead.notifyIfCritical,
  addLeadNote: lead.addLeadNote,
  syncLeadMemory: lead.syncLeadMemory,
  resolveAgent: lead.resolveAgent,
  reassignLead: lead.reassignLead,
  notifyAgentChange: lead.notifyAgentChange,
  updateLeadStatusVisitScheduled: lead.updateLeadStatusVisitScheduled,
  updateLeadStatusVisited: lead.updateLeadStatusVisited,
  updateLeadScore: lead.updateLeadScore,
  updateLeadInterest: lead.updateLeadInterest,
  updateLeadPreferences: lead.updateLeadPreferences,
  tagLead: lead.tagLead,
  markLeadUrgent: lead.markLeadUrgent,
  resolveVisit: visit.resolveVisit,
  bookVisit: visit.bookVisit,
  cancelVisitSlot: visit.cancelVisitSlot,
  updateVisitStatus: visit.updateVisitStatus,
  sendVisitConfirmation: visit.sendVisitConfirmation,
  scheduleVisitReminders: visit.scheduleVisitReminders,
  rescheduleReminders: visit.rescheduleReminders,
  cancelVisit: visit.cancelVisit,
  completeVisit: visit.completeVisit,
  recordVisitOutcome: visit.recordVisitOutcome,
  logFeedback: visit.logFeedback,
  scheduleFollowUp: visit.scheduleFollowUp,
  touchAnalytics: visit.touchAnalytics,
  fetchPropertyPrice: inquiry.fetchPropertyPrice,
  respondPrice: inquiry.respondPrice,
  checkInventory: inquiry.checkInventory,
  respondAvailability: inquiry.respondAvailability,
  sendBrochure: inquiry.sendBrochure,
  logBrochureRequest: inquiry.logBrochureRequest,
  answerAmenities: inquiry.answerAmenities,
  notifyIfHot: inquiry.notifyIfHot,
  checkCalendar: agent.checkCalendar,
  suggestAlternatives: agent.suggestAlternatives,
  optionalBookSlot: agent.optionalBookSlot,
  createUrgentAlert: escalate.createUrgentAlert,
  notifyAllAgents: escalate.notifyAllAgents,
  takeoverConversation: escalate.escalateTakeover,
};
