import { UserRole } from '@prisma/client';

export interface ToolContext {
  userId: string;
  companyId: string;
  userRole: UserRole;
  userName: string;
  sessionId?: string;
  /** Staff WhatsApp phone — used by workflow session context updates. */
  staffPhone?: string;
  /** buyer vs staff tool routing (e.g. brochure missing copy). */
  channel?: 'buyer' | 'staff';
  companyName?: string;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
}

export interface AgentState {
  messages: unknown[];
  userId: string;
  companyId: string;
  userRole: UserRole;
  userName: string;
  pendingConfirmationId: string | null;
  toolCallCount: number;
  responseText: string;
}
