const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateToken, requireAdmin } = require('../auth');
const emailService = require('../services/emailService');

// Rate limit for email sending
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 emails per 15 minutes
  message: { error: 'Too many email requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// =====================================
// Admin Routes - SMTP Configuration
// =====================================

/**
 * GET /api/email/settings
 * Get current SMTP settings (admin only)
 * Password is masked in response
 */
router.get('/settings', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const settings = await emailService.getSMTPSettings();

    if (!settings) {
      return res.json({
        host: '',
        port: 587,
        secure: false,
        username: '',
        password: '',
        from_address: '',
        from_name: 'Sappho',
        enabled: false
      });
    }

    // Mask password for security
    res.json({
      ...settings,
      secure: !!settings.secure,
      enabled: !!settings.enabled,
      password: settings.password ? '********' : ''
    });
  } catch (error) {
    console.error('Error getting email settings:', error);
    res.status(500).json({ error: 'Failed to get email settings' });
  }
});

/**
 * PUT /api/email/settings
 * Update SMTP settings (admin only)
 */
router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { host, port, secure, username, password, from_address, from_name, enabled } = req.body;

    // Get existing settings to preserve password if not changed
    const existing = await emailService.getSMTPSettings();
    const finalPassword = password === '********' ? (existing?.password || '') : password;

    await emailService.saveSMTPSettings({
      host,
      port: parseInt(port) || 587,
      secure: !!secure,
      username,
      password: finalPassword,
      from_address,
      from_name: from_name || 'Sappho',
      enabled: !!enabled
    });

    res.json({ success: true, message: 'Email settings saved' });
  } catch (error) {
    console.error('Error saving email settings:', error);
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

/**
 * POST /api/email/test-connection
 * Test SMTP connection without saving (admin only)
 */
router.post('/test-connection', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { host, port, secure, username, password } = req.body;

    // Get existing password if masked
    let finalPassword = password;
    if (password === '********') {
      const existing = await emailService.getSMTPSettings();
      finalPassword = existing?.password || '';
    }

    const result = await emailService.testConnection({
      host,
      port: parseInt(port) || 587,
      secure: !!secure,
      username,
      password: finalPassword
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

/**
 * POST /api/email/send-test
 * Send a test email (admin only)
 */
router.post('/send-test', authenticateToken, requireAdmin, emailLimiter, async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const result = await emailService.sendTestEmail(to);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ error: error.message || 'Failed to send test email' });
  }
});

// =====================================
// User Routes - Notification Preferences
// =====================================

/**
 * GET /api/email/preferences
 * Get current user's notification preferences
 */
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const prefs = await emailService.getUserNotificationPrefs(req.user.id);
    res.json({
      email_new_audiobook: !!prefs.email_new_audiobook,
      email_weekly_summary: !!prefs.email_weekly_summary,
      email_recommendations: !!prefs.email_recommendations,
      email_enabled: !!prefs.email_enabled
    });
  } catch (error) {
    console.error('Error getting notification preferences:', error);
    res.status(500).json({ error: 'Failed to get notification preferences' });
  }
});

/**
 * PUT /api/email/preferences
 * Update current user's notification preferences
 */
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const { email_new_audiobook, email_weekly_summary, email_recommendations, email_enabled } = req.body;

    await emailService.saveUserNotificationPrefs(req.user.id, {
      email_new_audiobook,
      email_weekly_summary,
      email_recommendations,
      email_enabled
    });

    res.json({ success: true, message: 'Notification preferences saved' });
  } catch (error) {
    console.error('Error saving notification preferences:', error);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

/**
 * GET /api/email/status
 * Check if email is configured and enabled (for UI display)
 */
router.get('/status', authenticateToken, async (_req, res) => {
  try {
    const settings = await emailService.getSMTPSettings();
    res.json({
      configured: !!(settings?.host),
      enabled: !!(settings?.enabled)
    });
  } catch (error) {
    console.error('Error getting email status:', error);
    res.status(500).json({ error: 'Failed to get email status' });
  }
});

module.exports = router;
