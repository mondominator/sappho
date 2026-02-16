import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { uploadAudiobook, uploadMultiFileAudiobook } from '../api';
import { formatFileSize } from '../utils/formatting';
import './UploadModal.css';

export default function UploadModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadMode, setUploadMode] = useState('files'); // 'files' or 'folder'
  const [overallProgress, setOverallProgress] = useState(null); // { percent, speed, eta, loaded, total }
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const cancelTokenRef = useRef(null);
  const uploadStartTimeRef = useRef(null);

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
      setOverallProgress(null);
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
      setOverallProgress(null);
    }
  };


  const formatSpeed = (bytesPerSecond) => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatEta = (seconds) => {
    if (!seconds || seconds === Infinity) return '--:--';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.ceil(seconds % 60);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.ceil((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const getTotalSize = () => {
    return files.reduce((sum, file) => sum + file.size, 0);
  };

  const handleProgressUpdate = useCallback((progressEvent) => {
    const { loaded, total } = progressEvent;
    const percent = Math.round((loaded * 100) / total);

    const now = Date.now();
    const elapsed = (now - uploadStartTimeRef.current) / 1000; // seconds
    const speed = elapsed > 0 ? loaded / elapsed : 0;
    const remaining = total - loaded;
    const eta = speed > 0 ? remaining / speed : 0;

    setOverallProgress({
      percent,
      speed,
      eta,
      loaded,
      total
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Please select files to upload');
      return;
    }

    setUploading(true);
    setError('');
    uploadStartTimeRef.current = Date.now();
    cancelTokenRef.current = axios.CancelToken.source();

    try {
      if (uploadMode === 'folder') {
        // Folder upload - all files become one multi-file audiobook
        const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Uploaded Book';

        setUploadProgress({
          [folderName]: { status: 'uploading', current: 0, total: files.length }
        });

        try {
          const response = await uploadMultiFileAudiobook(files, folderName, {
            onProgress: handleProgressUpdate,
            cancelToken: cancelTokenRef.current.token
          });
          const audiobookId = response.data?.audiobook?.id;

          setUploadProgress({
            [folderName]: { status: 'success', current: files.length, total: files.length }
          });

          setFiles([]);
          setOverallProgress(null);
          onClose();
          // Navigate to the new audiobook's detail page
          if (audiobookId) {
            navigate(`/audiobook/${audiobookId}`);
          } else {
            navigate('/');
          }
        } catch (err) {
          if (axios.isCancel(err)) {
            setUploadProgress({
              [folderName]: { status: 'cancelled' }
            });
            setError('Upload cancelled');
          } else {
            setUploadProgress({
              [folderName]: { status: 'error', error: err.response?.data?.error || 'Upload failed' }
            });
            setError(err.response?.data?.error || 'Upload failed');
          }
        }
      } else {
        // Individual file uploads - each file becomes a separate audiobook
        const results = [];
        let totalLoaded = 0;
        const totalSize = getTotalSize();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileStartLoaded = totalLoaded;

          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { status: 'uploading', percent: 0 }
          }));

          try {
            const response = await uploadAudiobook(file, null, {
              onProgress: (progressEvent) => {
                const filePercent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setUploadProgress(prev => ({
                  ...prev,
                  [file.name]: { status: 'uploading', percent: filePercent }
                }));

                // Calculate overall progress
                const currentTotalLoaded = fileStartLoaded + progressEvent.loaded;
                const overallPercent = Math.round((currentTotalLoaded * 100) / totalSize);
                const now = Date.now();
                const elapsed = (now - uploadStartTimeRef.current) / 1000;
                const speed = elapsed > 0 ? currentTotalLoaded / elapsed : 0;
                const remaining = totalSize - currentTotalLoaded;
                const eta = speed > 0 ? remaining / speed : 0;

                setOverallProgress({
                  percent: overallPercent,
                  speed,
                  eta,
                  loaded: currentTotalLoaded,
                  total: totalSize
                });
              },
              cancelToken: cancelTokenRef.current.token
            });

            totalLoaded += file.size;
            const audiobookId = response.data?.audiobook?.id;
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: { status: 'success' }
            }));
            results.push({ name: file.name, success: true, audiobookId });
          } catch (err) {
            if (axios.isCancel(err)) {
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: { status: 'cancelled' }
              }));
              results.push({ name: file.name, success: false, cancelled: true });
              setError('Upload cancelled');
              break; // Stop processing remaining files
            } else {
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: { status: 'error', error: err.response?.data?.error || 'Upload failed' }
              }));
              results.push({ name: file.name, success: false, error: err.response?.data?.error });
            }
          }
        }

        const successResults = results.filter(r => r.success);
        const successCount = successResults.length;
        const failCount = results.filter(r => !r.success && !r.cancelled).length;
        const cancelledCount = results.filter(r => r.cancelled).length;

        if (cancelledCount > 0) {
          // Upload was cancelled, don't navigate
        } else if (failCount === 0 && successCount > 0) {
          setFiles([]);
          setOverallProgress(null);
          onClose();
          // If single file uploaded, navigate to its detail page
          if (successCount === 1 && successResults[0].audiobookId) {
            navigate(`/audiobook/${successResults[0].audiobookId}`);
          } else {
            // Multiple files - go to home/library
            navigate('/');
          }
        } else if (successCount > 0) {
          // Some succeeded, some failed - don't close, show status
        } else if (failCount > 0) {
          setError('All uploads failed. Check the list for details.');
        }
      }
    } catch (err) {
      if (!axios.isCancel(err)) {
        setError(err.response?.data?.error || 'Upload failed');
      }
    } finally {
      setUploading(false);
      cancelTokenRef.current = null;
    }
  };

  const handleCancel = () => {
    if (cancelTokenRef.current) {
      cancelTokenRef.current.cancel('Upload cancelled by user');
    }
  };

  const handleRetry = async (fileName) => {
    const file = files.find(f => f.name === fileName);
    if (!file) return;

    setUploading(true);
    uploadStartTimeRef.current = Date.now();
    cancelTokenRef.current = axios.CancelToken.source();

    setUploadProgress(prev => ({
      ...prev,
      [file.name]: { status: 'uploading', percent: 0 }
    }));

    try {
      const response = await uploadAudiobook(file, null, {
        onProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { status: 'uploading', percent }
          }));

          const now = Date.now();
          const elapsed = (now - uploadStartTimeRef.current) / 1000;
          const speed = elapsed > 0 ? progressEvent.loaded / elapsed : 0;
          const remaining = progressEvent.total - progressEvent.loaded;
          const eta = speed > 0 ? remaining / speed : 0;

          setOverallProgress({
            percent,
            speed,
            eta,
            loaded: progressEvent.loaded,
            total: progressEvent.total
          });
        },
        cancelToken: cancelTokenRef.current.token
      });

      setUploadProgress(prev => ({
        ...prev,
        [file.name]: { status: 'success' }
      }));
      setOverallProgress(null);
      setError('');
    } catch (err) {
      if (axios.isCancel(err)) {
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { status: 'cancelled' }
        }));
      } else {
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { status: 'error', error: err.response?.data?.error || 'Upload failed' }
        }));
      }
    } finally {
      setUploading(false);
      cancelTokenRef.current = null;
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setError('');
      setUploadProgress({});
      setOverallProgress(null);
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
    setOverallProgress(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const hasFailedUploads = Object.values(uploadProgress).some(p => p.status === 'error');

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} role="dialog" aria-modal="true" aria-label="Upload audiobooks">
      <div className="modal upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload Audiobooks</h2>
          <button className="close-button" onClick={handleClose} disabled={uploading} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {error && <div className="error-message">{error}</div>}

          {/* Overall progress bar during upload */}
          {uploading && overallProgress && (
            <div className="overall-progress">
              <div className="progress-header">
                <span className="progress-percent">{overallProgress.percent}%</span>
                <span className="progress-details">
                  {formatFileSize(overallProgress.loaded)} / {formatFileSize(overallProgress.total)}
                </span>
              </div>
              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${overallProgress.percent}%` }}
                />
              </div>
              <div className="progress-footer">
                <span className="progress-speed">{formatSpeed(overallProgress.speed)}</span>
                <span className="progress-eta">ETA: {formatEta(overallProgress.eta)}</span>
              </div>
            </div>
          )}

          {/* Upload mode toggle */}
          {!uploading && (
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
          )}

          {!uploading && (
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
          )}

          {files.length > 0 && (
            <div className="files-list">
              <div className="files-list-header">
                <span>{files.length} file{files.length !== 1 ? 's' : ''} ({formatFileSize(getTotalSize())})</span>
                {!uploading && (
                  <button
                    type="button"
                    className="clear-files-btn"
                    onClick={clearFiles}
                    disabled={uploading}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="files-list-items">
                {files.map((file, index) => (
                  <div key={index} className={`file-item ${uploadProgress[file.name]?.status || ''}`}>
                    <div className="file-item-info">
                      <span className="file-item-name" title={file.webkitRelativePath || file.name}>
                        {file.webkitRelativePath || file.name}
                      </span>
                      <span className="file-item-size">{formatFileSize(file.size)}</span>
                      {uploadProgress[file.name]?.status === 'uploading' && uploadProgress[file.name]?.percent !== undefined && (
                        <div className="file-progress-bar">
                          <div
                            className="file-progress-fill"
                            style={{ width: `${uploadProgress[file.name].percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="file-item-actions">
                      {uploadProgress[file.name]?.status === 'uploading' && (
                        <span className="file-status uploading">
                          {uploadProgress[file.name]?.percent !== undefined
                            ? `${uploadProgress[file.name].percent}%`
                            : 'Uploading...'}
                        </span>
                      )}
                      {uploadProgress[file.name]?.status === 'success' && (
                        <span className="file-status success">Done</span>
                      )}
                      {uploadProgress[file.name]?.status === 'error' && (
                        <>
                          <span className="file-status error" title={uploadProgress[file.name]?.error}>
                            Failed
                          </span>
                          {!uploading && (
                            <button
                              type="button"
                              className="retry-btn"
                              onClick={() => handleRetry(file.name)}
                            >
                              Retry
                            </button>
                          )}
                        </>
                      )}
                      {uploadProgress[file.name]?.status === 'cancelled' && (
                        <span className="file-status cancelled">Cancelled</span>
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
            {uploading ? (
              <button type="button" className="btn btn-danger" onClick={handleCancel}>
                Cancel Upload
              </button>
            ) : (
              <>
                <button type="submit" className="btn btn-primary" disabled={files.length === 0}>
                  Upload {files.length > 0 ? files.length : ''} File{files.length !== 1 ? 's' : ''}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClose}
                >
                  Close
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
