import { useState, useEffect } from 'react';
import { getOidcSettings, saveOidcSettings, testOidcConnection, deleteOidcSettings } from '../../api';
import './OidcSettings.css';

export default function OidcSettings() {
  const [config, setConfig] = useState({
    provider_name: '',
    issuer_url: '',
    client_id: '',
    client_secret: '',
    auto_provision: true,
    enabled: true,
  });
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await getOidcSettings();
      if (response.data.configured) {
        const c = response.data.config;
        setConfig({
          provider_name: c.provider_name || '',
          issuer_url: c.issuer_url || '',
          client_id: c.client_id || '',
          client_secret: '',
          auto_provision: c.auto_provision ?? true,
          enabled: c.enabled ?? true,
        });
        setConfigured(true);
      }
    } catch (error) {
      console.error('Error loading OIDC settings:', error);
      setMessage({ type: 'error', text: 'Failed to load OIDC settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    if (!config.provider_name || !config.issuer_url || !config.client_id) {
      setMessage({ type: 'error', text: 'Provider name, issuer URL, and client ID are required' });
      setSaving(false);
      return;
    }

    if (!configured && !config.client_secret) {
      setMessage({ type: 'error', text: 'Client secret is required for initial configuration' });
      setSaving(false);
      return;
    }

    try {
      const payload = { ...config };
      // If editing and secret not changed, send the existing sentinel value
      if (configured && !payload.client_secret) {
        payload.client_secret = '__UNCHANGED__';
      }
      await saveOidcSettings(payload);
      setMessage({ type: 'success', text: 'OIDC configuration saved successfully' });
      setConfigured(true);
      // Clear the secret field after save
      setConfig(prev => ({ ...prev, client_secret: '' }));
    } catch (error) {
      console.error('Error saving OIDC settings:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to save OIDC configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.issuer_url) {
      setMessage({ type: 'error', text: 'Enter an issuer URL to test' });
      return;
    }

    setTesting(true);
    setMessage(null);
    setTestResult(null);

    try {
      const response = await testOidcConnection(config.issuer_url);
      setTestResult(response.data.provider);
      setMessage({ type: 'success', text: response.data.message });
    } catch (error) {
      console.error('Error testing OIDC connection:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove OIDC configuration? Users will no longer be able to sign in with their OIDC provider.')) {
      return;
    }

    setDeleting(true);
    setMessage(null);

    try {
      await deleteOidcSettings();
      setConfig({
        provider_name: '',
        issuer_url: '',
        client_id: '',
        client_secret: '',
        auto_provision: true,
        enabled: true,
      });
      setConfigured(false);
      setTestResult(null);
      setMessage({ type: 'success', text: 'OIDC configuration removed' });
    } catch (error) {
      console.error('Error removing OIDC settings:', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to remove OIDC configuration' });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading OIDC settings...</div>;
  }

  return (
    <div className="oidc-settings">
      <div className="section-header">
        <div>
          <h2>OpenID Connect (OIDC)</h2>
          <p className="section-description">
            Configure an OIDC provider (e.g., Authelia, Authentik, Keycloak) to allow
            users to sign in with single sign-on.
          </p>
        </div>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="oidc-form">
        <div className="form-section">
          <h3>Provider Configuration</h3>

          <div className="form-group">
            <label htmlFor="provider_name">Provider Name</label>
            <input
              type="text"
              id="provider_name"
              name="provider_name"
              className="input"
              value={config.provider_name}
              onChange={handleChange}
              placeholder="e.g., Authelia, Authentik, Keycloak"
            />
            <p className="form-help">Display name shown on the login page button</p>
          </div>

          <div className="form-group">
            <label htmlFor="issuer_url">Issuer URL</label>
            <div className="input-with-button">
              <input
                type="url"
                id="issuer_url"
                name="issuer_url"
                className="input"
                value={config.issuer_url}
                onChange={handleChange}
                placeholder="https://auth.example.com"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={testing || !config.issuer_url}
              >
                {testing ? 'Testing...' : 'Test'}
              </button>
            </div>
            <p className="form-help">
              The OIDC provider's issuer URL. Must support OpenID Connect Discovery
              (/.well-known/openid-configuration).
            </p>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="client_id">Client ID</label>
              <input
                type="text"
                id="client_id"
                name="client_id"
                className="input"
                value={config.client_id}
                onChange={handleChange}
                placeholder="sappho"
              />
            </div>

            <div className="form-group">
              <label htmlFor="client_secret">Client Secret</label>
              <input
                type="password"
                id="client_secret"
                name="client_secret"
                className="input"
                value={config.client_secret}
                onChange={handleChange}
                placeholder={configured ? '(unchanged)' : 'Enter client secret'}
              />
              {configured && (
                <p className="form-help">Leave blank to keep the existing secret</p>
              )}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>Options</h3>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="auto_provision"
                checked={config.auto_provision}
                onChange={handleChange}
              />
              <span>Auto-provision users</span>
            </label>
            <p className="form-help">
              Automatically create Sappho accounts for new OIDC users on first sign-in.
              When disabled, users must be manually created before they can sign in.
            </p>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="enabled"
                checked={config.enabled}
                onChange={handleChange}
              />
              <span>Enable OIDC authentication</span>
            </label>
            <p className="form-help">
              When enabled, the login page will show an OIDC sign-in button.
              Disable to temporarily turn off OIDC without removing the configuration.
            </p>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
          {configured && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Removing...' : 'Remove OIDC'}
            </button>
          )}
        </div>
      </form>

      {testResult && (
        <div className="test-result-section">
          <h3>Discovery Results</h3>
          <div className="discovery-details">
            <div className="discovery-item">
              <span className="discovery-label">Issuer</span>
              <span className="discovery-value">{testResult.issuer}</span>
            </div>
            <div className="discovery-item">
              <span className="discovery-label">Authorization Endpoint</span>
              <span className="discovery-value">{testResult.authorization_endpoint}</span>
            </div>
            <div className="discovery-item">
              <span className="discovery-label">Token Endpoint</span>
              <span className="discovery-value">{testResult.token_endpoint}</span>
            </div>
            {testResult.userinfo_endpoint && (
              <div className="discovery-item">
                <span className="discovery-label">UserInfo Endpoint</span>
                <span className="discovery-value">{testResult.userinfo_endpoint}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="info-section">
        <h3>Setup Guide</h3>
        <div className="setup-steps">
          <div className="setup-step">
            <span className="step-number">1</span>
            <div>
              <strong>Register a client in your OIDC provider</strong>
              <p>Create a new application/client with the authorization code grant type.</p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-number">2</span>
            <div>
              <strong>Set the redirect URI</strong>
              <p>
                Configure the redirect URI in your provider to:
              </p>
              <code className="redirect-uri">{window.location.origin}/api/auth/oidc/callback</code>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-number">3</span>
            <div>
              <strong>Configure scopes</strong>
              <p>Ensure the client has access to the <code>openid</code>, <code>profile</code>, and <code>email</code> scopes.</p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-number">4</span>
            <div>
              <strong>Enter the details above</strong>
              <p>Copy the issuer URL, client ID, and client secret from your provider.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
