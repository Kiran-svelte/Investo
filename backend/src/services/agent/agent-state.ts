import { BaseMessage } from '@langchain/core/messages';
import { UserRole } from '@prisma/client';

export interface ToolContext {
  userId: string;
  companyId: string;
  userRole: UserRole;
  userName: string;
  sessionId?: string;
}

export interface AgentState {
  messages: BaseMessage[];
  userId: string;
  companyId: string;
  userRole: UserRole;
  userName: string;
  pendingConfirmationId: string | null;
  toolCallCount: number;
  responseText: string;
}
