require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createDefaultAdmin } = require('./auth');
const { startPeriodicScan } = require('./services/libraryScanner');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sapho server is running' });
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
