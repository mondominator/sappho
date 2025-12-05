import { useState, useEffect } from 'react';
import axios from 'axios';
import './AISettings.css';

export default function AISettings() {
  const [settings, setSettings] = useState({
    aiProvider: 'openai',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    recapOffensiveMode: false,
    recapCustomPrompt: ''
  });
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [originalSettings, setOriginalSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/settings/ai', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = response.data.settings;
      setSettings({
        ...data,
        recapOffensiveMode: data.recapOffensiveMode || false,
        recapCustomPrompt: data.recapCustomPrompt || ''
      });
      setOriginalSettings({
        ...data,
        recapOffensiveMode: data.recapOffensiveMode || false,
        recapCustomPrompt: data.recapCustomPrompt || ''
      });
      setDefaultPrompt(data.recapDefaultPrompt || '');
    } catch (error) {
      console.error('Error loading AI settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);

    try {
      const token = localStorage.getItem('token');
      await axios.put('/api/settings/ai', settings, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOriginalSettings({ ...settings });
      alert('AI settings saved successfully');
    } catch (error) {
      console.error('Error saving AI settings:', error);
      alert(error.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/settings/ai/test', settings, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTestResult({ success: true, message: response.data.message });
    } catch (error) {
      console.error('Error testing AI connection:', error);
      setTestResult({
        success: false,
        message: error.response?.data?.error || 'Connection test failed'
      });
    } finally {
      setTesting(false);
    }
  };

  const hasChanges = () => {
    return settings.aiProvider !== originalSettings.aiProvider ||
           settings.openaiApiKey !== originalSettings.openaiApiKey ||
           settings.openaiModel !== originalSettings.openaiModel ||
           settings.geminiApiKey !== originalSettings.geminiApiKey ||
           settings.geminiModel !== originalSettings.geminiModel ||
           settings.recapOffensiveMode !== originalSettings.recapOffensiveMode ||
           settings.recapCustomPrompt !== originalSettings.recapCustomPrompt;
  };

  const hasApiKeyForProvider = () => {
    if (settings.aiProvider === 'gemini') {
      return settings.geminiApiKey && !settings.geminiApiKey.includes('••••') || originalSettings.geminiApiKey;
    }
    return settings.openaiApiKey && !settings.openaiApiKey.includes('••••') || originalSettings.openaiApiKey;
  };

  if (loading) {
    return <div className="loading">Loading AI settings...</div>;
  }

  return (
    <div className="tab-content ai-settings">
      <div className="section-header">
        <div>
          <h2>AI Configuration</h2>
          <p className="section-description">
            Configure AI integration for features like series recaps. Your API key is stored securely and never exposed to clients.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="ai-form">
        <div className="settings-section">
          <h3>AI Provider</h3>

          <div className="form-group">
            <label htmlFor="aiProvider">Active Provider</label>
            <select
              id="aiProvider"
              className="input"
              value={settings.aiProvider}
              onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value })}
            >
              <option value="openai">OpenAI (GPT-4)</option>
              <option value="gemini">Google Gemini (Free Tier Available)</option>
            </select>
            <p className="help-text">
              {settings.aiProvider === 'gemini'
                ? 'Gemini offers a free tier with 15 requests per minute.'
                : 'OpenAI requires a paid API key but offers higher quality responses.'}
            </p>
          </div>
        </div>

        {settings.aiProvider === 'openai' && (
          <div className="settings-section">
            <h3>OpenAI Settings</h3>

            <div className="form-group">
              <label htmlFor="openaiApiKey">
                API Key
                {originalSettings.openaiApiKey && (
                  <span className="configured-badge">Configured</span>
                )}
              </label>
              <input
                type="password"
                id="openaiApiKey"
                className="input mono"
                value={settings.openaiApiKey}
                onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                placeholder={originalSettings.openaiApiKey ? '••••••••' : 'sk-...'}
              />
              <p className="help-text">
                Get your API key from{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                  platform.openai.com/api-keys
                </a>
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="openaiModel">Model</label>
              <select
                id="openaiModel"
                className="input"
                value={settings.openaiModel}
                onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
              >
                <option value="gpt-4o-mini">GPT-4o Mini (Recommended - Fast & Cheap)</option>
                <option value="gpt-4o">GPT-4o (Higher Quality)</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Cheapest)</option>
              </select>
            </div>
          </div>
        )}

        {settings.aiProvider === 'gemini' && (
          <div className="settings-section">
            <h3>Google Gemini Settings</h3>

            <div className="form-group">
              <label htmlFor="geminiApiKey">
                API Key
                {originalSettings.geminiApiKey && (
                  <span className="configured-badge">Configured</span>
                )}
              </label>
              <input
                type="password"
                id="geminiApiKey"
                className="input mono"
                value={settings.geminiApiKey}
                onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                placeholder={originalSettings.geminiApiKey ? '••••••••' : 'AIza...'}
              />
              <p className="help-text">
                Get your API key from{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
                  Google AI Studio
                </a>
                {' '}- Free tier includes 15 requests per minute.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="geminiModel">Model</label>
              <select
                id="geminiModel"
                className="input"
                value={settings.geminiModel}
                onChange={(e) => setSettings({ ...settings, geminiModel: e.target.value })}
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Recommended - Fast & Free)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Higher Quality)</option>
                <option value="gemini-1.0-pro">Gemini 1.0 Pro</option>
              </select>
            </div>
          </div>
        )}

        <div className="settings-section">
          <h3>Recap Style</h3>

          <div className="form-group checkbox-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={settings.recapOffensiveMode}
                onChange={(e) => setSettings({ ...settings, recapOffensiveMode: e.target.checked })}
              />
              <span className="toggle-text">
                <strong>Offensive Mode</strong>
                <small>Crude, irreverent recaps with profanity. Like a drunk friend recapping the books at a party.</small>
              </span>
            </label>
          </div>

          <div className="form-group">
            <label>
              Custom Prompt
              {settings.recapCustomPrompt && (
                <span className="configured-badge">Custom</span>
              )}
            </label>
            <p className="help-text" style={{ marginBottom: '8px' }}>
              {settings.recapCustomPrompt ? 'Using custom prompt' : 'Using default prompt'}.
              Click below to customize how recaps are generated.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPromptEditor(true)}
            >
              Edit Prompt
            </button>
          </div>
        </div>

        {testResult && (
          <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {testResult.success ? (
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </>
              )}
            </svg>
            {testResult.message}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !hasChanges()}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testing || !hasApiKeyForProvider()}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {hasChanges() && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSettings({ ...originalSettings })}
            >
              Reset
            </button>
          )}
        </div>
      </form>

      <div className="settings-section info-section">
        <h3>About AI Features</h3>
        <div className="feature-list">
          <div className="feature-item">
            <div className="feature-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="feature-content">
              <h4>Series Recaps</h4>
              <p>Get a spoiler-free summary of a series up to where you've read. Perfect for refreshing your memory before continuing a series.</p>
            </div>
          </div>
        </div>
        <div className="cost-info">
          <p>
            <strong>Estimated costs:</strong>
            {settings.aiProvider === 'gemini'
              ? ' Gemini 1.5 Flash is free for up to 15 requests per minute. More than enough for occasional recaps!'
              : ' Each recap costs approximately $0.001-0.003 with GPT-4o Mini. You can generate hundreds of recaps for less than $1.'}
          </p>
        </div>
      </div>

      {showPromptEditor && (
        <div className="modal-overlay" onClick={() => setShowPromptEditor(false)}>
          <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Custom Recap Prompt</h3>
            <p className="modal-description">
              Customize the system prompt used for generating series recaps.
              Edit the prompt below to change how recaps are generated.
            </p>

            <div className="form-group">
              <textarea
                className="input prompt-textarea"
                value={settings.recapCustomPrompt || defaultPrompt}
                onChange={(e) => setSettings({ ...settings, recapCustomPrompt: e.target.value })}
                rows={12}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setSettings({ ...settings, recapCustomPrompt: '' })}
              >
                Reset to Default
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowPromptEditor(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
