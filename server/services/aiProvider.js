/**
 * AI Provider Service
 *
 * Unified interface for calling AI providers (OpenAI, Gemini).
 * Used by book recaps (batch.js) and series recaps (series.js).
 */

const crypto = require('crypto');

/**
 * Call OpenAI API
 */
const callOpenAI = async (prompt, systemPrompt) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API request failed');
    }

    const data = await response.json();
    return data.choices[0]?.message?.content;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Call Google Gemini API
 */
const callGemini = async (prompt, systemPrompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemPrompt}\n\n${prompt}`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API request failed');
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Call the configured AI provider
 */
const callAI = async (prompt, systemPrompt) => {
  const provider = process.env.AI_PROVIDER || 'openai';

  if (provider === 'gemini') {
    return callGemini(prompt, systemPrompt);
  } else {
    return callOpenAI(prompt, systemPrompt);
  }
};

/**
 * Get the model name used for caching purposes
 */
const getModelUsed = () => {
  const provider = process.env.AI_PROVIDER || 'openai';
  if (provider === 'gemini') {
    return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
};

/**
 * Generate hash for recap cache key from book ID and prior books
 */
const generateRecapHash = (bookId, priorBooks) => {
  const bookIds = [bookId, ...priorBooks.map(b => b.id)].sort().join(',');
  return crypto.createHash('md5').update(bookIds).digest('hex');
};

module.exports = {
  callOpenAI,
  callGemini,
  callAI,
  getModelUsed,
  generateRecapHash
};
