import config from '../config';
import { secretsService } from './secrets.service';
import { isPiiEncryptionEnabled } from './piiEncryption.service';

export interface SecurityScanReport {
  generated_at: string;
  checks: Array<{
    id: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
}

export function runSecuritySelfCheck(): SecurityScanReport {
  const checks: SecurityScanReport['checks'] = [];

  const secrets = secretsService.selfCheck();
  const missingSecrets = secrets.filter((item) => !item.present);
  checks.push({
    id: 'secrets_present',
    status: missingSecrets.length === 0 ? 'pass' : config.env === 'production' ? 'fail' : 'warn',
    detail: missingSecrets.length
      ? `Missing: ${missingSecrets.map((item) => item.name).join(', ')}`
      : 'Required secrets resolved',
  });

  checks.push({
    id: 'pii_encryption',
    status: isPiiEncryptionEnabled() ? 'pass' : 'warn',
    detail: isPiiEncryptionEnabled()
      ? 'PII encryption enabled'
      : 'PII encryption disabled (FEATURE_PII_ENCRYPTION=false)',
  });

  checks.push({
    id: 'secrets_vault',
    status: secretsService.isVaultEnabled() ? 'pass' : 'warn',
    detail: secretsService.isVaultEnabled()
      ? 'Vault shim enabled (VAULT_SECRET_* prefix)'
      : 'Secrets loaded directly from environment',
  });

  checks.push({
    id: 'security_headers',
    status: config.features.securityHeadersStrict !== false ? 'pass' : 'warn',
    detail: config.features.securityHeadersStrict !== false
      ? 'Strict security headers enabled'
      : 'Strict security headers disabled',
  });

  return {
    generated_at: new Date().toISOString(),
    checks,
  };
}
