export type PlatformWorkerMode = 'api_colocated' | 'dedicated_worker';

export interface PlatformSloTargets {
  apiP95Ms: number;
  webhookAckP95Ms: number;
  uptimeMonthlyPct: number;
  rtoMinutes: number;
  rpoMinutes: number;
}

export interface PlatformQueueConfig {
  prefix: string;
  names: {
    webhookInbound: string;
    whatsappOutbound: string;
    automation: string;
    propertyImport: string;
    deadLetter: string;
  };
}

export interface PlatformConfig {
  workerMode: PlatformWorkerMode;
  queues: PlatformQueueConfig;
  sloTargets: PlatformSloTargets;
  baseline: {
    enterpriseDoc: string;
    chunkStatusPath: string;
    stagingParityDoc: string;
  };
}

function normalizeQueuePrefix(value: string | undefined): string {
  const trimmed = (value || 'investo').trim().replace(/:+$/g, '');
  return trimmed || 'investo';
}

export function resolvePlatformWorkerMode(env: NodeJS.ProcessEnv = process.env): PlatformWorkerMode {
  if (env.RUN_BACKGROUND_WORKERS_ON_API === 'true') return 'api_colocated';
  if (env.RUN_BACKGROUND_WORKERS_ON_API === 'false') return 'dedicated_worker';
  return 'dedicated_worker';
}

export function resolvePlatformConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const prefix = normalizeQueuePrefix(env.PLATFORM_QUEUE_PREFIX);

  return {
    workerMode: resolvePlatformWorkerMode(env),
    queues: {
      prefix,
      names: {
        webhookInbound: `${prefix}:webhook:inbound`,
        whatsappOutbound: `${prefix}:whatsapp:outbound`,
        automation: `${prefix}:automation`,
        propertyImport: `${prefix}:property-import`,
        deadLetter: `${prefix}:dead-letter`,
      },
    },
    sloTargets: {
      apiP95Ms: Number(env.SLO_API_P95_MS || 500),
      webhookAckP95Ms: Number(env.SLO_WEBHOOK_ACK_P95_MS || 200),
      uptimeMonthlyPct: Number(env.SLO_UPTIME_MONTHLY_PCT || 99.9),
      rtoMinutes: Number(env.SLO_RTO_MINUTES || 60),
      rpoMinutes: Number(env.SLO_RPO_MINUTES || 15),
    },
    baseline: {
      enterpriseDoc: 'main_docs/enterprise.md',
      chunkStatusPath: 'docs/enterprise/CHUNK_STATUS.json',
      stagingParityDoc: 'docs/enterprise/STAGING_PARITY.md',
    },
  };
}

export const platformConfig: PlatformConfig = {
  get workerMode() {
    return resolvePlatformConfig().workerMode;
  },
  get queues() {
    return resolvePlatformConfig().queues;
  },
  get sloTargets() {
    return resolvePlatformConfig().sloTargets;
  },
  get baseline() {
    return resolvePlatformConfig().baseline;
  },
};
