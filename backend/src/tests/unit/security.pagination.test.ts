import { parsePagination, buildPaginationMeta } from '../../utils/pagination';
import { redactSensitiveData, mergeSettingsPreservingSecrets } from '../../utils/sanitize';

describe('pagination utils', () => {
  it('parses page and limit with caps', () => {
    const result = parsePagination({ page: '2', limit: '500' }, { maxLimit: 100 });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(100);
  });

  it('builds pagination meta', () => {
    expect(buildPaginationMeta(1, 25, 60)).toEqual({
      page: 1,
      limit: 25,
      total: 60,
      pages: 3,
    });
  });
});

describe('sanitize utils', () => {
  it('redacts nested secrets in logs/objects', () => {
    const result = redactSensitiveData({
      user: 'admin',
      meta: { accessToken: 'sk-live-abcdef1234' },
    }) as any;
    expect(result.meta.accessToken).toMatch(/\*+1234$/);
  });

  it('preserves secrets when client sends masked placeholders', () => {
    const merged = mergeSettingsPreservingSecrets(
      { whatsapp: { meta: { accessToken: 'real-secret-token' } } },
      { whatsapp: { meta: { accessToken: '********1234' } } },
    );
    expect((merged.whatsapp as any).meta.accessToken).toBe('real-secret-token');
  });
});
