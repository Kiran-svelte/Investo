import { describe, expect, it } from 'vitest';
import { embeddingHealthMessage, isOpenAiEmbeddingsReady } from './health';

describe('health helpers', () => {
  const flatHealth = {
    status: 'ok',
    dependencies: {
      property_knowledge_embeddings: {
        status: 'ok' as const,
        provider: 'openai' as const,
        detail: 'OpenAI embeddings ready for publish and WhatsApp AI.',
      },
    },
  };

  it('isOpenAiEmbeddingsReady accepts flat health shape', () => {
    expect(isOpenAiEmbeddingsReady(flatHealth)).toBe(true);
  });

  it('embeddingHealthMessage shows ready detail', () => {
    expect(embeddingHealthMessage(flatHealth)).toContain('OpenAI embeddings');
  });

  it('isOpenAiEmbeddingsReady is false when embeddings are in error', () => {
    expect(
      isOpenAiEmbeddingsReady({
        status: 'degraded',
        dependencies: {
          property_knowledge_embeddings: {
            status: 'error',
            provider: 'openai',
            detail: 'OpenAI API key is invalid or expired.',
          },
        },
      }),
    ).toBe(false);
  });
});
