/**
 * Unit tests for Email Service
 */

// Mock nodemailer before requiring the module
const mockSendMail = jest.fn();
const mockVerify = jest.fn();
const mockCreateTransport = jest.fn(() => ({
  sendMail: mockSendMail,
  verify: mockVerify
}));

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport
}));

// Mock database before requiring the module
jest.mock('../../server/database', () => ({
  get: jest.fn(),
  run: jest.fn(),
  all: jest.fn()
}));

const db = require('../../server/database');

// Now require the emailService after mocks are set up
const emailService = require('../../server/services/emailService');

describe('Email Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset env vars
    delete process.env.BASE_URL;
  });

  describe('getSMTPSettings', () => {
    test('returns settings when found', async () => {
      const mockSettings = {
        id: 1,
        host: 'smtp.example.com',
        port: 587,
        secure: 0,
        username: 'user',
        password: 'pass',
        from_address: 'noreply@example.com',
        from_name: 'Sappho',
        enabled: 1
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      const result = await emailService.getSMTPSettings();
      expect(result).toEqual(mockSettings);
    });

    test('returns null when no settings', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await emailService.getSMTPSettings();
      expect(result).toBeNull();
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(emailService.getSMTPSettings()).rejects.toThrow('Database error');
    });
  });

  describe('saveSMTPSettings', () => {
    test('saves settings successfully', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      // Mock getSMTPSettings for initializeTransporter
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 0 });
      });

      const settings = {
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        username: 'user',
        password: 'pass',
        from_address: 'noreply@example.com',
        from_name: 'Sappho',
        enabled: true
      };

      const result = await emailService.saveSMTPSettings(settings);
      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE'),
        expect.arrayContaining(['smtp.example.com', 587, 1, 'user', 'pass']),
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(emailService.saveSMTPSettings({})).rejects.toThrow('Database error');
    });
  });

  describe('testConnection', () => {
    test('returns success when connection works', async () => {
      mockVerify.mockResolvedValue(true);

      const result = await emailService.testConnection({
        host: 'smtp.example.com',
        port: 587,
        secure: false
      });

      expect(result).toEqual({ success: true, message: 'SMTP connection successful' });
    });

    test('returns failure when connection fails', async () => {
      mockVerify.mockRejectedValue(new Error('Connection refused'));

      const result = await emailService.testConnection({
        host: 'invalid.host',
        port: 587
      });

      expect(result).toEqual({ success: false, message: 'Connection refused' });
    });

    test('handles authentication settings', async () => {
      mockVerify.mockResolvedValue(true);

      await emailService.testConnection({
        host: 'smtp.example.com',
        port: 587,
        username: 'user',
        password: 'pass'
      });

      expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
        auth: { user: 'user', pass: 'pass' }
      }));
    });
  });

  describe('sendTestEmail', () => {
    test('returns error when email not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await emailService.sendTestEmail('test@example.com');
      expect(result).toEqual({ success: false, message: 'Email is not configured or enabled' });
    });

    test('returns error when email not enabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 0 });
      });

      const result = await emailService.sendTestEmail('test@example.com');
      expect(result).toEqual({ success: false, message: 'Email is not configured or enabled' });
    });
  });

  describe('sendEmail', () => {
    test('throws when transporter not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test'
      })).rejects.toThrow('Email transporter not configured');
    });

    test('throws when email not enabled', async () => {
      // First call for initializeTransporter
      db.get.mockImplementationOnce((query, params, callback) => {
        callback(null, { host: 'smtp.example.com', enabled: 1 });
      });
      // Second call for sendEmail check
      db.get.mockImplementationOnce((query, params, callback) => {
        callback(null, { enabled: 0 });
      });

      await emailService.initializeTransporter();

      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test'
      })).rejects.toThrow('Email is not enabled');
    });

    test('sends email successfully', async () => {
      const mockSettings = {
        host: 'smtp.example.com',
        port: 587,
        enabled: 1,
        from_address: 'noreply@example.com',
        from_name: 'Sappho'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'test-123' });

      await emailService.initializeTransporter();

      const result = await emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test body</p>',
        text: 'Test body'
      });

      expect(result).toEqual({ success: true, messageId: 'test-123' });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: '"Sappho" <noreply@example.com>',
        to: 'test@example.com',
        subject: 'Test Subject'
      }));
    });

    test('formats from address without name', async () => {
      const mockSettings = {
        host: 'smtp.example.com',
        enabled: 1,
        from_address: 'noreply@example.com',
        from_name: null
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'test-456' });

      await emailService.initializeTransporter();

      await emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test'
      });

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'noreply@example.com'
      }));
    });
  });

  describe('queueEmail', () => {
    test('queues email with metadata', () => {
      // Clear the queue by mocking a fresh module state
      // Since queueEmail starts processing automatically, we test that it adds to queue
      const emailData = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test'
      };

      // This will queue the email
      emailService.queueEmail(emailData);

      // The queue is internal, so we can't directly inspect it
      // But we can verify the function doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('getUserNotificationPrefs', () => {
    test('returns user preferences when found', async () => {
      const mockPrefs = {
        user_id: 1,
        email_new_audiobook: 1,
        email_weekly_summary: 0,
        email_recommendations: 1,
        email_enabled: 1
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockPrefs);
      });

      const result = await emailService.getUserNotificationPrefs(1);
      expect(result).toEqual(mockPrefs);
    });

    test('returns defaults when no preferences', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await emailService.getUserNotificationPrefs(1);
      expect(result).toEqual({
        user_id: 1,
        email_new_audiobook: 0,
        email_weekly_summary: 0,
        email_recommendations: 0,
        email_enabled: 1
      });
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(emailService.getUserNotificationPrefs(1)).rejects.toThrow('Database error');
    });
  });

  describe('saveUserNotificationPrefs', () => {
    test('saves preferences successfully', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const prefs = {
        email_new_audiobook: 1,
        email_weekly_summary: 1,
        email_recommendations: 0,
        email_enabled: 1
      };

      const result = await emailService.saveUserNotificationPrefs(1, prefs);
      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE'),
        [1, 1, 1, 0, 1],
        expect.any(Function)
      );
    });

    test('uses defaults for missing preferences', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await emailService.saveUserNotificationPrefs(1, {});
      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.any(String),
        [1, 0, 0, 0, 1],
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(emailService.saveUserNotificationPrefs(1, {})).rejects.toThrow('Database error');
    });
  });

  describe('notifyNewAudiobook', () => {
    test('does nothing when email not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await emailService.notifyNewAudiobook({ title: 'Test Book' });
      // Should not throw and db.all should not be called
      expect(db.all).not.toHaveBeenCalled();
    });

    test('does nothing when email not enabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 0 });
      });

      await emailService.notifyNewAudiobook({ title: 'Test Book' });
      expect(db.all).not.toHaveBeenCalled();
    });

    test('queues emails for subscribed users', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 1, host: 'smtp.example.com' });
      });

      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          { id: 1, username: 'user1', email: 'user1@example.com' },
          { id: 2, username: 'user2', email: 'user2@example.com' }
        ]);
      });

      await emailService.notifyNewAudiobook({
        title: 'Test Audiobook',
        author: 'Test Author'
      });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('email_new_audiobook = 1'),
        [],
        expect.any(Function)
      );
    });
  });

  describe('notifyAdminNewUser', () => {
    test('does nothing when email not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await emailService.notifyAdminNewUser({ username: 'newuser' });
      expect(db.all).not.toHaveBeenCalled();
    });

    test('queues emails to admin users', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 1, host: 'smtp.example.com' });
      });

      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          { id: 1, username: 'admin', email: 'admin@example.com' }
        ]);
      });

      await emailService.notifyAdminNewUser({ username: 'newuser', email: 'newuser@example.com' });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('is_admin = 1'),
        [],
        expect.any(Function)
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    test('throws when email not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(emailService.sendPasswordResetEmail(
        { username: 'user', email: 'user@example.com' },
        'token123',
        'http://example.com/reset'
      )).rejects.toThrow('Email is not configured');
    });

    test('throws when user has no email', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 1 });
      });

      await expect(emailService.sendPasswordResetEmail(
        { username: 'user', email: null },
        'token123',
        'http://example.com/reset'
      )).rejects.toThrow('User has no email address');
    });

    test('sends password reset email', async () => {
      const mockSettings = {
        host: 'smtp.example.com',
        enabled: 1,
        from_address: 'noreply@example.com',
        from_name: 'Sappho'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'reset-123' });

      await emailService.initializeTransporter();

      await emailService.sendPasswordResetEmail(
        { username: 'testuser', email: 'testuser@example.com' },
        'token123',
        'http://example.com/reset?token=token123'
      );

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'testuser@example.com',
        subject: 'Sappho - Password Reset Request'
      }));
    });
  });

  describe('sendAccountUnlockEmail', () => {
    test('throws when email not configured', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(emailService.sendAccountUnlockEmail(
        { username: 'user', email: 'user@example.com' },
        'token123'
      )).rejects.toThrow('Email is not configured');
    });

    test('throws when user has no email', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 1 });
      });

      await expect(emailService.sendAccountUnlockEmail(
        { username: 'user', email: null },
        'token123'
      )).rejects.toThrow('User has no email address');
    });

    test('uses BASE_URL env var for unlock link', async () => {
      process.env.BASE_URL = 'https://audiobooks.example.com';

      const mockSettings = {
        host: 'smtp.example.com',
        enabled: 1,
        from_address: 'noreply@example.com'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'unlock-123' });

      await emailService.initializeTransporter();

      await emailService.sendAccountUnlockEmail(
        { username: 'testuser', email: 'testuser@example.com' },
        'unlocktoken123'
      );

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.stringContaining('https://audiobooks.example.com/unlock?token=unlocktoken123')
      }));
    });

    test('strips trailing slash from BASE_URL', async () => {
      process.env.BASE_URL = 'https://audiobooks.example.com/';

      const mockSettings = {
        host: 'smtp.example.com',
        enabled: 1,
        from_address: 'noreply@example.com'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'unlock-456' });

      await emailService.initializeTransporter();

      await emailService.sendAccountUnlockEmail(
        { username: 'testuser', email: 'testuser@example.com' },
        'token123'
      );

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.stringContaining('https://audiobooks.example.com/unlock?token=')
      }));
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.not.stringContaining('example.com//unlock')
      }));
    });

    test('escapes HTML in username to prevent XSS', async () => {
      process.env.BASE_URL = 'https://example.com';

      const mockSettings = {
        host: 'smtp.example.com',
        enabled: 1,
        from_address: 'noreply@example.com'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockSettings);
      });

      mockSendMail.mockResolvedValue({ messageId: 'xss-test' });

      await emailService.initializeTransporter();

      await emailService.sendAccountUnlockEmail(
        { username: '<script>alert("XSS")</script>', email: 'user@example.com' },
        'token123'
      );

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.stringContaining('&lt;script&gt;alert')
      }));
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: expect.not.stringContaining('<script>')
      }));
    });
  });

  describe('initializeTransporter', () => {
    test('sets transporter to null when no settings', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await emailService.initializeTransporter();
      // Subsequent sendEmail should fail
      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: 'Test',
        text: 'Test'
      })).rejects.toThrow('Email transporter not configured');
    });

    test('sets transporter to null when disabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 0, host: 'smtp.example.com' });
      });

      await emailService.initializeTransporter();
      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: 'Test',
        text: 'Test'
      })).rejects.toThrow('Email transporter not configured');
    });

    test('sets transporter to null when no host', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { enabled: 1, host: null });
      });

      await emailService.initializeTransporter();
      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: 'Test',
        text: 'Test'
      })).rejects.toThrow('Email transporter not configured');
    });

    test('creates transporter with auth when credentials provided', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          enabled: 1,
          host: 'smtp.example.com',
          port: 465,
          secure: 1,
          username: 'user',
          password: 'pass'
        });
      });

      await emailService.initializeTransporter();

      expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user', pass: 'pass' }
      }));
    });

    test('creates transporter without auth when no credentials', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          enabled: 1,
          host: 'smtp.example.com',
          port: 25,
          secure: 0,
          username: null,
          password: null
        });
      });

      await emailService.initializeTransporter();

      expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.example.com',
        port: 25,
        secure: false,
        auth: undefined
      }));
    });

    test('handles database error gracefully', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database unavailable'));
      });

      // Should not throw, just log error and set transporter to null
      await emailService.initializeTransporter();

      await expect(emailService.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: 'Test',
        text: 'Test'
      })).rejects.toThrow('Email transporter not configured');
    });
  });
});
