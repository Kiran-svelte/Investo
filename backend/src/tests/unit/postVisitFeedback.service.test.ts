import {
  isVisitNpsScoreMessage,
  parsePostVisitFeedbackMessage,
  shouldHandlePostVisitFeedbackTurn,
  shouldSendPostVisitFollowUp,
} from '../../services/buyer/postVisitFeedback.service';
import { parseVisitDateTimeFromMessage } from '../../services/visitIntentFromMessage.service';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
  },
}));

import prisma from '../../config/prisma';

describe('postVisitFeedback.service', () => {
  test('parsePostVisitFeedbackMessage recognizes rating, sentiment, and deferral', () => {
    expect(parsePostVisitFeedbackMessage('4')).toEqual({ matched: true, kind: 'rating', rating: 4 });
    expect(parsePostVisitFeedbackMessage('Loved it')).toEqual({ matched: true, kind: 'sentiment', sentiment: 'loved' });
    expect(parsePostVisitFeedbackMessage('Need some time to decide')).toEqual({
      matched: true,
      kind: 'sentiment',
      sentiment: 'defer',
    });
    expect(parsePostVisitFeedbackMessage('need more options')).toEqual({
      matched: true,
      kind: 'sentiment',
      sentiment: 'more_options',
    });
    expect(parsePostVisitFeedbackMessage('hello')).toEqual({ matched: false });
  });

  test('NPS scores are not parsed as visit datetimes', () => {
    expect(isVisitNpsScoreMessage('4')).toBe(true);
    expect(parseVisitDateTimeFromMessage('4')).toBeNull();
    expect(parseVisitDateTimeFromMessage('Saturday 4pm')).not.toBeNull();
  });

  test('shouldHandlePostVisitFeedbackTurn when awaiting feedback flag set', () => {
    expect(
      shouldHandlePostVisitFeedbackTurn({
        messageText: 'Need some time to decide',
        commitments: { awaitingPostVisitFeedback: true },
        liveCtx: { activeVisit: null, recentCompletedVisit: null, leadStatus: 'visited' },
        history: [],
      }),
    ).toBe(true);
  });

  test('shouldHandlePostVisitFeedbackTurn for post-visit buyer with rating reply', () => {
    expect(
      shouldHandlePostVisitFeedbackTurn({
        messageText: '5',
        commitments: {},
        liveCtx: {
          activeVisit: null,
          recentCompletedVisit: {
            visitId: 'v1',
            propertyId: 'p1',
            propertyName: 'Sunset Heights',
            projectId: null,
            status: 'completed',
            scheduledAt: new Date(),
            agentName: null,
            agentPhone: null,
            notes: null,
          },
          leadStatus: 'visited',
        },
        history: [],
      }),
    ).toBe(true);
  });

  test('shouldSendPostVisitFollowUp skips when feedback already collected on visit', async () => {
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      leadId: 'lead-1',
      status: 'completed',
      notes: '[post_visit_feedback] rating=4',
    });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(shouldSendPostVisitFollowUp({ leadId: 'lead-1', visitId: 'visit-1' })).resolves.toBe(false);
  });

  test('shouldSendPostVisitFollowUp skips when prompt sent recently', async () => {
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      leadId: 'lead-1',
      status: 'completed',
      notes: null,
    });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
      commitments: { postVisitFeedbackPromptAt: new Date().toISOString() },
    });

    await expect(shouldSendPostVisitFollowUp({ leadId: 'lead-1', visitId: 'visit-1' })).resolves.toBe(false);
  });

  test('shouldSendPostVisitFollowUp allows reminder after cooldown', async () => {
    const oldPrompt = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      leadId: 'lead-1',
      status: 'completed',
      notes: null,
    });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
      commitments: { postVisitFeedbackPromptAt: oldPrompt },
    });

    await expect(shouldSendPostVisitFollowUp({ leadId: 'lead-1', visitId: 'visit-1' })).resolves.toBe(true);
  });
});
