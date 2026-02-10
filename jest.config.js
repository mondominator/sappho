module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/migrations/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    // Global thresholds - minimum coverage for entire codebase
    // Set to current coverage levels to prevent regression
    global: {
      statements: 28,
      branches: 28,
      functions: 38,
      lines: 29
    },
    // Utility functions require 100% coverage
    'server/utils/**/*.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    }
  },
  testPathIgnorePatterns: ['/node_modules/', '/client/'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  testTimeout: 10000,
  verbose: true
};
