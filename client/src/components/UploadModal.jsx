import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadAudiobook, uploadMultiFileAudiobook } from '../api';
import './UploadModal.css';

export default function UploadModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadMode, setUploadMode] = useState('files'); // 'files' or 'folder'
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      // Filter to only audio files
      const audioFiles = selectedFiles.filter(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        return ['mp3', 'm4a', 'm4b', 'mp4', 'ogg', 'flac'].includes(ext);
      });

      if (audioFiles.length === 0) {
        setError('No valid audio files found. Supported: MP3, M4A, M4B, MP4, OGG, FLAC');
        return;
      }

      setFiles(audioFiles);
      setError('');
      setUploadProgress({});
    }
  };

  const handleFolderChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      // Filter to only audio files
      const audioFiles = selectedFiles.filter(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        return ['mp3', 'm4a', 'm4b', 'mp4', 'ogg', 'flac'].includes(ext);
      });

      if (audioFiles.length === 0) {
        setError('No valid audio files found in folder. Supported: MP3, M4A, M4B, MP4, OGG, FLAC');
        return;
      }

      setFiles(audioFiles);
      setError('');
      setUploadProgress({});
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getTotalSize = () => {
    return files.reduce((sum, file) => sum + file.size, 0);
  };

  // Group files by their directory path (for folder uploads)
  const groupFilesByDirectory = () => {
    const groups = {};

    files.forEach(file => {
      // webkitRelativePath contains the folder structure
      const relativePath = file.webkitRelativePath || file.name;
      const parts = relativePath.split('/');

      // Get the immediate parent folder name, or 'root' if no folder
      let groupKey;
      if (parts.length > 1) {
        // Use the first folder level as the group key
        groupKey = parts[0];
      } else {
        // No folder structure, use filename without extension as key
        groupKey = file.name.replace(/\.[^.]+$/, '');
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(file);
    });

    return groups;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Please select files to upload');
      return;
    }

    setUploading(true);
    setError('');

    try {
      if (uploadMode === 'folder') {
        // Folder upload - all files become one multi-file audiobook
        const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Uploaded Book';

        setUploadProgress({
          [folderName]: { status: 'uploading', current: 0, total: files.length }
        });

        try {
          const response = await uploadMultiFileAudiobook(files, folderName);
          const audiobookId = response.data?.audiobook?.id;

          setUploadProgress({
            [folderName]: { status: 'success', current: files.length, total: files.length }
          });

          setFiles([]);
          onClose();
          // Navigate to the new audiobook's detail page
          if (audiobookId) {
            navigate(`/audiobook/${audiobookId}`);
          } else {
            navigate('/');
          }
        } catch (err) {
          setUploadProgress({
            [folderName]: { status: 'error', error: err.response?.data?.error || 'Upload failed' }
          });
          setError(err.response?.data?.error || 'Upload failed');
        }
      } else {
        // Individual file uploads - each file becomes a separate audiobook
        const results = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];

          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { status: 'uploading' }
          }));

          try {
            const response = await uploadAudiobook(file);
            const audiobookId = response.data?.audiobook?.id;
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: { status: 'success' }
            }));
            results.push({ name: file.name, success: true, audiobookId });
          } catch (err) {
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: { status: 'error', error: err.response?.data?.error || 'Upload failed' }
            }));
            results.push({ name: file.name, success: false, error: err.response?.data?.error });
          }
        }

        const successResults = results.filter(r => r.success);
        const successCount = successResults.length;
        const failCount = results.filter(r => !r.success).length;

        if (failCount === 0 && successCount > 0) {
          setFiles([]);
          onClose();
          // If single file uploaded, navigate to its detail page
          if (successCount === 1 && successResults[0].audiobookId) {
            navigate(`/audiobook/${successResults[0].audiobookId}`);
          } else {
            // Multiple files - go to home/library
            navigate('/');
          }
        } else if (successCount > 0) {
          alert(`Uploaded ${successCount} audiobook${successCount !== 1 ? 's' : ''}, ${failCount} failed. Check the list for details.`);
        } else {
          setError('All uploads failed. Check the list for details.');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setError('');
      setUploadProgress({});
      setUploadMode('files');
      onClose();
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setError('');
  };

  const clearFiles = () => {
    setFiles([]);
    setUploadProgress({});
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload Audiobooks</h2>
          <button className="close-button" onClick={handleClose} disabled={uploading}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {error && <div className="error-message">{error}</div>}

          {/* Upload mode toggle */}
          <div className="upload-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'files' ? 'active' : ''}`}
              onClick={() => { setUploadMode('files'); clearFiles(); }}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
              Files
            </button>
            <button
              type="button"
              className={`mode-btn ${uploadMode === 'folder' ? 'active' : ''}`}
              onClick={() => { setUploadMode('folder'); clearFiles(); }}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Folder
            </button>
          </div>

          <div className="file-input-container">
            {/* Hidden file input for multiple files */}
            <input
              ref={fileInputRef}
              type="file"
              id="file-input"
              accept=".mp3,.m4a,.m4b,.mp4,.ogg,.flac"
              onChange={handleFileChange}
              disabled={uploading}
              multiple
              style={{ display: 'none' }}
            />
            {/* Hidden folder input */}
            <input
              ref={folderInputRef}
              type="file"
              id="folder-input"
              accept=".mp3,.m4a,.m4b,.mp4,.ogg,.flac"
              onChange={handleFolderChange}
              disabled={uploading}
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
            />

            <label
              htmlFor={uploadMode === 'folder' ? 'folder-input' : 'file-input'}
              className="file-input-label"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span className="file-label-text">
                {files.length > 0
                  ? `${files.length} file${files.length !== 1 ? 's' : ''} selected`
                  : uploadMode === 'folder'
                    ? 'Click to select a folder'
                    : 'Click to select audiobook files'
                }
              </span>
              <span className="file-label-hint">
                {uploadMode === 'folder'
                  ? 'Select a folder containing audiobook files'
                  : 'Select one or more audiobook files (MP3, M4B, M4A, etc.)'
                }
              </span>
            </label>
          </div>

          {files.length > 0 && (
            <div className="files-list">
              <div className="files-list-header">
                <span>{files.length} file{files.length !== 1 ? 's' : ''} ({formatFileSize(getTotalSize())})</span>
                <button
                  type="button"
                  className="clear-files-btn"
                  onClick={clearFiles}
                  disabled={uploading}
                >
                  Clear all
                </button>
              </div>
              <div className="files-list-items">
                {files.map((file, index) => (
                  <div key={index} className={`file-item ${uploadProgress[file.name]?.status || ''}`}>
                    <div className="file-item-info">
                      <span className="file-item-name" title={file.webkitRelativePath || file.name}>
                        {file.webkitRelativePath || file.name}
                      </span>
                      <span className="file-item-size">{formatFileSize(file.size)}</span>
                    </div>
                    <div className="file-item-actions">
                      {uploadProgress[file.name]?.status === 'uploading' && (
                        <span className="file-status uploading">Uploading...</span>
                      )}
                      {uploadProgress[file.name]?.status === 'success' && (
                        <span className="file-status success">Done</span>
                      )}
                      {uploadProgress[file.name]?.status === 'error' && (
                        <span className="file-status error" title={uploadProgress[file.name]?.error}>
                          Failed
                        </span>
                      )}
                      {!uploading && !uploadProgress[file.name]?.status && (
                        <button
                          type="button"
                          className="remove-file-btn"
                          onClick={() => removeFile(index)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={uploading || files.length === 0}>
              {uploading ? 'Uploading...' : `Upload ${files.length > 0 ? files.length : ''} File${files.length !== 1 ? 's' : ''}`}
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
