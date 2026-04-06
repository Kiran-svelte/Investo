import { assertValidDatabaseUrl, isNeonDatabaseUrl, isNeonPoolerDatabaseUrl } from '../../config';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function loadConfigWithEnv(env: NodeJS.ProcessEnv) {
  jest.resetModules();
  restoreEnv();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return require('../../config').default as typeof import('../../config').default;
}

describe('Database configuration guard', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
  });

  test('accepts a Neon connection string', () => {
    expect(isNeonDatabaseUrl('postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/db?sslmode=require')).toBe(true);
  });

  test('accepts a non-Neon PostgreSQL connection string', () => {
    expect(isNeonDatabaseUrl('postgresql://user:pass@localhost:5432/db')).toBe(false);
  });

  test('accepts a Neon pooler connection string', () => {
    expect(
      isNeonPoolerDatabaseUrl('postgresql://user:pass@ep-example-pooler.us-east-1.aws.neon.tech/db?sslmode=require'),
    ).toBe(true);
  });

  test('rejects a Neon direct connection string as pooler runtime URL', () => {
    expect(
      isNeonPoolerDatabaseUrl('postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/db?sslmode=require'),
    ).toBe(false);
  });

  test('throws for a non-PostgreSQL connection string', () => {
    expect(() => assertValidDatabaseUrl('mysql://user:pass@localhost:3306/db')).toThrow(
      'DATABASE_URL must be a PostgreSQL connection string',
    );
  });

  test('uses deterministic JWT defaults in test mode when secrets are absent', () => {
    const config = loadConfigWithEnv({
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      JWT_SECRET: '',
      JWT_REFRESH_SECRET: '',
      KIMI_2_5_MODEL: '',
    });

    expect(config.jwt.secret).toBe('test-jwt-secret');
    expect(config.jwt.refreshSecret).toBe('test-jwt-refresh-secret');
    expect(config.ai.kimi25Model).toBe('kimi-k2-2504');
  });

  test('requires JWT secrets outside test mode', () => {
    expect(() =>
      loadConfigWithEnv({
        ...ORIGINAL_ENV,
        NODE_ENV: 'production',
        JEST_WORKER_ID: '',
        DATABASE_URL: 'postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/db?sslmode=require',
        JWT_SECRET: '',
        JWT_REFRESH_SECRET: 'present',
      }),
    ).toThrow('JWT_SECRET is required when NODE_ENV is not test');
  });

  test('requires the refresh JWT secret outside test mode', () => {
    expect(() =>
      loadConfigWithEnv({
        ...ORIGINAL_ENV,
        NODE_ENV: 'production',
        JEST_WORKER_ID: '',
        DATABASE_URL: 'postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/db?sslmode=require',
        JWT_SECRET: 'present',
        JWT_REFRESH_SECRET: '',
      }),
    ).toThrow('JWT_REFRESH_SECRET is required when NODE_ENV is not test');
  });

  test('enables neon keepalive by default with 4 minute interval', () => {
    const config = loadConfigWithEnv({
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@ep-example-pooler.us-east-1.aws.neon.tech/db?sslmode=require',
      NEON_KEEPALIVE_ENABLED: '',
      NEON_KEEPALIVE_INTERVAL_MS: '',
    });

    expect(config.db.keepAliveEnabled).toBe(true);
    expect(config.db.keepAliveIntervalMs).toBe(240000);
  });
});
