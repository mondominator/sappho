const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../auth');

// Helper to update .env file
const updateEnvFile = (updates) => {
  const envPath = path.join(__dirname, '../../.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const updateEnv = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    } else {
      return content + (content.endsWith('\n') ? '' : '\n') + `${key}=${value}`;
    }
  };

  for (const [key, value] of Object.entries(updates)) {
    envContent = updateEnv(envContent, key, value);
    process.env[key] = value;
  }

  fs.writeFileSync(envPath, envContent);
};

// Helper to validate directory path
const validateDirectory = (dir) => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (error) {
    return false;
  }
};

// Track which env vars were set at startup (before any .env file changes)
// These are "locked" because they come from docker-compose or system environment
const startupEnvVars = {};
const ENV_VAR_KEYS = ['PORT', 'NODE_ENV', 'DATABASE_PATH', 'DATA_DIR', 'AUDIOBOOKS_DIR', 'UPLOAD_DIR', 'LIBRARY_SCAN_INTERVAL'];

// Capture startup values - this runs once when the module loads
(() => {
  // Read .env file to see what's defined there
  const envPath = path.join(__dirname, '../../.env');
  const envFileVars = new Set();

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=/);
      if (match) {
        envFileVars.add(match[1]);
      }
    }
  }

  // A variable is "locked" if it's set in process.env but NOT in .env file
  // This means it came from docker-compose, system env, or command line
  for (const key of ENV_VAR_KEYS) {
    if (process.env[key] && !envFileVars.has(key)) {
      startupEnvVars[key] = true;
    }
  }
})();

// Get all settings
router.get('/all', authenticateToken, requireAdmin, (req, res) => {
  const settings = {
    // Server settings
    port: process.env.PORT || '3001',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Paths
    databasePath: process.env.DATABASE_PATH || '/app/data/sapho.db',
    dataDir: process.env.DATA_DIR || '/app/data',
    audiobooksDir: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
    uploadDir: process.env.UPLOAD_DIR || '/app/data/uploads',

    // Library settings
    libraryScanInterval: parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5,
  };

  // Map env var names to setting keys
  const envToKey = {
    PORT: 'port',
    NODE_ENV: 'nodeEnv',
    DATABASE_PATH: 'databasePath',
    DATA_DIR: 'dataDir',
    AUDIOBOOKS_DIR: 'audiobooksDir',
    UPLOAD_DIR: 'uploadDir',
    LIBRARY_SCAN_INTERVAL: 'libraryScanInterval',
  };

  // Build locked fields list
  const lockedFields = [];
  for (const [envVar, isLocked] of Object.entries(startupEnvVars)) {
    if (isLocked && envToKey[envVar]) {
      lockedFields.push(envToKey[envVar]);
    }
  }

  res.json({ settings, lockedFields });
});

// Update all settings
router.put('/all', authenticateToken, requireAdmin, (req, res) => {
  const {
    port,
    nodeEnv,
    databasePath,
    dataDir,
    audiobooksDir,
    uploadDir,
    libraryScanInterval,
  } = req.body;

  const errors = [];
  const updates = {};
  const requiresRestart = [];

  // Map setting keys to env var names for lock checking
  const keyToEnv = {
    port: 'PORT',
    nodeEnv: 'NODE_ENV',
    databasePath: 'DATABASE_PATH',
    dataDir: 'DATA_DIR',
    audiobooksDir: 'AUDIOBOOKS_DIR',
    uploadDir: 'UPLOAD_DIR',
    libraryScanInterval: 'LIBRARY_SCAN_INTERVAL',
  };

  // Check for attempts to modify locked fields
  const lockedAttempts = [];
  for (const [key, value] of Object.entries(req.body)) {
    if (value !== undefined && keyToEnv[key] && startupEnvVars[keyToEnv[key]]) {
      lockedAttempts.push(key);
    }
  }

  if (lockedAttempts.length > 0) {
    return res.status(400).json({
      errors: [`Cannot modify locked settings: ${lockedAttempts.join(', ')}. These are set via environment variables (docker-compose.yml).`]
    });
  }

  // Validate and collect updates

  // Port
  if (port !== undefined) {
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('Port must be between 1 and 65535');
    } else {
      updates.PORT = portNum.toString();
      requiresRestart.push('PORT');
    }
  }

  // Node environment
  if (nodeEnv !== undefined) {
    if (!['development', 'production'].includes(nodeEnv)) {
      errors.push('Environment must be "development" or "production"');
    } else {
      updates.NODE_ENV = nodeEnv;
      requiresRestart.push('NODE_ENV');
    }
  }

  // Database path
  if (databasePath !== undefined) {
    const dbDir = path.dirname(databasePath);
    if (!validateDirectory(dbDir)) {
      errors.push(`Cannot create database directory: ${dbDir}`);
    } else {
      updates.DATABASE_PATH = databasePath;
      requiresRestart.push('DATABASE_PATH');
    }
  }

  // Data directory
  if (dataDir !== undefined) {
    if (!validateDirectory(dataDir)) {
      errors.push(`Cannot create data directory: ${dataDir}`);
    } else {
      updates.DATA_DIR = dataDir;
    }
  }

  // Audiobooks directory
  if (audiobooksDir !== undefined) {
    if (!validateDirectory(audiobooksDir)) {
      errors.push(`Cannot create audiobooks directory: ${audiobooksDir}`);
    } else {
      updates.AUDIOBOOKS_DIR = audiobooksDir;
    }
  }

  // Upload directory
  if (uploadDir !== undefined) {
    if (!validateDirectory(uploadDir)) {
      errors.push(`Cannot create upload directory: ${uploadDir}`);
    } else {
      updates.UPLOAD_DIR = uploadDir;
    }
  }

  // Library scan interval
  if (libraryScanInterval !== undefined) {
    const interval = parseInt(libraryScanInterval);
    if (isNaN(interval) || interval < 1 || interval > 1440) {
      errors.push('Scan interval must be between 1 and 1440 minutes');
    } else {
      updates.LIBRARY_SCAN_INTERVAL = interval.toString();
    }
  }

  // Return errors if any
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    updateEnvFile(updates);
  }

  res.json({
    message: 'Settings updated successfully.',
    updated: Object.keys(updates),
    requiresRestart: requiresRestart.length > 0 ? requiresRestart : undefined,
  });
});

// Legacy endpoints for backwards compatibility

// Get library settings
router.get('/library', authenticateToken, requireAdmin, (req, res) => {
  const settings = {
    libraryPath: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
    uploadPath: process.env.UPLOAD_DIR || '/app/data/uploads'
  };
  res.json(settings);
});

// Update library settings
router.put('/library', authenticateToken, requireAdmin, (req, res) => {
  const { libraryPath, uploadPath } = req.body;

  if (!libraryPath || !uploadPath) {
    return res.status(400).json({ error: 'All paths are required' });
  }

  if (!validateDirectory(libraryPath)) {
    return res.status(400).json({ error: `Invalid path or cannot create directory: ${libraryPath}` });
  }
  if (!validateDirectory(uploadPath)) {
    return res.status(400).json({ error: `Invalid path or cannot create directory: ${uploadPath}` });
  }

  updateEnvFile({
    AUDIOBOOKS_DIR: libraryPath,
    UPLOAD_DIR: uploadPath,
  });

  res.json({ message: 'Library settings updated successfully.' });
});

// Get server settings (redirects to /all for consistency)
router.get('/server', authenticateToken, requireAdmin, (req, res) => {
  const settings = {
    port: process.env.PORT || '3001',
    nodeEnv: process.env.NODE_ENV || 'development',
    databasePath: process.env.DATABASE_PATH || '/app/data/sapho.db',
    dataDir: process.env.DATA_DIR || '/app/data',
    audiobooksDir: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
    uploadDir: process.env.UPLOAD_DIR || '/app/data/uploads',
    libraryScanInterval: parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5,
  };

  // Map env var names to setting keys
  const envToKey = {
    PORT: 'port',
    NODE_ENV: 'nodeEnv',
    DATABASE_PATH: 'databasePath',
    DATA_DIR: 'dataDir',
    AUDIOBOOKS_DIR: 'audiobooksDir',
    UPLOAD_DIR: 'uploadDir',
    LIBRARY_SCAN_INTERVAL: 'libraryScanInterval',
  };

  // Build locked fields list
  const lockedFields = [];
  for (const [envVar, isLocked] of Object.entries(startupEnvVars)) {
    if (isLocked && envToKey[envVar]) {
      lockedFields.push(envToKey[envVar]);
    }
  }

  res.json({ settings, lockedFields });
});

// Update server settings (redirect to /all)
router.put('/server', authenticateToken, requireAdmin, (req, res, next) => {
  req.url = '/all';
  router.handle(req, res, next);
});

// Get AI settings
router.get('/ai', authenticateToken, requireAdmin, (req, res) => {
  const settings = {
    aiProvider: process.env.AI_PROVIDER || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY ? '••••••••' : '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY ? '••••••••' : '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  };

  res.json({ settings });
});

// Check if AI is configured (public endpoint for UI)
router.get('/ai/status', authenticateToken, (req, res) => {
  const provider = process.env.AI_PROVIDER || 'openai';
  const hasApiKey = provider === 'gemini'
    ? !!process.env.GEMINI_API_KEY
    : !!process.env.OPENAI_API_KEY;

  res.json({ configured: hasApiKey, provider });
});

// Update AI settings
router.put('/ai', authenticateToken, requireAdmin, (req, res) => {
  const { aiProvider, openaiApiKey, openaiModel, geminiApiKey, geminiModel } = req.body;
  const updates = {};

  // Update provider
  if (aiProvider) {
    if (!['openai', 'gemini'].includes(aiProvider)) {
      return res.status(400).json({ error: 'Invalid AI provider' });
    }
    updates.AI_PROVIDER = aiProvider;
  }

  // Only update API key if it's not the masked placeholder
  if (openaiApiKey && !openaiApiKey.includes('••••')) {
    updates.OPENAI_API_KEY = openaiApiKey;
  }

  if (openaiModel) {
    const validModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    if (!validModels.includes(openaiModel)) {
      return res.status(400).json({ error: 'Invalid OpenAI model selected' });
    }
    updates.OPENAI_MODEL = openaiModel;
  }

  // Gemini settings
  if (geminiApiKey && !geminiApiKey.includes('••••')) {
    updates.GEMINI_API_KEY = geminiApiKey;
  }

  if (geminiModel) {
    const validGeminiModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];
    if (!validGeminiModels.includes(geminiModel)) {
      return res.status(400).json({ error: 'Invalid Gemini model selected' });
    }
    updates.GEMINI_MODEL = geminiModel;
  }

  if (Object.keys(updates).length > 0) {
    updateEnvFile(updates);
  }

  res.json({ message: 'AI settings updated successfully' });
});

// Test AI connection
router.post('/ai/test', authenticateToken, requireAdmin, async (req, res) => {
  const { aiProvider, openaiApiKey, openaiModel, geminiApiKey, geminiModel } = req.body;

  const provider = aiProvider || process.env.AI_PROVIDER || 'openai';

  if (provider === 'gemini') {
    // Test Gemini
    const apiKey = (geminiApiKey && !geminiApiKey.includes('••••'))
      ? geminiApiKey
      : process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No Gemini API key provided' });
    }

    const model = geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Say "Connection successful!" in exactly those words.'
            }]
          }],
          generationConfig: {
            maxOutputTokens: 20
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        return res.status(400).json({
          error: error.error?.message || 'Gemini API request failed'
        });
      }

      const data = await response.json();
      res.json({
        message: `Connection successful! Model: ${model}`,
        response: data.candidates?.[0]?.content?.parts?.[0]?.text
      });
    } catch (error) {
      console.error('Gemini test error:', error);
      res.status(500).json({ error: 'Failed to connect to Gemini API' });
    }
  } else {
    // Test OpenAI
    const apiKey = (openaiApiKey && !openaiApiKey.includes('••••'))
      ? openaiApiKey
      : process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No OpenAI API key provided' });
    }

    const model = openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'Say "Connection successful!" in exactly those words.' }],
          max_tokens: 20
        })
      });

      if (!response.ok) {
        const error = await response.json();
        return res.status(400).json({
          error: error.error?.message || 'API request failed'
        });
      }

      const data = await response.json();
      res.json({
        message: `Connection successful! Model: ${model}`,
        response: data.choices[0]?.message?.content
      });
    } catch (error) {
      console.error('OpenAI test error:', error);
      res.status(500).json({ error: 'Failed to connect to OpenAI API' });
    }
  }
});

module.exports = router;
