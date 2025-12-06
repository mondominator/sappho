const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');

// SECURITY: JWT_SECRET must be explicitly configured - no default fallback
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.');
  console.error('Please set a strong secret: export JWT_SECRET=$(openssl rand -base64 32)');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

// Middleware to verify JWT token or API key
function authenticateToken(req, res, next) {
  // Check for token in header first, then query parameter
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Check if it's an API key (starts with 'sapho_')
  if (token && token.startsWith('sapho_')) {
    return authenticateApiKey(token, req, res, next);
  }

  // If no token in header, check query parameter
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Helper function to authenticate API keys
function authenticateApiKey(apiKey, req, res, next) {
  // Hash the provided API key
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Look up the API key in the database
  db.get(
    `SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1`,
    [keyHash],
    (err, key) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!key) {
        return res.status(403).json({ error: 'Invalid API key' });
      }

      // Check if key is expired
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        return res.status(403).json({ error: 'API key has expired' });
      }

      // Update last_used_at timestamp
      db.run(
        'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
        [key.id],
        (updateErr) => {
          if (updateErr) {
            console.error('Failed to update API key last_used_at:', updateErr);
          }
        }
      );

      // Get user information
      db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [key.user_id], (userErr, user) => {
        if (userErr || !user) {
          return res.status(403).json({ error: 'Invalid API key user' });
        }

        // Set user on request object
        req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
        req.apiKey = key;
        next();
      });
    }
  );
}

// Middleware to check admin privileges
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

// Register new user
async function register(username, password, email = null) {
  return new Promise((resolve, reject) => {
    // Hash password
    const passwordHash = bcrypt.hashSync(password, 10);

    db.run(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            reject(new Error('Username already exists'));
          } else {
            reject(err);
          }
        } else {
          resolve({ id: this.lastID, username, email });
        }
      }
    );
  });
}

// Login user
async function login(username, password) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?',
      [username],
      (err, user) => {
        if (err) {
          reject(err);
        } else if (!user) {
          reject(new Error('Invalid username or password'));
        } else {
          const isValid = bcrypt.compareSync(password, user.password_hash);
          if (!isValid) {
            reject(new Error('Invalid username or password'));
          } else {
            const token = jwt.sign(
              { id: user.id, username: user.username, is_admin: user.is_admin },
              JWT_SECRET,
              { expiresIn: '7d' }
            );
            resolve({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
          }
        }
      }
    );
  });
}

// Generate a secure random password
function generateSecurePassword(length = 16) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}

// Create default admin user if no users exist
async function createDefaultAdmin() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM users', [], async (err, row) => {
      if (err) {
        reject(err);
      } else if (row.count === 0) {
        // SECURITY: Generate a random password instead of using a default
        const generatedPassword = generateSecurePassword(16);
        const passwordHash = bcrypt.hashSync(generatedPassword, 10);
        db.run(
          'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
          ['admin', passwordHash],
          function (err) {
            if (err) {
              reject(err);
            } else {
              console.log('');
              console.log('╔════════════════════════════════════════════════════════════╗');
              console.log('║           DEFAULT ADMIN ACCOUNT CREATED                    ║');
              console.log('╠════════════════════════════════════════════════════════════╣');
              console.log('║  Username: admin                                           ║');
              console.log(`║  Password: ${generatedPassword}                            ║`);
              console.log('╠════════════════════════════════════════════════════════════╣');
              console.log('║  ⚠️  SAVE THIS PASSWORD - IT WILL NOT BE SHOWN AGAIN!     ║');
              console.log('║  Change it after first login via Profile > Security        ║');
              console.log('╚════════════════════════════════════════════════════════════╝');
              console.log('');
              resolve();
            }
          }
        );
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  authenticateToken,
  requireAdmin,
  register,
  login,
  createDefaultAdmin,
};
