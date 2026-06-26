/// <reference types="jest" />

import fs from 'fs';
import path from 'path';

describe('identity route mounting order', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../../app.ts'), 'utf8');

  function indexOfRequired(fragment: string): number {
    const index = appSource.indexOf(fragment);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  }

  it('mounts MFA and SCIM after JSON parsing while keeping raw webhooks before it', () => {
    const jsonParser = indexOfRequired("app.use(express.json({ limit: '10mb' }))");
    const resendWebhook = indexOfRequired("app.use('/api/webhooks/resend'");
    const mfaRoutes = indexOfRequired("app.use('/api/auth/mfa'");
    const scimRoutes = indexOfRequired("app.use('/scim/v2'");

    expect(resendWebhook).toBeLessThan(jsonParser);
    expect(mfaRoutes).toBeGreaterThan(jsonParser);
    expect(scimRoutes).toBeGreaterThan(jsonParser);
  });
});
