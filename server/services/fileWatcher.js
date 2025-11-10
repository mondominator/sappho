const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { processAudiobook } = require('./fileProcessor');

const watchDir = process.env.WATCH_DIR || path.join(__dirname, '../../data/watch');

// Ensure watch directory exists
if (!fs.existsSync(watchDir)) {
  fs.mkdirSync(watchDir, { recursive: true });
  console.log('Created watch directory at:', watchDir);
}

let watcher = null;
const processingFiles = new Set();

function startFileWatcher() {
  if (watcher) {
    console.log('File watcher already running');
    return;
  }

  console.log('Starting file watcher for directory:', watchDir);

  watcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', async (filePath) => {
      // Only process audio files
      const ext = path.extname(filePath).toLowerCase();
      const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];

      if (!audioExtensions.includes(ext)) {
        console.log('Ignoring non-audio file:', filePath);
        return;
      }

      // Prevent processing the same file multiple times
      if (processingFiles.has(filePath)) {
        return;
      }

      processingFiles.add(filePath);
      console.log('New audiobook detected:', filePath);

      try {
        // Process with system user ID (1) or create a specific import user
        await processAudiobook(filePath, 1);
        console.log('Successfully processed:', filePath);
      } catch (error) {
        console.error('Error processing file:', filePath, error);
        // Move failed file to a failed directory
        const failedDir = path.join(watchDir, 'failed');
        if (!fs.existsSync(failedDir)) {
          fs.mkdirSync(failedDir, { recursive: true });
        }
        const failedPath = path.join(failedDir, path.basename(filePath));
        try {
          fs.renameSync(filePath, failedPath);
          console.log('Moved failed file to:', failedPath);
        } catch (moveError) {
          console.error('Could not move failed file:', moveError);
        }
      } finally {
        processingFiles.delete(filePath);
      }
    })
    .on('error', (error) => {
      console.error('File watcher error:', error);
    })
    .on('ready', () => {
      console.log('File watcher ready and monitoring:', watchDir);
    });
}

function stopFileWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('File watcher stopped');
  }
}

module.exports = {
  startFileWatcher,
  stopFileWatcher,
};
