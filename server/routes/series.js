const express = require('express');
const router = express.Router();
const db = require('../database');
const crypto = require('crypto');
const { authenticateToken } = require('../auth');
const { getRecapPrompt } = require('./settings');

// Helper to generate hash of books read for cache key
const generateBooksHash = (books) => {
  const bookIds = books.map(b => b.id).sort().join(',');
  return crypto.createHash('md5').update(bookIds).digest('hex');
};

// Helper to call OpenAI API
const callOpenAI = async (prompt, systemPrompt) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
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
};

// Helper to call Google Gemini API
const callGemini = async (prompt, systemPrompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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
};

// Helper to call the configured AI provider
const callAI = async (prompt, systemPrompt) => {
  const provider = process.env.AI_PROVIDER || 'openai';

  if (provider === 'gemini') {
    return callGemini(prompt, systemPrompt);
  } else {
    return callOpenAI(prompt, systemPrompt);
  }
};

// Get the model used for caching purposes
const getModelUsed = () => {
  const provider = process.env.AI_PROVIDER || 'openai';
  if (provider === 'gemini') {
    return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
};

// Get series recap (catch me up)
router.get('/:seriesName/recap', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const seriesName = decodeURIComponent(req.params.seriesName);

  try {
    // Get all books in this series with user's progress
    const books = await new Promise((resolve, reject) => {
      db.all(
        `SELECT a.id, a.title, a.author, a.description, a.series_position,
                COALESCE(p.position, 0) as position,
                COALESCE(p.completed, 0) as completed,
                a.duration
         FROM audiobooks a
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.series = ?
         ORDER BY a.series_position ASC, a.title ASC`,
        [userId, seriesName],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    if (books.length === 0) {
      return res.status(404).json({ error: 'Series not found' });
    }

    // Determine which books the user has read or is reading
    const booksRead = books.filter(b => b.completed === 1 || b.position > 0);

    if (booksRead.length === 0) {
      return res.status(400).json({
        error: 'No progress in this series yet',
        message: 'Start listening to a book in this series to get a recap.'
      });
    }

    // Generate cache hash based on books read
    const booksHash = generateBooksHash(booksRead);

    // Check cache first
    const cached = await new Promise((resolve, reject) => {
      db.get(
        `SELECT recap_text, created_at FROM series_recaps
         WHERE user_id = ? AND series_name = ? AND books_hash = ?`,
        [userId, seriesName, booksHash],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (cached) {
      return res.json({
        recap: cached.recap_text,
        cached: true,
        cachedAt: cached.created_at,
        booksIncluded: booksRead.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
      });
    }

    // Check if AI is configured
    const provider = process.env.AI_PROVIDER || 'openai';
    const hasApiKey = provider === 'gemini'
      ? !!process.env.GEMINI_API_KEY
      : !!process.env.OPENAI_API_KEY;

    if (!hasApiKey) {
      return res.status(400).json({
        error: 'AI not configured',
        message: 'Please configure an AI provider in Administration > AI settings.'
      });
    }

    // Build prompt
    const booksNotRead = books.filter(b => b.completed !== 1 && b.position === 0);

    // Get the system prompt from settings (supports custom prompt and offensive mode)
    const systemPrompt = getRecapPrompt();

    const bookDescriptions = booksRead.map(b => {
      const status = b.completed ? 'completed' : 'in progress';
      return `Book ${b.series_position || '?'}: "${b.title}" (${status})${b.description ? `\nDescription: ${b.description.substring(0, 500)}` : ''}`;
    }).join('\n\n');

    const booksToAvoid = booksNotRead.length > 0
      ? `\n\nBOOKS NOT YET READ (DO NOT SPOIL): ${booksNotRead.map(b => `"${b.title}"`).join(', ')}`
      : '';

    const prompt = `Please provide a detailed recap of the "${seriesName}" series by ${books[0].author || 'Unknown Author'}.

The reader has read/is reading the following books:

${bookDescriptions}
${booksToAvoid}

Provide a thorough recap including major plot points, twists, and revelations from COMPLETED books. The reader wants to remember what happened before continuing. Only avoid spoilers for books not yet started.`;

    // Call AI provider
    const recap = await callAI(prompt, systemPrompt);

    // Cache the result
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, seriesName, booksHash, recap, getModelUsed()],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      recap,
      cached: false,
      booksIncluded: booksRead.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
    });

  } catch (error) {
    console.error('Error generating series recap:', error);
    res.status(500).json({
      error: 'Failed to generate recap',
      message: error.message
    });
  }
});

// Clear cached recap (force regeneration)
router.delete('/:seriesName/recap', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const seriesName = decodeURIComponent(req.params.seriesName);

  try {
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM series_recaps WHERE user_id = ? AND series_name = ?',
        [userId, seriesName],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ message: 'Recap cache cleared' });
  } catch (error) {
    console.error('Error clearing recap cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

module.exports = router;
