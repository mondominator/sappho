require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createDefaultAdmin } = require('./auth');
const { startFileWatcher } = require('./services/fileWatcher');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/audiobooks', require('./routes/audiobooks'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/api-keys', require('./routes/apiKeys'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/settings', require('./routes/settings'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sapho server is running' });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Initialize
async function initialize() {
  try {
    // Create default admin user if needed
    await createDefaultAdmin();

    // Start file watcher
    startFileWatcher();

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`Sapho server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize WebSocket server for real-time notifications
    const websocketManager = require('./services/websocketManager');
    websocketManager.initialize(server);
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

initialize();
