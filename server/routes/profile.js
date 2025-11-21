const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');

// Configure multer for avatar upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../data/avatars');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `user-${req.user.id}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);

    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get profile
router.get('/', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, display_name, avatar, is_admin FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    }
  );
});

// Update profile
router.put('/', authenticateToken, upload.single('avatar'), (req, res) => {
  const { displayName, email } = req.body;
  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(displayName || null);
  }

  if (email !== undefined) {
    updates.push('email = ?');
    params.push(email || null);
  }

  if (req.file) {
    updates.push('avatar = ?');
    params.push(req.file.filename);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  params.push(req.user.id);

  db.run(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ message: 'Profile updated successfully' });
    }
  );
});

// Get avatar
router.get('/avatar', authenticateToken, (req, res) => {
  db.get(
    'SELECT avatar FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err || !user || !user.avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      const avatarPath = path.join(__dirname, '../../data/avatars', user.avatar);

      if (!fs.existsSync(avatarPath)) {
        return res.status(404).json({ error: 'Avatar file not found' });
      }

      res.sendFile(avatarPath);
    }
  );
});

// Delete avatar
router.delete('/avatar', authenticateToken, (req, res) => {
  db.get('SELECT avatar FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (user && user.avatar) {
      const avatarPath = path.join(__dirname, '../../data/avatars', user.avatar);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }

    db.run(
      'UPDATE users SET avatar = NULL WHERE id = ?',
      [req.user.id],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Avatar removed successfully' });
      }
    );
  });
});

module.exports = router;
