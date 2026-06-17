import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const { buildEnterpriseBaselineReport, loadChunkStatusFile } = require('../src/services/platformMaturity.service.ts');

const redisStatus =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? 'ok'
    : 'memory_fallback';

const chunkStatus = loadChunkStatusFile() || (
  fs.existsSync(path.resolve('docs/enterprise/CHUNK_STATUS.json'))
    ? JSON.parse(fs.readFileSync(path.resolve('docs/enterprise/CHUNK_STATUS.json'), 'utf8'))
    : null
);

const report = buildEnterpriseBaselineReport({
  redisStatus,
  chunkStatus,
  signals: {
    quotaMiddlewareWired: true,
    retentionPurgeScheduled: false,
    oidcSsoProductionReady: process.env.SSO_TEST_IDP !== 'true',
  },
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
