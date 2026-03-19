const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.JWT_SECRET = 'a-valid-secret-that-is-at-least-32-characters-long';
  jest.restoreAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('validateEnv', () => {
  it('passes when JWT_SECRET is valid', () => {
    jest.isolateModules(() => {
      const { validateEnv } = require('../../server/utils/validateEnv');
      expect(() => validateEnv()).not.toThrow();
    });
  });

  it('exits when JWT_SECRET is missing', () => {
    jest.isolateModules(() => {
      delete process.env.JWT_SECRET;
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { validateEnv } = require('../../server/utils/validateEnv');
      validateEnv();
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  it('exits when JWT_SECRET is too short', () => {
    jest.isolateModules(() => {
      process.env.JWT_SECRET = 'short';
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { validateEnv } = require('../../server/utils/validateEnv');
      validateEnv();
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  it('logs configured optional vars at debug level', () => {
    jest.isolateModules(() => {
      process.env.PORT = '4000';
      process.env.LOG_LEVEL = 'debug';
      const mockLogger = { debug: jest.fn() };
      jest.doMock('../../server/utils/logger', () => mockLogger);
      const { validateEnv } = require('../../server/utils/validateEnv');
      validateEnv();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ vars: expect.arrayContaining(['PORT']) }),
        'Custom environment variables configured'
      );
      // Also logs defaults for vars not explicitly set
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ vars: expect.any(Array) }),
        'Using default values for optional environment variables'
      );
    });
  });

  it('skips default log when all optional vars are configured', () => {
    jest.isolateModules(() => {
      const mockLogger = { debug: jest.fn() };
      jest.doMock('../../server/utils/logger', () => mockLogger);
      const { validateEnv, OPTIONAL_VARS } = require('../../server/utils/validateEnv');
      // Set ALL optional vars
      for (const v of OPTIONAL_VARS) {
        process.env[v.name] = 'test-value';
      }
      validateEnv();
      // Should log configured vars but NOT default vars
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ vars: expect.any(Array) }),
        'Custom environment variables configured'
      );
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.anything(),
        'Using default values for optional environment variables'
      );
    });
  });

  it('skips configured log when no optional vars are set', () => {
    jest.isolateModules(() => {
      const mockLogger = { debug: jest.fn() };
      jest.doMock('../../server/utils/logger', () => mockLogger);
      const { validateEnv, OPTIONAL_VARS } = require('../../server/utils/validateEnv');
      // Clear ALL optional vars
      for (const v of OPTIONAL_VARS) {
        delete process.env[v.name];
      }
      validateEnv();
      // Should NOT log configured, only defaults
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.anything(),
        'Custom environment variables configured'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.anything(),
        'Using default values for optional environment variables'
      );
    });
  });

  it('handles logger without debug method', () => {
    jest.isolateModules(() => {
      jest.doMock('../../server/utils/logger', () => ({ info: jest.fn() }));
      const { validateEnv } = require('../../server/utils/validateEnv');
      expect(() => validateEnv()).not.toThrow();
    });
  });

  it('handles null logger', () => {
    jest.isolateModules(() => {
      jest.doMock('../../server/utils/logger', () => null);
      const { validateEnv } = require('../../server/utils/validateEnv');
      expect(() => validateEnv()).not.toThrow();
    });
  });

  it('exports REQUIRED_VARS and OPTIONAL_VARS', () => {
    jest.isolateModules(() => {
      const { REQUIRED_VARS, OPTIONAL_VARS } = require('../../server/utils/validateEnv');
      expect(REQUIRED_VARS).toBeInstanceOf(Array);
      expect(REQUIRED_VARS.length).toBeGreaterThan(0);
      expect(OPTIONAL_VARS).toBeInstanceOf(Array);
      expect(OPTIONAL_VARS.length).toBeGreaterThan(0);
    });
  });

  it('validates JWT_SECRET validate function', () => {
    jest.isolateModules(() => {
      const { REQUIRED_VARS } = require('../../server/utils/validateEnv');
      const jwtVar = REQUIRED_VARS.find(v => v.name === 'JWT_SECRET');
      expect(jwtVar.validate).toBeDefined();
      expect(jwtVar.validate('a'.repeat(32))).toBeNull();
      expect(jwtVar.validate('short')).toEqual(expect.stringContaining('at least 32'));
    });
  });
});

describe('validateEnv branch coverage', () => {
  it('handles required var without validate function', () => {
    jest.isolateModules(() => {
      const mod = require('../../server/utils/validateEnv');
      // Temporarily add a required var without validate
      const original = [...mod.REQUIRED_VARS];
      mod.REQUIRED_VARS.push({ name: 'JWT_SECRET', description: 'test' });
      // JWT_SECRET is set in beforeEach, so it passes the !value check
      // and then hits the `if (varDef.validate)` false branch
      expect(() => mod.validateEnv()).not.toThrow();
      // Restore
      mod.REQUIRED_VARS.length = 0;
      original.forEach(v => mod.REQUIRED_VARS.push(v));
    });
  });
});
