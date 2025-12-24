import { useState, useEffect } from 'react';
import { getEmailSettings, updateEmailSettings, testEmailConnection, sendTestEmail } from '../../api';
import './EmailSettings.css';

export default function EmailSettings() {
  const [settings, setSettings] = useState({
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    from_address: '',
    from_name: 'Sappho',
    enabled: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await getEmailSettings();
      setSettings(response.data);
    } catch (error) {
      console.error('Error loading email settings:', error);
      setMessage({ type: 'error', text: 'Failed to load email settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await updateEmailSettings(settings);
      setMessage({ type: 'success', text: 'Email settings saved successfully' });
    } catch (error) {
      console.error('Error saving email settings:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setMessage(null);

    try {
      const response = await testEmailConnection(settings);
      setMessage({ type: 'success', text: response.data.message });
    } catch (error) {
      console.error('Error testing connection:', error);
      setMessage({ type: 'error', text: error.response?.data?.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) {
      setMessage({ type: 'error', text: 'Please enter an email address' });
      return;
    }

    setSendingTest(true);
    setMessage(null);

    try {
      await sendTestEmail(testEmail);
      setMessage({ type: 'success', text: `Test email sent to ${testEmail}` });
      setTestEmail('');
    } catch (error) {
      console.error('Error sending test email:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to send test email' });
    } finally {
      setSendingTest(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading email settings...</div>;
  }

  return (
    <div className="email-settings">
      <div className="section-header">
        <div>
          <h2>Email Notifications</h2>
          <p className="section-description">
            Configure SMTP settings to enable email notifications for new audiobooks,
            user registrations, and other events.
          </p>
        </div>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="email-form">
        <div className="form-section">
          <h3>SMTP Server Configuration</h3>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="host">SMTP Host</label>
              <input
                type="text"
                id="host"
                name="host"
                className="input"
                value={settings.host}
                onChange={handleChange}
                placeholder="smtp.gmail.com"
              />
            </div>

            <div className="form-group form-group-small">
              <label htmlFor="port">Port</label>
              <input
                type="number"
                id="port"
                name="port"
                className="input"
                value={settings.port}
                onChange={handleChange}
                placeholder="587"
              />
            </div>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="secure"
                checked={settings.secure}
                onChange={handleChange}
              />
              <span>Use SSL/TLS (port 465)</span>
            </label>
            <p className="form-help">Enable for port 465, disable for STARTTLS on port 587</p>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                name="username"
                className="input"
                value={settings.username}
                onChange={handleChange}
                placeholder="your-email@gmail.com"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password / App Password</label>
              <input
                type="password"
                id="password"
                name="password"
                className="input"
                value={settings.password}
                onChange={handleChange}
                placeholder="********"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Sender Information</h3>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="from_address">From Email Address</label>
              <input
                type="email"
                id="from_address"
                name="from_address"
                className="input"
                value={settings.from_address}
                onChange={handleChange}
                placeholder="noreply@your-domain.com"
              />
            </div>

            <div className="form-group">
              <label htmlFor="from_name">From Name</label>
              <input
                type="text"
                id="from_name"
                name="from_name"
                className="input"
                value={settings.from_name}
                onChange={handleChange}
                placeholder="Sappho"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Enable Notifications</h3>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="enabled"
                checked={settings.enabled}
                onChange={handleChange}
              />
              <span>Enable email notifications</span>
            </label>
            <p className="form-help">
              When enabled, emails will be sent for configured events (new audiobooks, user registrations, etc.)
            </p>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={testing || !settings.host}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>

      {settings.enabled && settings.host && (
        <div className="test-email-section">
          <h3>Send Test Email</h3>
          <p className="section-description">
            Send a test email to verify your configuration is working correctly.
          </p>

          <div className="test-email-form">
            <input
              type="email"
              className="input"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Enter email address"
            />
            <button
              className="btn btn-secondary"
              onClick={handleSendTestEmail}
              disabled={sendingTest || !testEmail}
            >
              {sendingTest ? 'Sending...' : 'Send Test'}
            </button>
          </div>
        </div>
      )}

      <div className="info-section">
        <h3>Common SMTP Settings</h3>
        <div className="smtp-examples">
          <div className="smtp-example">
            <strong>Gmail</strong>
            <p>Host: smtp.gmail.com, Port: 587, SSL: No</p>
            <p className="note">Requires App Password (not regular password)</p>
          </div>
          <div className="smtp-example">
            <strong>Outlook/Office 365</strong>
            <p>Host: smtp-mail.outlook.com, Port: 587, SSL: No</p>
          </div>
          <div className="smtp-example">
            <strong>Mailgun</strong>
            <p>Host: smtp.mailgun.org, Port: 587, SSL: No</p>
          </div>
          <div className="smtp-example">
            <strong>SendGrid</strong>
            <p>Host: smtp.sendgrid.net, Port: 587, SSL: No</p>
          </div>
        </div>
      </div>
    </div>
  );
}
