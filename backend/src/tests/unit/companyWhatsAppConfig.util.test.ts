import {
  allowPlatformWhatsAppCredentialFallback,
  extractCompanyWhatsAppSettings,
  isCompanyWhatsAppConfigured,
  resolveCompanyWhatsAppConfigFromSettings,
} from '../../utils/companyWhatsAppConfig.util';

describe('companyWhatsAppConfig.util', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('production requires per-company Meta credentials', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const mod = require('../../utils/companyWhatsAppConfig.util');
    expect(mod.allowPlatformWhatsAppCredentialFallback()).toBe(false);
    expect(
      mod.resolveCompanyWhatsAppConfigFromSettings({ whatsapp: {} }),
    ).toBeNull();
    expect(
      mod.resolveCompanyWhatsAppConfigFromSettings({
        whatsapp: { meta: { phoneNumberId: 'pn-1', accessToken: 'tok-1' } },
      }),
    ).toEqual({
      provider: 'meta',
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      verifyToken: '',
    });
  });

  test('development may fall back to platform env credentials', () => {
    process.env.NODE_ENV = 'development';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'env-pn';
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token';
    jest.resetModules();
    const mod = require('../../utils/companyWhatsAppConfig.util');
    const resolved = mod.resolveCompanyWhatsAppConfigFromSettings({}, { allowPlatformFallback: true });
    expect(resolved?.phoneNumberId).toBe('env-pn');
    expect(resolved?.accessToken).toBe('env-token');
  });

  test('isCompanyWhatsAppConfigured checks tenant settings only', () => {
    expect(isCompanyWhatsAppConfigured({ whatsapp: { meta: { phoneNumberId: '1', accessToken: '2' } } })).toBe(true);
    expect(isCompanyWhatsAppConfigured({ whatsapp: { meta: { phoneNumberId: '1' } } })).toBe(false);
    expect(extractCompanyWhatsAppSettings({ whatsapp: { meta: { phone_number_id: 'legacy' } } }).phoneNumberId).toBe('legacy');
  });
});
