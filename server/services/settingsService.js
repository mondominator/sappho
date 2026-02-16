/**
 * Settings Service
 *
 * Persisted settings management: loading, saving, and validation of
 * server configuration stored in a settings.env file. Also provides
 * the recap prompt for AI-powered series recaps.
 */

const fs = require('fs');
const path = require('path');

// Get the persisted settings file path (inside DATA_DIR so it survives container restarts)
const getSettingsPath = () => {
  const dataDir = process.env.DATA_DIR || '/app/data';
  return path.join(dataDir, 'settings.env');
};

// Load persisted settings on startup
const loadPersistedSettings = () => {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    const content = fs.readFileSync(settingsPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Only set if not already set by environment (docker-compose takes priority)
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
};

// Load settings immediately when module loads
loadPersistedSettings();

// Helper to update persisted settings file
const updateEnvFile = (updates) => {
  // SECURITY: Validate keys and values to prevent injection
  for (const [key, value] of Object.entries(updates)) {
    if (!/^[A-Z_]+$/.test(key)) {
      throw new Error(`Invalid settings key: ${key}`);
    }
    if (typeof value === 'string' && value.includes('\n')) {
      throw new Error(`Settings value for ${key} must not contain newlines`);
    }
  }

  const settingsPath = getSettingsPath();
  let envContent = '';

  // Ensure data directory exists
  const dataDir = path.dirname(settingsPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(settingsPath)) {
    envContent = fs.readFileSync(settingsPath, 'utf8');
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

  fs.writeFileSync(settingsPath, envContent);
};

// Helper to validate directory path
const validateDirectory = (dir) => {
  try {
    // SECURITY: Reject paths with null bytes or non-string input
    if (typeof dir !== 'string' || dir.includes('\0')) {
      return false;
    }
    // SECURITY: Only allow absolute paths (expected in Docker container)
    if (!path.isAbsolute(dir)) {
      return false;
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (_error) {
    return false;
  }
};

// Track which env vars were set at startup (before any settings file changes)
// These are "locked" because they come from docker-compose or system environment
const startupEnvVars = {};
const ENV_VAR_KEYS = ['PORT', 'NODE_ENV', 'DATABASE_PATH', 'DATA_DIR', 'AUDIOBOOKS_DIR', 'UPLOAD_DIR', 'LIBRARY_SCAN_INTERVAL', 'AUTO_BACKUP_INTERVAL', 'BACKUP_RETENTION', 'LOG_BUFFER_SIZE'];

// Capture startup values - this runs once when the module loads
(() => {
  // Read settings file to see what's defined there
  const settingsPath = getSettingsPath();
  const settingsFileVars = new Set();

  if (fs.existsSync(settingsPath)) {
    const content = fs.readFileSync(settingsPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=/);
      if (match) {
        settingsFileVars.add(match[1]);
      }
    }
  }

  // A variable is "locked" if it's set in process.env but NOT in settings file
  // This means it came from docker-compose, system env, or command line
  for (const key of ENV_VAR_KEYS) {
    if (process.env[key] && !settingsFileVars.has(key)) {
      startupEnvVars[key] = true;
    }
  }
})();

// Default recap system prompt
const DEFAULT_RECAP_PROMPT = `You are recapping a book series for someone who has ALREADY READ the books and wants to remember what happened.

Write a THOROUGH recap - aim for at least 2-3 paragraphs per book covering all major plot points.

CRITICAL: Be EXPLICIT and SPECIFIC. Never be vague.
- BAD: "A major character dies" or "There is a betrayal" or "A secret is revealed"
- GOOD: "Jon kills Daenerys to stop her from burning more cities" or "Snape kills Dumbledore on Dumbledore's own orders" or "Luke discovers Darth Vader is his father"

For each completed book, cover:
- The main plot and how it unfolds
- Character names and what specifically happens to them
- Who dies and how (name them, describe the death)
- Who betrays whom and what exactly they did
- What secrets are revealed (state the actual secret)
- Romantic relationships: who ends up together, who breaks up, key moments
- Major battles/confrontations and their outcomes
- How the book ends and any cliffhangers leading to the next book

IMPORTANT: Only spoil books marked as COMPLETED. Do not spoil unread books.

FORMAT: Use markdown formatting for readability - bold (**text**) for character names and key events, headers (##) for book titles.`;

// Offensive mode addition to prompt
const OFFENSIVE_MODE_PROMPT = `

STYLE: Be funny, irreverent, and use colorful language. Roast the characters and their decisions. Use profanity freely. Mock plot holes and clichés. Think of this as a drunk friend recapping the books at a party - entertaining, crude, but still hitting all the important plot points.`;

// Get the current recap prompt (exported for use in series.js)
const getRecapPrompt = () => {
  const rawPrompt = process.env.RECAP_CUSTOM_PROMPT;
  // Decode escaped newlines from env file storage
  const customPrompt = rawPrompt ? rawPrompt.replace(/\\n/g, '\n') : rawPrompt;
  const offensiveMode = process.env.RECAP_OFFENSIVE_MODE === 'true';

  let prompt = customPrompt || DEFAULT_RECAP_PROMPT;
  if (offensiveMode) {
    prompt += OFFENSIVE_MODE_PROMPT;
  }
  return prompt;
};

module.exports = {
  getSettingsPath,
  loadPersistedSettings,
  updateEnvFile,
  validateDirectory,
  startupEnvVars,
  DEFAULT_RECAP_PROMPT,
  OFFENSIVE_MODE_PROMPT,
  getRecapPrompt
};
