import { useState } from 'react';
import { uploadAudiobook } from '../api';
import './UploadModal.css';

export default function UploadModal({ isOpen, onClose }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError('');

    try {
      await uploadAudiobook(file);
      alert('Audiobook uploaded successfully!');
      setFile(null);
      onClose();
      // Refresh the page to show new audiobook
      window.location.reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFile(null);
      setError('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload Audiobook</h2>
          <button className="close-button" onClick={handleClose} disabled={uploading}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {error && <div className="error-message">{error}</div>}

          <div className="file-input-container">
            <input
              type="file"
              id="file-input"
              accept=".mp3,.m4a,.m4b,.mp4,.ogg,.flac"
              onChange={handleFileChange}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            <label htmlFor="file-input" className="file-input-label">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span className="file-label-text">
                {file ? file.name : 'Click to select an audiobook file'}
              </span>
              <span className="file-label-hint">
                Supported formats: MP3, M4A, M4B, MP4, OGG, FLAC
              </span>
            </label>
          </div>

          {file && (
            <div className="file-info">
              <div className="file-info-item">
                <strong>File:</strong> {file.name}
              </div>
              <div className="file-info-item">
                <strong>Size:</strong> {(file.size / (1024 * 1024)).toFixed(2)} MB
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
