/**
 * Jest test setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest-testing-only';
process.env.DATABASE_PATH = ':memory:';

// Disable express-rate-limit for tests. Real routes define rate limiters at
// module load time, so this mock must be in place before any route is imported.
jest.mock('express-rate-limit', () => {
  const passThrough = () => (_req, _res, next) => next();
  passThrough.rateLimit = passThrough;
  return passThrough;
});

// Increase timeout for integration tests
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  // Allow any pending operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});
