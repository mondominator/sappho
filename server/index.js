require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { createDefaultAdmin } = require('./auth');
const { startPeriodicScan } = require('./services/libraryScanner');

const app = express();
const PORT = process.env.PORT || 3001;

// SECURITY: Configure allowed origins for CORS
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// SECURITY: Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for audio streaming
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

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

// Health check
app.get('/api/health', (req, res) => {
  const packageJson = require('../package.json');
  res.json({
    status: 'ok',
    message: 'Sapho server is running',
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
    // Create default admin user if needed
    await createDefaultAdmin();

    // Start server immediately (don't wait for library scan)
    const server = app.listen(PORT, () => {
      console.log(`Sapho server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize WebSocket server for real-time notifications
    const websocketManager = require('./services/websocketManager');
    websocketManager.initialize(server);

    // Start periodic library scanning in background (default: every 5 minutes)
    // Can be configured with LIBRARY_SCAN_INTERVAL env var (in minutes)
    const scanInterval = parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5;
    startPeriodicScan(scanInterval);
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

initialize();
