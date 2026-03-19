/**
 * Environment Variable Validation
 *
 * Validates that all required environment variables are set at startup.
 * Called early in server initialization to fail fast on misconfiguration.
 */

const logger = require('./logger');

/**
 * Required environment variables that the server cannot function without.
 * Each entry has: name, description, and optional validation function.
 */
const REQUIRED_VARS = [
  {
    name: 'JWT_SECRET',
    description: 'Secret key for signing JWT tokens',
    validate: (value) => {
      if (value.length < 32) {
        return 'JWT_SECRET must be at least 32 characters long';
      }
      return null;
    },
  },
];

/**
 * Optional environment variables with their defaults and descriptions.
 * Logged at startup for visibility into the running configuration.
 */
const OPTIONAL_VARS = [
  { name: 'PORT', default: '3001', description: 'Server port' },
  { name: 'NODE_ENV', default: 'development', description: 'Environment mode' },
  { name: 'DATABASE_PATH', default: 'data/sappho.db', description: 'SQLite database path' },
  { name: 'AUDIOBOOKS_DIR', default: 'data/audiobooks', description: 'Audiobooks directory' },
  { name: 'DATA_DIR', default: '/app/data', description: 'Base data directory' },
  { name: 'UPLOAD_DIR', default: 'data/uploads', description: 'Upload directory' },
  { name: 'CORS_ORIGINS', default: 'localhost origins', description: 'Allowed CORS origins' },
  { name: 'LOG_LEVEL', default: 'info', description: 'Logging level' },
  { name: 'LIBRARY_SCAN_INTERVAL', default: '5', description: 'Library scan interval (minutes)' },
  { name: 'AUTO_BACKUP_INTERVAL', default: '24', description: 'Auto backup interval (hours, 0=disabled)' },
  { name: 'BACKUP_RETENTION', default: '7', description: 'Number of backups to retain' },
];

/**
 * Validate all required environment variables.
 * Exits the process with code 1 if any required variable is missing or invalid.
 */
function validateEnv() {
  const errors = [];

  for (const varDef of REQUIRED_VARS) {
    const value = process.env[varDef.name];

    if (!value) {
      errors.push(`Missing required env var: ${varDef.name} - ${varDef.description}`);
      continue;
    }

    if (varDef.validate) {
      const validationError = varDef.validate(value);
      if (validationError) {
        errors.push(`Invalid ${varDef.name}: ${validationError}`);
      }
    }
  }

  if (errors.length > 0) {
    // Use console.error here intentionally - logger may not work without valid env
    console.error('');
    console.error('='.repeat(60));
    console.error('ENVIRONMENT VALIDATION FAILED');
    console.error('='.repeat(60));
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error('');
    console.error('Hint: Set JWT_SECRET with: export JWT_SECRET=$(openssl rand -base64 32)');
    console.error('='.repeat(60));
    console.error('');
    process.exit(1);
  }

  // Log optional variable status at debug level
  if (logger && logger.debug) {
    const configuredOptional = OPTIONAL_VARS.filter(v => process.env[v.name]);
    const defaultOptional = OPTIONAL_VARS.filter(v => !process.env[v.name]);

    if (configuredOptional.length > 0) {
      logger.debug(
        { vars: configuredOptional.map(v => v.name) },
        'Custom environment variables configured'
      );
    }
    if (defaultOptional.length > 0) {
      logger.debug(
        { vars: defaultOptional.map(v => `${v.name}=${v.default}`) },
        'Using default values for optional environment variables'
      );
    }
  }
}

module.exports = { validateEnv, REQUIRED_VARS, OPTIONAL_VARS };
