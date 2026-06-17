/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    observability: {
      syntheticBaseUrl: 'https://api.example.com',
    },
  },
}));

jest.mock('../../config/redis', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
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

import { cacheGet } from '../../config/redis';
import { runSyntheticChecks } from '../../services/observability/syntheticCheck.service';

describe('syntheticCheck.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/health/live')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (url.includes('/api/health') && !url.includes('/live')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (url.includes('/api/webhook')) {
        return new Response('Forbidden', { status: 403 });
      }
    }) as typeof fetch;

    (cacheGet as jest.Mock).mockResolvedValue(Date.now());
  });

  it('passes core HTTP synthetic checks', async () => {
    const report = await runSyntheticChecks({ baseUrl: 'https://api.example.com', includeAuthFlow: false });

    expect(report.overall_ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'api_live')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'db_ready')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'webhook_reachable')?.ok).toBe(true);
  });

  it('marks worker heartbeat failed when cache key missing', async () => {
    (cacheGet as jest.Mock).mockResolvedValueOnce(null);
    const report = await runSyntheticChecks({ baseUrl: 'https://api.example.com', includeAuthFlow: false });
    const worker = report.checks.find((check) => check.id === 'worker_heartbeat');
    expect(worker?.ok).toBe(false);
    expect(report.overall_ok).toBe(false);
  });
});
