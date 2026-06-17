import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const { buildEnterpriseBaselineReport } = require('../src/services/platformMaturity.service.ts');

const redisStatus =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? 'degraded'
    : 'memory_fallback';

const report = buildEnterpriseBaselineReport({ redisStatus });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
