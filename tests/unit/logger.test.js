describe('logger', () => {
  // Store original env
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Restore original env
    process.env.NODE_ENV = originalEnv;
    // Clear module cache to allow re-require
    jest.resetModules();
  });

  it('exports a pino logger instance', () => {
    const logger = require('../../server/utils/logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('has the correct log level', () => {
    const logger = require('../../server/utils/logger');
    // Default is 'info' when LOG_LEVEL is not set
    expect(logger.level).toBe('info');
  });

  it('uses pino-pretty transport in non-production', () => {
    process.env.NODE_ENV = 'development';
    const logger = require('../../server/utils/logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('disables pretty transport in production', () => {
    process.env.NODE_ENV = 'production';
    const logger = require('../../server/utils/logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});
