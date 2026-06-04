import { redactSensitiveData } from '../../utils/sanitize';

describe('redactSensitiveData', () => {
  it('redacts password and token fields', () => {
    const result = redactSensitiveData({
      username: 'agent',
      password: 'secret123',
      accessToken: 'tok_abc',
      apiKey: 'key_xyz',
    }) as Record<string, string>;

    expect(result.username).toBe('agent');
    expect(result.password).not.toBe('secret123');
    expect(result.accessToken).not.toBe('tok_abc');
    expect(result.apiKey).not.toBe('key_xyz');
  });

  it('redacts nested sensitive keys', () => {
    const result = redactSensitiveData({
      access_token: 'tok_nested',
    }) as { access_token: string };
    expect(result.access_token).not.toBe('tok_nested');
  });
});
