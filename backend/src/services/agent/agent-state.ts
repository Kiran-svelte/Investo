import { UserRole } from '@prisma/client';

export interface ToolContext {
  userId: string;
  companyId: string;
  userRole: UserRole;
  userName: string;
  sessionId?: string;
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
