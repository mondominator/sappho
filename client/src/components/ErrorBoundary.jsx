import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Component stack:', errorInfo.componentStack);

    // Log localStorage state for debugging
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

    // Clear potentially corrupted state
    try {
      localStorage.removeItem('currentAudiobook');
      localStorage.removeItem('currentProgress');
      localStorage.removeItem('playerPlaying');
      localStorage.removeItem('currentAudiobookId');
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
  }

  render() {
    if (this.state.hasError) {
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
