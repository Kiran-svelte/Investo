import { evaluateResponseRisk } from '../evals/responseSafety.eval';
import { aiReviewQueueService } from './aiReviewQueue.service';

export function scoreOutboundAiRisk(input: {
  content: string;
  mutationSucceeded?: boolean;
  hasInventoryAlternatives?: boolean;
}): { riskScore: number; violations: string[] } {
  return evaluateResponseRisk({
    text: input.content,
    mutationSucceeded: input.mutationSucceeded,
    hasInventoryAlternatives: input.hasInventoryAlternatives,
  });
}

export async function maybeEnqueueOutboundAiReview(input: {
  companyId: string;
  messageId: string;
  content: string;
  mutationSucceeded?: boolean;
  hasInventoryAlternatives?: boolean;
}): Promise<{ enqueued: boolean; riskScore: number; violations: string[] }> {
  const { riskScore, violations } = scoreOutboundAiRisk(input);
  if (riskScore < aiReviewQueueService.getRiskThreshold()) {
    return { enqueued: false, riskScore, violations };
  }

  const row = await aiReviewQueueService.enqueue({
    companyId: input.companyId,
    messageId: input.messageId,
    riskScore,
  });

  return { enqueued: Boolean(row), riskScore, violations };
}
