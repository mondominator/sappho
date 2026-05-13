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
      functions: 37,
      lines: 29
    },
    // Utility functions require high coverage (90%+) but allow for defensive error handling
    'server/utils/**/*.js': {
      statements: 90,
      branches: 90,
      functions: 100,
      lines: 90
    }
  },
  testPathIgnorePatterns: ['/node_modules/', '/client/'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  testTimeout: 20000,
  verbose: true
};
