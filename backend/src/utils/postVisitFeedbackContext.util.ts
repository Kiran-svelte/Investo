import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';

/** JSON commitments keys for the unified post-visit feedback flow. */
export type PostVisitFeedbackCommitments = {
  awaitingPostVisitFeedback?: boolean;
  postVisitFeedbackVisitId?: string;
  postVisitFeedbackPromptAt?: string;
  postVisitFeedbackCollectedAt?: string;
  postVisitFeedbackRating?: number;
  postVisitFeedbackSentiment?: string;
};

export const POST_VISIT_FEEDBACK_NOTE_PREFIX = '[post_visit_feedback]';

export function readPostVisitFeedbackCommitments(commitments: unknown): PostVisitFeedbackCommitments {
  if (!commitments || typeof commitments !== 'object' || Array.isArray(commitments)) {
    return {};
  }
  return commitments as PostVisitFeedbackCommitments;
}

export function isConversationAwaitingPostVisitFeedback(commitments: unknown): boolean {
  const c = readPostVisitFeedbackCommitments(commitments);
  return c.awaitingPostVisitFeedback === true && !c.postVisitFeedbackCollectedAt;
}

export function isPostVisitFeedbackCollected(commitments: unknown): boolean {
  const c = readPostVisitFeedbackCommitments(commitments);
  return Boolean(c.postVisitFeedbackCollectedAt);
}

export function visitNotesIndicateFeedbackCollected(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes.includes(POST_VISIT_FEEDBACK_NOTE_PREFIX);
}

export async function mergeConversationCommitments(
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  });
  const existing =
    row?.commitments && typeof row.commitments === 'object' && !Array.isArray(row.commitments)
      ? { ...(row.commitments as Record<string, unknown>) }
      : {};

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      commitments: { ...existing, ...patch } as Prisma.InputJsonValue,
    },
  });
}
