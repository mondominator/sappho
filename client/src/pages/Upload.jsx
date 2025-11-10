import { useState } from 'react';
import { uploadAudiobook } from '../api';
import { useNavigate } from 'react-router-dom';
import './Upload.css';

export default function Upload() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
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
    setProgress(0);

    try {
      await uploadAudiobook(file);
      alert('Audiobook uploaded successfully!');
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="upload-page container">
      <div className="upload-container">
        <h1>Upload Audiobook</h1>

        <form onSubmit={handleSubmit} className="upload-form">
          {error && <div className="error-message">{error}</div>}

          <div className="file-input-container">
            <input
              type="file"
              id="file-input"
              accept=".mp3,.m4a,.m4b,.mp4,.ogg,.flac"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <label htmlFor="file-input" className="file-input-label">
              {file ? file.name : 'Choose an audiobook file'}
            </label>
          </div>

          {file && (
            <div className="file-info">
              <p>
                <strong>File:</strong> {file.name}
              </p>
              <p>
                <strong>Size:</strong> {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          )}

          {uploading && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="button-group">
            <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/')}
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        </form>

        <div className="upload-info card">
          <h3>Alternative Upload Methods</h3>
          <p>
            You can also add audiobooks by placing them in the watch directory:
          </p>
          <code>/app/data/watch</code>
          <p className="note">
            Files will be automatically imported and organized.
          </p>
        </div>
      </div>
    </div>
  );
}
