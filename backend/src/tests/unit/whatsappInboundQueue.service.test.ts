/// <reference types="jest" />

const mockPrisma = {
  whatsAppJob: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  whatsAppDeadLetter: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsappQueue: {
      inboundMaxAttempts: 3,
      inboundWorkerBatchSize: 10,
      inboundWorkerIntervalMs: 1000,
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { WhatsAppInboundQueueService } from '../../services/queue/whatsappInboundQueue.service';
import { DeadLetterService } from '../../services/queue/deadLetter.service';

function payload(messageId = 'wamid-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pnid-1', display_phone_number: '15550001111' },
              messages: [{ id: messageId, from: '919999999999', type: 'text', text: { body: 'Hi' } }],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsAppInboundQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueues webhook payloads with stable idempotency and company scope', async () => {
    mockPrisma.whatsAppJob.create.mockResolvedValueOnce({ id: 'job-1' });
    const service = new WhatsAppInboundQueueService();

    const result = await service.enqueueWebhookPayload(payload(), async () => ({ company: { id: 'company-1' } }));

    expect(result.status).toBe('enqueued');
    expect(result.companyId).toBe('company-1');
    expect(result.messageIds).toEqual(['wamid-1']);
    expect(mockPrisma.whatsAppJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        jobType: 'inbound_turn',
        status: 'pending',
        maxAttempts: 3,
        idempotencyKey: expect.stringMatching(/^meta:webhook:/),
      }),
    });
  });

  it('returns duplicate when the idempotency key already exists', async () => {
    mockPrisma.whatsAppJob.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = new WhatsAppInboundQueueService();

    const result = await service.enqueueWebhookPayload(payload(), async () => ({ companyId: 'company-1' }));

    expect(result.status).toBe('duplicate');
    expect(result.messageIds).toEqual(['wamid-1']);
  });

  it('replaying the same webhook produces one queued write and one duplicate result', async () => {
    mockPrisma.whatsAppJob.create
      .mockResolvedValueOnce({ id: 'job-1' })
      .mockRejectedValueOnce({ code: 'P2002' });
    const service = new WhatsAppInboundQueueService();
    const body = payload('wamid-replay-1');

    const first = await service.enqueueWebhookPayload(body, async () => ({ companyId: 'company-1' }));
    const replay = await service.enqueueWebhookPayload(body, async () => ({ companyId: 'company-1' }));

    expect(first.status).toBe('enqueued');
    expect(replay.status).toBe('duplicate');
    expect(first.idempotencyKey).toBe(replay.idempotencyKey);
    expect(mockPrisma.whatsAppJob.create).toHaveBeenCalledTimes(2);
  });

  it('processes due jobs and marks success completed once', async () => {
    const service = new WhatsAppInboundQueueService();
    mockPrisma.whatsAppJob.findMany.mockResolvedValueOnce([
      {
        id: 'job-1',
        companyId: 'company-1',
        jobType: 'inbound_turn',
        idempotencyKey: 'key-1',
        payload: { webhookBody: payload(), messageIds: ['wamid-1'], queuedAt: new Date().toISOString() },
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      },
    ]);
    mockPrisma.whatsAppJob.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.whatsAppJob.update.mockResolvedValueOnce({});

    const processor = jest.fn().mockResolvedValue(undefined);
    const processed = await service.processDueJobs(processor);

    expect(processed).toBe(1);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(mockPrisma.whatsAppJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'completed' }),
    });
  });

  it('moves exhausted failures to WhatsApp DLQ', async () => {
    const service = new WhatsAppInboundQueueService();
    mockPrisma.whatsAppJob.findMany.mockResolvedValueOnce([
      {
        id: 'job-1',
        companyId: 'company-1',
        jobType: 'inbound_turn',
        idempotencyKey: 'key-1',
        payload: { webhookBody: payload(), messageIds: ['wamid-1'], queuedAt: new Date().toISOString() },
        status: 'failed',
        attempts: 2,
        maxAttempts: 3,
      },
    ]);
    mockPrisma.whatsAppJob.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.whatsAppDeadLetter.create.mockResolvedValueOnce({});
    mockPrisma.whatsAppJob.update.mockResolvedValueOnce({});

    await service.processDueJobs(async () => {
      throw new Error('Meta down');
    });

    expect(mockPrisma.whatsAppDeadLetter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: 'job-1',
        companyId: 'company-1',
        error: 'Meta down',
      }),
    });
    expect(mockPrisma.whatsAppJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'dlq', attempts: 3 }),
    });
  });
});

describe('DeadLetterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replays a dead-letter job as a fresh pending WhatsApp job', async () => {
    mockPrisma.whatsAppDeadLetter.findUnique.mockResolvedValueOnce({
      id: 'dlq-1',
      jobId: 'job-1',
      companyId: 'company-1',
      payload: { webhookBody: payload(), messageIds: ['wamid-1'], queuedAt: new Date().toISOString() },
      error: 'Meta down',
    });
    mockPrisma.whatsAppJob.create.mockResolvedValueOnce({ id: 'job-replay-1' });

    const result = await new DeadLetterService().replayWhatsAppDeadLetter('dlq-1');

    expect(result.jobId).toBe('job-replay-1');
    expect(result.idempotencyKey).toMatch(/^replay:job-1:/);
    expect(mockPrisma.whatsAppJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        jobType: 'inbound_turn',
        status: 'pending',
        maxAttempts: 3,
      }),
    });
  });
});
