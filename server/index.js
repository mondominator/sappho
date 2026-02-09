require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const logger = require('./utils/logger');
const db = require('./database');
const { createDefaultAdmin } = require('./auth');
const { startPeriodicScan, stopPeriodicScan } = require('./services/libraryScanner');
const { startScheduledBackups } = require('./services/backupService');
const conversionService = require('./services/conversionService');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy headers (X-Forwarded-For) so rate limiting uses real client IPs
// Required when running behind Docker/nginx/reverse proxy
app.set('trust proxy', 1);

// SECURITY: Configure allowed origins for CORS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      console.error(`CORS rejected origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// SECURITY: Helmet for security headers with Vite-compatible CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.media-amazon.com', 'https://*.ssl-images-amazon.com', 'https://covers.openlibrary.org', 'https://books.google.com'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://www.googleapis.com', 'https://openlibrary.org', 'https://api.audible.com', 'https://api.audnex.us'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrcAttr: null, // remove script-src-attr restriction (Helmet default breaks some SPA patterns)
      upgradeInsecureRequests: null, // don't force HTTPS on localhost
    }
  },
  crossOriginEmbedderPolicy: { policy: 'credentialless' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
}));

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compression for text-based responses (HTML, CSS, JS, JSON)
// Skip audio streams - they're already compressed formats (MP3, M4B, etc.)
app.use(compression({
  filter: (req, res) => {
    // Don't compress audio streams (already compressed formats)
    if (req.path.includes('/stream')) return false;
    return compression.filter(req, res);
  }
}));

// Structured request logging (pino-http)
app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url.includes('/health')
  }
}));

// SECURITY: Global API rate limiter (baseline for all endpoints)
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalApiLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/audiobooks', require('./routes/audiobooks'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/api-keys', require('./routes/apiKeys'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/series', require('./routes/series'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/mfa', require('./routes/mfa'));
app.use('/api/email', require('./routes/email'));

// Health check
app.get('/api/health', (req, res) => {
  const packageJson = require('../package.json');
  res.json({
    status: 'ok',
    message: 'Sappho server is running',
    version: packageJson.version
  });
});

// Serve static files from the client/dist directory
const distPath = path.join(__dirname, '../client/dist');
const indexPath = path.join(distPath, 'index.html');

// Check if built frontend exists
const fs = require('fs');
if (fs.existsSync(distPath)) {
  console.log('Serving static frontend from:', distPath);

  // Serve static files with proper cache control
  app.use(express.static(distPath, {
    setHeaders: (res, path) => {
      // Never cache HTML files
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      // Never cache manifest.json or service worker
      else if (path.endsWith('manifest.json') || path.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      // Cache assets with hash in filename for 1 year
      else if (path.match(/\.(js|css)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend not built. Run: npm run build');
    }
  });
} else {
  console.warn('Frontend dist directory not found. Frontend will not be served.');
  app.get('*', (req, res) => {
    res.status(404).json({
      error: 'Frontend not available',
      message: 'The frontend has not been built. Please run: cd client && npm run build'
    });
  });
}

// Initialize
async function initialize() {
  try {
    // Wait for database to be ready before proceeding
    await db.ready;

    // Create default admin user if needed
    await createDefaultAdmin();

    // Start server immediately (don't wait for library scan)
    const server = app.listen(PORT, () => {
      console.log(`Sappho server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize WebSocket server for real-time notifications
    const websocketManager = require('./services/websocketManager');
    websocketManager.initialize(server);

    // Start periodic library scanning in background (default: every 5 minutes)
    // Can be configured with LIBRARY_SCAN_INTERVAL env var (in minutes)
    const scanInterval = parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5;
    startPeriodicScan(scanInterval);

    // Start scheduled backups if enabled (default: every 24 hours, keep 7)
    // Configure with AUTO_BACKUP_INTERVAL (hours, 0=disabled) and BACKUP_RETENTION (count)
    const backupInterval = parseInt(process.env.AUTO_BACKUP_INTERVAL) || 24;
    const backupRetention = parseInt(process.env.BACKUP_RETENTION) || 7;
    if (backupInterval > 0) {
      startScheduledBackups(backupInterval, backupRetention);
    }

    // Graceful shutdown handler
    let shuttingDown = false;
    function gracefulShutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received, shutting down gracefully...`);

      // Stop accepting new connections
      server.close(() => {
        console.log('HTTP server closed');
      });

      // Stop background services
      stopPeriodicScan();
      conversionService.shutdown();
      websocketManager.close();

      // Close database connection
      db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        else console.log('Database connection closed');
        process.exit(err ? 1 : 0);
      });

      // Force exit after 30 seconds if graceful shutdown stalls
      setTimeout(() => {
        console.error('Forced shutdown after 30s timeout');
        process.exit(1);
      }, 30000).unref();
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

initialize();
