const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');
const { processAudiobook } = require('../services/fileProcessor');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../data/uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/m4a',
    'audio/m4b',
    'audio/x-m4a',
    'audio/x-m4b',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
  ];

  const allowedExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only audio files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
  },
});

// Upload audiobook
router.post('/', authenticateToken, upload.single('audiobook'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const userId = req.user.id;

    // Process the audiobook (extract metadata, move to library, etc.)
    const audiobook = await processAudiobook(filePath, userId, req.body);

    res.json({
      message: 'Audiobook uploaded successfully',
      audiobook: audiobook,
    });
  } catch (error) {
    console.error('Upload error:', error);
    // Clean up the uploaded file if processing failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Upload multiple audiobooks
router.post('/batch', authenticateToken, upload.array('audiobooks', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];
    const userId = req.user.id;

    for (const file of req.files) {
      try {
        const audiobook = await processAudiobook(file.path, userId);
        results.push({ success: true, filename: file.originalname, audiobook });
      } catch (error) {
        results.push({ success: false, filename: file.originalname, error: error.message });
        // Clean up failed file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.json({
      message: 'Batch upload completed',
      results: results,
    });
  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
