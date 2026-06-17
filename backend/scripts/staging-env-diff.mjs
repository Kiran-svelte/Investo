import fs from 'fs';

function parseEnvKeys(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return new Set();
  }

  return new Set(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean),
  );
}

const [stagingPath, prodPath] = process.argv.slice(2);

if (!stagingPath || !prodPath) {
  process.stderr.write('Usage: node scripts/staging-env-diff.mjs <staging.env> <prod.env>\n');
  process.exit(2);
}

const stagingKeys = parseEnvKeys(stagingPath);
const prodKeys = parseEnvKeys(prodPath);
const missingInStaging = [...prodKeys].filter((key) => !stagingKeys.has(key)).sort();
const extraInStaging = [...stagingKeys].filter((key) => !prodKeys.has(key)).sort();

const result = {
  staging_path: stagingPath,
  prod_path: prodPath,
  checked_at: new Date().toISOString(),
  prod_key_count: prodKeys.size,
  staging_key_count: stagingKeys.size,
  missing_in_staging: missingInStaging,
  extra_in_staging: extraInStaging,
  parity_ok: missingInStaging.length === 0,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.parity_ok ? 0 : 1);
