import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from './api';
import { getSystemHealth } from './health';

describe('getSystemHealth', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('parses flat /health response from Render', async () => {
    const flat = {
      status: 'ok',
      dependencies: {
        property_knowledge_embeddings: {
          status: 'ok',
          provider: 'openai',
          detail: 'OpenAI embeddings ready for publish and WhatsApp AI.',
        },
      },
    };
    vi.mocked(api.get).mockResolvedValue({ data: flat });

    const health = await getSystemHealth();
    expect(health.dependencies?.property_knowledge_embeddings?.status).toBe('ok');
    expect(health.dependencies?.property_knowledge_embeddings?.provider).toBe('openai');
  });

  it('parses wrapped { data } response', async () => {
    const wrapped = {
      data: {
        status: 'ok',
        dependencies: {
          property_knowledge_embeddings: {
            status: 'ok',
            provider: 'openai',
          },
        },
      },
    };
    vi.mocked(api.get).mockResolvedValue({ data: wrapped });

    const health = await getSystemHealth();
    expect(health.status).toBe('ok');
  });
});
