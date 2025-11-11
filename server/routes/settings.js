const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../auth');

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

  // Validate paths exist or can be created
  const paths = [libraryPath, uploadPath];
  for (const dir of paths) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      return res.status(400).json({ error: `Invalid path or cannot create directory: ${dir}` });
    }
  }

  // Update .env file
  const envPath = path.join(__dirname, '../../.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Update or add environment variables
  const updateEnv = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    } else {
      return content + `\n${key}=${value}`;
    }
  };

  envContent = updateEnv(envContent, 'AUDIOBOOKS_DIR', libraryPath);
  envContent = updateEnv(envContent, 'UPLOAD_DIR', uploadPath);

  fs.writeFileSync(envPath, envContent);

  // Update process.env for current session
  process.env.AUDIOBOOKS_DIR = libraryPath;
  process.env.UPLOAD_DIR = uploadPath;

  res.json({ message: 'Library settings updated successfully.' });
});

module.exports = router;
