/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Search for tests in both the top-level tests/ directory AND src/ (for
  // co-located tests in src/tests/). Previously roots: ['<rootDir>/src'] caused
  // tests/unit/*.test.ts to be silently ignored.
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^jwks-rsa$': '<rootDir>/src/tests/mocks/jwks-rsa.mock.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/config/migrate.ts',
    '!src/config/seed.ts',
    '!src/config/migrations/**',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 60,
      statements: 60,
    },
  },
};

