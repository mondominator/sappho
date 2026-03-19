import React from 'react';

/**
 * ErrorBoundary - catches React rendering errors and displays a fallback UI.
 *
 * Can be used at two levels:
 *   1. App-level (wraps entire app in main.jsx) - full-page fallback
 *   2. Section-level (wraps individual routes/sections) - inline fallback
 *
 * Props:
 *   - fallback: Custom fallback component (optional)
 *   - section: Name of the section for logging (optional)
 *   - onError: Callback when error is caught (optional)
 *   - compact: If true, renders a smaller inline error UI (default: false)
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const section = this.props.section || 'Unknown';
    console.error(`ErrorBoundary [${section}] caught an error:`, error, errorInfo);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Component stack:', errorInfo.componentStack);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Only clear localStorage for top-level (non-compact) boundaries
    if (!this.props.compact) {
      try {
        console.log('localStorage state at crash:', {
          currentAudiobook: localStorage.getItem('currentAudiobook'),
          currentProgress: localStorage.getItem('currentProgress'),
          playerPlaying: localStorage.getItem('playerPlaying'),
          currentAudiobookId: localStorage.getItem('currentAudiobookId')
        });
      } catch (e) {
        console.error('Error reading localStorage:', e);
      }

      try {
        localStorage.removeItem('currentAudiobook');
        localStorage.removeItem('currentProgress');
        localStorage.removeItem('playerPlaying');
        localStorage.removeItem('currentAudiobookId');
      } catch (e) {
        console.error('Error clearing localStorage:', e);
      }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback component
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Compact/section-level error UI
      if (this.props.compact) {
        return (
          <div style={{
            padding: '1.5rem',
            textAlign: 'center',
            color: '#9ca3af',
            background: '#111827',
            borderRadius: '12px',
            margin: '1rem 0',
            border: '1px solid #1f2937',
          }}>
            <p style={{ marginBottom: '0.75rem', color: '#f87171', fontWeight: 500 }}>
              {this.props.section
                ? `Something went wrong loading ${this.props.section}`
                : 'Something went wrong in this section'}
            </p>
            <p style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.5rem 1.25rem',
                background: '#374151',
                color: '#d1d5db',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Try Again
            </button>
          </div>
        );
      }

      // Full-page error UI (app-level)
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#fff',
          background: '#1a1a1a',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1rem', color: '#9ca3af' }}>
            The app encountered an error. Your data has been cleared.
          </p>
          <div style={{
            marginBottom: '2rem',
            color: '#ff6b6b',
            maxWidth: '90%',
            textAlign: 'left',
            fontSize: '0.9rem',
            background: '#000',
            padding: '1rem',
            borderRadius: '4px',
            overflow: 'auto'
          }}>
            <strong>Error:</strong> {this.state.error ? this.state.error.message || this.state.error.toString() : 'Unknown error'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
