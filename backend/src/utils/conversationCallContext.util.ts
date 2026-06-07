import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';

export function isConversationAwaitingCallTime(commitments: unknown): boolean {
  if (!commitments || typeof commitments !== 'object' || Array.isArray(commitments)) {
    return false;
  }
  return (commitments as Record<string, unknown>).awaitingCallTime === true;
}

export async function setConversationAwaitingCallTime(conversationId: string): Promise<void> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  });
  const existing =
    row?.commitments && typeof row.commitments === 'object' && !Array.isArray(row.commitments)
      ? (row.commitments as Record<string, unknown>)
      : {};

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      commitments: {
        ...existing,
        awaitingCallTime: true,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function clearConversationAwaitingCallTime(conversationId: string): Promise<void> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  });
  const existing =
    row?.commitments && typeof row.commitments === 'object' && !Array.isArray(row.commitments)
      ? { ...(row.commitments as Record<string, unknown>) }
      : {};

  delete existing.awaitingCallTime;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { commitments: existing as Prisma.InputJsonValue },
  });
}
