/**
 * Email Service
 *
 * Handles email notifications using nodemailer:
 * - SMTP configuration management
 * - Email template rendering
 * - Queued email sending
 * - Notification triggers
 */

const nodemailer = require('nodemailer');
const db = require('../database');

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// In-memory email queue
const emailQueue = [];
let isProcessingQueue = false;
let transporter = null;

/**
 * Get SMTP settings from database
 */
async function getSMTPSettings() {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM email_settings WHERE id = 1',
      [],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

/**
 * Save SMTP settings to database
 */
async function saveSMTPSettings(settings) {
  const { host, port, secure, username, password, from_address, from_name, enabled } = settings;

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO email_settings
        (id, host, port, secure, username, password, from_address, from_name, enabled, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [host, port, secure ? 1 : 0, username, password, from_address, from_name, enabled ? 1 : 0],
      function(err) {
        if (err) reject(err);
        else {
          // Reinitialize transporter with new settings
          initializeTransporter();
          resolve({ success: true });
        }
      }
    );
  });
}

/**
 * Initialize nodemailer transporter with current SMTP settings
 */
async function initializeTransporter() {
  try {
    const settings = await getSMTPSettings();

    if (!settings || !settings.enabled || !settings.host) {
      transporter = null;
      return;
    }

    transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port || 587,
      secure: settings.secure === 1,
      auth: settings.username ? {
        user: settings.username,
        pass: settings.password
      } : undefined,
    });

    console.log('Email transporter initialized');
  } catch (error) {
    console.error('Failed to initialize email transporter:', error);
    transporter = null;
  }
}

/**
 * Test SMTP connection
 */
async function testConnection(settings) {
  const testTransporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port || 587,
    secure: settings.secure,
    auth: settings.username ? {
      user: settings.username,
      pass: settings.password
    } : undefined,
  });

  try {
    await testTransporter.verify();
    return { success: true, message: 'SMTP connection successful' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Send a test email
 */
async function sendTestEmail(toAddress) {
  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) {
    return { success: false, message: 'Email is not configured or enabled' };
  }

  const result = await sendEmail({
    to: toAddress,
    subject: 'Sappho - Test Email',
    html: getTestEmailTemplate(),
    text: 'This is a test email from Sappho audiobook server.'
  });

  return result;
}

/**
 * Queue an email for sending
 */
function queueEmail(emailData) {
  emailQueue.push({
    ...emailData,
    queuedAt: new Date(),
    attempts: 0
  });

  // Start processing if not already running
  if (!isProcessingQueue) {
    processEmailQueue();
  }
}

/**
 * Process queued emails
 */
async function processEmailQueue() {
  if (isProcessingQueue || emailQueue.length === 0) return;

  isProcessingQueue = true;

  while (emailQueue.length > 0) {
    const email = emailQueue.shift();
    email.attempts++;

    try {
      await sendEmail(email);
    } catch (error) {
      console.error('Failed to send email:', error);

      // Re-queue if under max attempts
      if (email.attempts < 3) {
        emailQueue.push(email);
      } else {
        console.error('Email permanently failed after 3 attempts:', email.subject);
      }
    }

    // Small delay between emails
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessingQueue = false;
}

/**
 * Send an email immediately
 */
async function sendEmail({ to, subject, html, text }) {
  if (!transporter) {
    await initializeTransporter();
  }

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) {
    throw new Error('Email is not enabled');
  }

  const fromAddress = settings.from_name
    ? `"${settings.from_name}" <${settings.from_address}>`
    : settings.from_address;

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html
  });

  console.log('Email sent:', info.messageId);
  return { success: true, messageId: info.messageId };
}

/**
 * Get user notification preferences
 */
async function getUserNotificationPrefs(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM user_notification_prefs WHERE user_id = ?',
      [userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || {
          user_id: userId,
          email_new_audiobook: 0,
          email_weekly_summary: 0,
          email_recommendations: 0,
          email_enabled: 1
        });
      }
    );
  });
}

/**
 * Save user notification preferences
 */
async function saveUserNotificationPrefs(userId, prefs) {
  const {
    email_new_audiobook = 0,
    email_weekly_summary = 0,
    email_recommendations = 0,
    email_enabled = 1
  } = prefs;

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO user_notification_prefs
        (user_id, email_new_audiobook, email_weekly_summary, email_recommendations, email_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [userId, email_new_audiobook ? 1 : 0, email_weekly_summary ? 1 : 0, email_recommendations ? 1 : 0, email_enabled ? 1 : 0],
      function(err) {
        if (err) reject(err);
        else resolve({ success: true });
      }
    );
  });
}

// =====================================
// Notification Functions
// =====================================

/**
 * Send new audiobook notification to subscribed users
 */
async function notifyNewAudiobook(audiobook) {
  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) return;

  // Get users who have opted into new audiobook notifications
  const users = await new Promise((resolve, reject) => {
    db.all(
      `SELECT u.id, u.username, u.email
       FROM users u
       JOIN user_notification_prefs p ON u.id = p.user_id
       WHERE p.email_new_audiobook = 1 AND p.email_enabled = 1 AND u.email IS NOT NULL`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  for (const user of users) {
    queueEmail({
      to: user.email,
      subject: `New Audiobook: ${audiobook.title}`,
      html: getNewAudiobookTemplate(audiobook, user),
      text: `A new audiobook has been added to Sappho: ${audiobook.title} by ${audiobook.author}`
    });
  }
}

/**
 * Send admin notification for new user registration
 */
async function notifyAdminNewUser(newUser) {
  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) return;

  // Get admin users with email
  const admins = await new Promise((resolve, reject) => {
    db.all(
      'SELECT id, username, email FROM users WHERE is_admin = 1 AND email IS NOT NULL',
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  for (const admin of admins) {
    queueEmail({
      to: admin.email,
      subject: 'Sappho - New User Registration',
      html: getNewUserTemplate(newUser, admin),
      text: `A new user has registered: ${newUser.username}`
    });
  }
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(user, resetToken, resetUrl) {
  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) {
    throw new Error('Email is not configured');
  }

  if (!user.email) {
    throw new Error('User has no email address');
  }

  await sendEmail({
    to: user.email,
    subject: 'Sappho - Password Reset Request',
    html: getPasswordResetTemplate(user, resetUrl),
    text: `Click this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`
  });
}

// =====================================
// Email Templates
// =====================================

function getBaseTemplate(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
      border-radius: 8px 8px 0 0;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
    }
    .content {
      background: white;
      padding: 30px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .button {
      display: inline-block;
      background: #667eea;
      color: white !important;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin: 10px 0;
    }
    .footer {
      text-align: center;
      color: #666;
      font-size: 12px;
      padding: 20px;
    }
    .audiobook-card {
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 15px;
      margin: 15px 0;
    }
    .audiobook-title {
      font-size: 18px;
      font-weight: bold;
      color: #333;
    }
    .audiobook-author {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 Sappho</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>This email was sent from your Sappho audiobook server.</p>
      <p>To manage your notification preferences, visit your profile settings.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function getTestEmailTemplate() {
  return getBaseTemplate(`
    <h2>Test Email</h2>
    <p>Congratulations! Your Sappho email configuration is working correctly.</p>
    <p>You can now enable email notifications for:</p>
    <ul>
      <li>New audiobook additions</li>
      <li>Weekly listening summaries</li>
      <li>Book recommendations</li>
    </ul>
    <p>Configure your preferences in your profile settings.</p>
  `);
}

function getNewAudiobookTemplate(audiobook, user) {
  return getBaseTemplate(`
    <h2>New Audiobook Added</h2>
    <p>Hi ${user.username},</p>
    <p>A new audiobook has been added to your library:</p>
    <div class="audiobook-card">
      <div class="audiobook-title">${audiobook.title}</div>
      <div class="audiobook-author">by ${audiobook.author || 'Unknown Author'}</div>
      ${audiobook.narrator ? `<div>Narrated by ${audiobook.narrator}</div>` : ''}
      ${audiobook.series_name ? `<div>Series: ${audiobook.series_name}</div>` : ''}
    </div>
    <p>
      <a href="#" class="button">Listen Now</a>
    </p>
  `);
}

function getNewUserTemplate(newUser, admin) {
  return getBaseTemplate(`
    <h2>New User Registration</h2>
    <p>Hi ${admin.username},</p>
    <p>A new user has registered on your Sappho server:</p>
    <ul>
      <li><strong>Username:</strong> ${newUser.username}</li>
      <li><strong>Email:</strong> ${newUser.email || 'Not provided'}</li>
      <li><strong>Registered:</strong> ${new Date().toLocaleString()}</li>
    </ul>
    <p>You can manage users in the admin panel.</p>
  `);
}

function getPasswordResetTemplate(user, resetUrl) {
  return getBaseTemplate(`
    <h2>Password Reset Request</h2>
    <p>Hi ${user.username},</p>
    <p>We received a request to reset your password. Click the button below to create a new password:</p>
    <p style="text-align: center;">
      <a href="${resetUrl}" class="button">Reset Password</a>
    </p>
    <p>This link will expire in 1 hour.</p>
    <p>If you didn't request this password reset, you can safely ignore this email.</p>
    <p style="color: #666; font-size: 12px;">
      If the button doesn't work, copy and paste this URL into your browser:<br>
      ${resetUrl}
    </p>
  `);
}

function getAccountUnlockTemplate(user, unlockUrl) {
  const safeUsername = escapeHtml(user.username);
  const safeUrl = escapeHtml(unlockUrl);
  return getBaseTemplate(`
    <h2>Account Unlock Request</h2>
    <p>Hi ${safeUsername},</p>
    <p>We received a request to unlock your account. This may have been triggered due to multiple failed login attempts.</p>
    <p>Click the button below to unlock your account:</p>
    <p style="text-align: center;">
      <a href="${safeUrl}" class="button">Unlock Account</a>
    </p>
    <p>This link will expire in 1 hour.</p>
    <p>If you didn't request this unlock, someone may be trying to access your account. Consider changing your password after logging in.</p>
    <p style="color: #666; font-size: 12px;">
      If the button doesn't work, copy and paste this URL into your browser:<br>
      ${safeUrl}
    </p>
  `);
}

/**
 * Send account unlock email
 */
async function sendAccountUnlockEmail(user, unlockToken, baseUrl) {
  const settings = await getSMTPSettings();
  if (!settings || !settings.enabled) {
    throw new Error('Email is not configured');
  }

  if (!user.email) {
    throw new Error('User has no email address');
  }

  const unlockUrl = `${baseUrl}/unlock?token=${unlockToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Sappho - Account Unlock Request',
    html: getAccountUnlockTemplate(user, unlockUrl),
    text: `Click this link to unlock your account: ${unlockUrl}\n\nThis link expires in 1 hour.`
  });
}

// Initialize transporter on module load
initializeTransporter();

module.exports = {
  getSMTPSettings,
  saveSMTPSettings,
  testConnection,
  sendTestEmail,
  sendEmail,
  queueEmail,
  getUserNotificationPrefs,
  saveUserNotificationPrefs,
  notifyNewAudiobook,
  notifyAdminNewUser,
  sendPasswordResetEmail,
  sendAccountUnlockEmail,
  initializeTransporter
};
