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

  it('logs optional vars at debug level when configured', () => {
    jest.isolateModules(() => {
      process.env.PORT = '4000';
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
});
