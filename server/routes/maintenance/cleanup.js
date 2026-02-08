/**
 * Cleanup & Organization Routes
 * Detect orphan directories, clean them up, and organize audiobook files.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceLimiter, maintenanceWriteLimiter } = require('./helpers');

function register(router, { db, authenticateToken, organizeLibrary, getOrganizationPreview, organizeAudiobook, isScanningLocked, lockScanning, unlockScanning }) {
  // GET /orphan-directories - Scan for orphan directories
  router.get('/orphan-directories', maintenanceLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Scanning for orphan directories...');

      const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../../data/audiobooks');

      // Get all tracked file paths from database (normalized)
      const trackedFilesRaw = await new Promise((resolve, reject) => {
        db.all(
          `SELECT file_path FROM audiobooks WHERE is_available = 1 OR is_available IS NULL
           UNION
           SELECT file_path FROM audiobook_chapters`,
          (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []).map(r => r.file_path));
          }
        );
      });

      // Normalize paths and create a set of tracked directories
      const trackedFiles = new Set(trackedFilesRaw.map(f => path.normalize(f)));
      const trackedDirs = new Set(trackedFilesRaw.map(f => path.normalize(path.dirname(f))));

      // Audio file extensions to look for
      const audioExtensions = ['.m4b', '.m4a', '.mp3', '.flac', '.ogg', '.opus', '.wav', '.aac'];

      const orphanDirs = [];

      // Recursively scan directories
      function scanDirectory(dir, depth = 0) {
        if (depth > 10) return; // Prevent infinite recursion

        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_err) {
          return;
        }

        const subdirs = [];
        const files = [];

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue; // Skip hidden files

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            subdirs.push(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }

        // Check if this directory has any tracked audio files
        const normalizedDir = path.normalize(dir);
        const audioFiles = files.filter(f =>
          audioExtensions.includes(path.extname(f).toLowerCase())
        );
        const trackedAudioFiles = audioFiles.filter(f => trackedFiles.has(path.normalize(f)));
        const untrackedAudioFiles = audioFiles.filter(f => !trackedFiles.has(path.normalize(f)));

        // Determine if this is an orphan directory:
        // 1. Has untracked audio files, OR
        // 2. Has files but no audio files AND is not a directory containing tracked books, OR
        // 3. Is completely empty (no files, no subdirs) and not a tracked book directory
        const hasFiles = files.length > 0;
        const hasSubdirs = subdirs.length > 0;
        const hasNoAudioFiles = audioFiles.length === 0;
        const isTrackedBookDir = trackedDirs.has(normalizedDir);
        const hasOnlyMetadata = hasFiles && hasNoAudioFiles && !isTrackedBookDir;
        const isEmpty = !hasFiles && !hasSubdirs && !isTrackedBookDir;

        if (untrackedAudioFiles.length > 0 || hasOnlyMetadata || isEmpty) {
          // Calculate total size
          let totalSize = 0;
          for (const f of files) {
            try {
              totalSize += fs.statSync(f).size;
            } catch (_err) {
              // Ignore stat errors
            }
          }

          // Determine orphan type for UI display
          let orphanType = 'untracked_audio';
          if (isEmpty) {
            orphanType = 'empty';
          } else if (hasOnlyMetadata) {
            orphanType = 'metadata_only';
          } else if (trackedAudioFiles.length > 0 && untrackedAudioFiles.length > 0) {
            orphanType = 'mixed'; // Some tracked, some not
          }

          orphanDirs.push({
            path: dir,
            relativePath: path.relative(audiobooksDir, dir),
            fileCount: files.length,
            audioFileCount: audioFiles.length,
            untrackedAudioCount: untrackedAudioFiles.length,
            trackedAudioCount: trackedAudioFiles.length,
            files: files.map(f => path.basename(f)),
            totalSize,
            orphanType,
          });
        }

        // Recurse into subdirectories
        for (const subdir of subdirs) {
          scanDirectory(subdir, depth + 1);
        }
      }

      scanDirectory(audiobooksDir);

      console.log(`Found ${orphanDirs.length} orphan directories`);

      res.json({
        orphanDirectories: orphanDirs,
        totalCount: orphanDirs.length,
        totalSize: orphanDirs.reduce((sum, d) => sum + d.totalSize, 0),
      });
    } catch (error) {
      console.error('Error scanning for orphan directories:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /orphan-directories - Delete orphan directories
  router.delete('/orphan-directories', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { paths } = req.body;

    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'Must specify paths array' });
    }

    const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../../data/audiobooks');

    try {
      console.log(`Deleting ${paths.length} orphan directories...`);

      const results = {
        deleted: [],
        failed: [],
      };

      for (const dirPath of paths) {
        // Security check: ensure path is within audiobooks directory
        const fullPath = path.resolve(dirPath);
        const normalizedAudiobooksDir = path.resolve(audiobooksDir);

        if (!fullPath.startsWith(normalizedAudiobooksDir)) {
          results.failed.push({ path: dirPath, error: 'Path outside audiobooks directory' });
          continue;
        }

        // Don't delete the root audiobooks directory
        if (fullPath === normalizedAudiobooksDir) {
          results.failed.push({ path: dirPath, error: 'Cannot delete root audiobooks directory' });
          continue;
        }

        try {
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`Deleted orphan directory: ${fullPath}`);
            results.deleted.push(dirPath);

            // Clean up empty parent directories
            let parentDir = path.dirname(fullPath);
            while (parentDir !== normalizedAudiobooksDir) {
              try {
                const contents = fs.readdirSync(parentDir);
                if (contents.length === 0) {
                  fs.rmdirSync(parentDir);
                  console.log(`Removed empty parent directory: ${parentDir}`);
                  parentDir = path.dirname(parentDir);
                } else {
                  break;
                }
              } catch (_err) {
                break;
              }
            }
          } else {
            results.failed.push({ path: dirPath, error: 'Directory not found' });
          }
        } catch (error) {
          results.failed.push({ path: dirPath, error: error.message });
        }
      }

      console.log(`Deleted ${results.deleted.length} directories, ${results.failed.length} failed`);

      res.json({
        success: true,
        ...results,
      });
    } catch (error) {
      console.error('Error deleting orphan directories:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /organize/preview - Preview what would be organized (dry run)
  router.get('/organize/preview', maintenanceLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Getting organization preview...');
      const preview = await getOrganizationPreview();

      res.json({
        needsOrganization: preview.length,
        books: preview,
      });
    } catch (error) {
      console.error('Error getting organization preview:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /organize - Organize all audiobooks into correct directory structure
  router.post('/organize', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Check if any scan is in progress
    if (isScanningLocked()) {
      return res.status(409).json({ error: 'Library scan in progress. Please wait and try again.' });
    }

    lockScanning(); // Lock scans while organizing

    try {
      console.log('Starting manual library organization...');
      const stats = await organizeLibrary();

      res.json({
        success: true,
        message: 'Library organization complete',
        stats,
      });
    } catch (error) {
      console.error('Error organizing library:', error);
      res.status(500).json({ error: error.message });
    } finally {
      unlockScanning();
    }
  });

  // POST /organize/:id - Organize a single audiobook
  router.post('/organize/:id', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id } = req.params;

    try {
      // Get the audiobook
      const audiobook = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM audiobooks WHERE id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      const result = await organizeAudiobook(audiobook);

      if (result.moved) {
        res.json({
          success: true,
          message: 'Audiobook organized successfully',
          newPath: result.newPath,
        });
      } else if (result.error) {
        res.status(400).json({ error: result.error });
      } else {
        res.json({
          success: true,
          message: 'Audiobook already in correct location',
        });
      }
    } catch (error) {
      console.error('Error organizing audiobook:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { register };
