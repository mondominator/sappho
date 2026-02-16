/**
 * Unit tests for AI Provider service
 */

const { callOpenAI, callGemini, callAI, getModelUsed, generateRecapHash } = require('../../server/services/aiProvider');

// Save original env
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('callOpenAI', () => {
  it('throws if OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(callOpenAI('prompt', 'system')).rejects.toThrow('OpenAI API key not configured');
  });

  it('calls OpenAI API and returns content', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'AI response' } }] })
    });

    const result = await callOpenAI('prompt', 'system');
    expect(result).toBe('AI response');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key'
        })
      })
    );
  });

  it('uses custom model from env', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-4';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'response' } }] })
    });

    await callOpenAI('prompt', 'system');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4');
  });

  it('throws on API error', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Rate limited' } })
    });

    await expect(callOpenAI('prompt', 'system')).rejects.toThrow('Rate limited');
  });
});

describe('callGemini', () => {
  it('throws if GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(callGemini('prompt', 'system')).rejects.toThrow('Gemini API key not configured');
  });

  it('calls Gemini API and returns content', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }] })
    });

    const result = await callGemini('prompt', 'system');
    expect(result).toBe('Gemini response');
  });

  it('throws on API error', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid key' } })
    });

    await expect(callGemini('prompt', 'system')).rejects.toThrow('Invalid key');
  });
});

describe('callAI', () => {
  it('defaults to OpenAI provider', async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'openai response' } }] })
    });

    const result = await callAI('prompt', 'system');
    expect(result).toBe('openai response');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('openai.com'),
      expect.any(Object)
    );
  });

  it('uses Gemini when configured', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini response' }] } }] })
    });

    const result = await callAI('prompt', 'system');
    expect(result).toBe('gemini response');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.any(Object)
    );
  });
});

describe('getModelUsed', () => {
  it('returns default OpenAI model', () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_MODEL;
    expect(getModelUsed()).toBe('gpt-4o-mini');
  });

  it('returns custom OpenAI model', () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_MODEL = 'gpt-4';
    expect(getModelUsed()).toBe('gpt-4');
  });

  it('returns default Gemini model', () => {
    process.env.AI_PROVIDER = 'gemini';
    delete process.env.GEMINI_MODEL;
    expect(getModelUsed()).toBe('gemini-1.5-flash');
  });

  it('returns custom Gemini model', () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_MODEL = 'gemini-pro';
    expect(getModelUsed()).toBe('gemini-pro');
  });
});

describe('generateRecapHash', () => {
  it('generates consistent hash for same inputs', () => {
    const priorBooks = [{ id: 2 }, { id: 3 }];
    const hash1 = generateRecapHash(1, priorBooks);
    const hash2 = generateRecapHash(1, priorBooks);
    expect(hash1).toBe(hash2);
  });

  it('generates same hash regardless of prior books order', () => {
    const hash1 = generateRecapHash(1, [{ id: 2 }, { id: 3 }]);
    const hash2 = generateRecapHash(1, [{ id: 3 }, { id: 2 }]);
    expect(hash1).toBe(hash2);
  });

  it('generates different hash for different inputs', () => {
    const hash1 = generateRecapHash(1, [{ id: 2 }]);
    const hash2 = generateRecapHash(1, [{ id: 3 }]);
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty prior books', () => {
    const hash = generateRecapHash(1, []);
    expect(hash).toBeTruthy();
    expect(hash).toHaveLength(32); // MD5 hex length
  });
});
