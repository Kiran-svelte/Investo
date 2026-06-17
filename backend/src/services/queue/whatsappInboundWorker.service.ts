import config from '../../config';
import logger from '../../config/logger';
import {
  whatsappInboundQueueService,
  type WhatsAppInboundQueueService,
  type WhatsAppQueueJob,
} from './whatsappInboundQueue.service';

type WebhookJobProcessor = (job: WhatsAppQueueJob) => Promise<void>;

async function defaultWebhookJobProcessor(job: WhatsAppQueueJob): Promise<void> {
  const { webhookRouteInternals } = await import('../../routes/webhook.routes');
  await webhookRouteInternals.processWebhook(job.payload.webhookBody);
}

export class WhatsAppInboundWorkerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      queue: WhatsAppInboundQueueService;
      processor: WebhookJobProcessor;
      intervalMs: number;
      batchSize: number;
    } = {
      queue: whatsappInboundQueueService,
      processor: defaultWebhookJobProcessor,
      intervalMs: config.whatsappQueue.inboundWorkerIntervalMs,
      batchSize: config.whatsappQueue.inboundWorkerBatchSize,
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.deps.intervalMs);
    void this.runOnce();
    logger.info('WhatsApp inbound worker started', {
      intervalMs: this.deps.intervalMs,
      batchSize: this.deps.batchSize,
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('WhatsApp inbound worker stopped');
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.deps.queue.processDueJobs(this.deps.processor, this.deps.batchSize);
    } finally {
      this.running = false;
    }
  }
}

export const whatsappInboundWorkerService = new WhatsAppInboundWorkerService();
