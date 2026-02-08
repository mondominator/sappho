import { useState, useEffect } from 'react';
import { updateAudiobook, embedMetadata, convertToM4B, getChapters, updateChapters, refreshMetadata, fetchChaptersFromAudnexus, searchAudnexus } from '../api';
import './EditMetadataModal.css';

export default function EditMetadataModal({ isOpen, onClose, audiobook, onSave }) {
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    author: '',
    narrator: '',
    description: '',
    genre: '',
    tags: '',
    series: '',
    series_position: '',
    published_year: '',
    copyright_year: '',
    publisher: '',
    isbn: '',
    asin: '',
    language: '',
    rating: '',
    abridged: false,
    cover_url: '',  // URL to download new cover from
  });
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingChapters, setFetchingChapters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [chapters, setChapters] = useState([]);
  const [showChapters, setShowChapters] = useState(false);
  const [chaptersModified, setChaptersModified] = useState(false);
  const [audnexusResults, setAudnexusResults] = useState([]);
  const [showAudnexusResults, setShowAudnexusResults] = useState(false);
  const [pendingResult, setPendingResult] = useState(null); // For preview before applying
  const [selectedFields, setSelectedFields] = useState({}); // Track which fields to apply

  useEffect(() => {
    if (audiobook) {
      setFormData({
        title: audiobook.title || '',
        subtitle: audiobook.subtitle || '',
        author: audiobook.author || '',
        narrator: audiobook.narrator || '',
        description: audiobook.description || '',
        genre: audiobook.genre || '',
        tags: audiobook.tags || '',
        series: audiobook.series || '',
        series_position: audiobook.series_position || '',
        published_year: audiobook.published_year || '',
        copyright_year: audiobook.copyright_year || '',
        publisher: audiobook.publisher || '',
        isbn: audiobook.isbn || '',
        asin: audiobook.asin || '',
        language: audiobook.language || '',
        rating: audiobook.rating || '',
        abridged: !!audiobook.abridged,  // Convert 0/1 to boolean properly
        cover_url: '',  // Reset cover URL when audiobook changes
      });
      setAudnexusResults([]);
      setShowAudnexusResults(false);
      setPendingResult(null);
      setError('');
      setSuccess('');
      setChapters([]);
      setShowChapters(false);
      setChaptersModified(false);
      // Load chapters
      loadChapters();
    }
  }, [audiobook]);

  const loadChapters = async () => {
    if (!audiobook) return;
    try {
      const response = await getChapters(audiobook.id);
      setChapters(response.data || []);
    } catch (err) {
      console.error('Failed to load chapters:', err);
    }
  };

  const handleChapterChange = (index, newTitle) => {
    const updated = [...chapters];
    updated[index] = { ...updated[index], title: newTitle };
    setChapters(updated);
    setChaptersModified(true);
  };

  const handleRefreshChapters = async () => {
    setRefreshing(true);
    setError('');
    setSuccess('');
    try {
      await refreshMetadata(audiobook.id);
      await loadChapters();
      setSuccess('Chapters re-extracted from file');
      onSave(); // Refresh parent data
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to refresh chapters');
    } finally {
      setRefreshing(false);
    }
  };

  const handleFetchChapters = async (asinToUse, skipParentRefresh = false) => {
    const asin = asinToUse || formData.asin;
    if (!asin) {
      setError('ASIN is required to fetch chapters');
      return;
    }

    setFetchingChapters(true);
    setError('');
    // Don't clear success message if called from apply flow
    if (!skipParentRefresh) {
      setSuccess('');
    }
    try {
      const response = await fetchChaptersFromAudnexus(audiobook.id, asin);
      await loadChapters();
      setSuccess(response.data.message || 'Chapters fetched successfully');
      if (!formData.asin) {
        setFormData(prev => ({ ...prev, asin }));
      }
      // Only refresh parent if not called from apply flow (would reset form data)
      if (!skipParentRefresh) {
        onSave();
      }
    } catch (err) {
      console.error('Chapter fetch error:', err);
      setError(err.response?.data?.error || 'Failed to fetch chapters');
    } finally {
      setFetchingChapters(false);
      setShowAudnexusResults(false);
    }
  };

  const handleSearchAudnexus = async () => {
    if (!formData.title && !formData.author) {
      setError('Enter a title or author to search Audnexus');
      return;
    }

    setSearching(true);
    setError('');
    setAudnexusResults([]);

    try {
      const response = await searchAudnexus(audiobook.id, {
        title: formData.title,
        author: formData.author,
      });

      if (response.data.results && response.data.results.length > 0) {
        setAudnexusResults(response.data.results);
        setShowAudnexusResults(true);
      } else {
        setError('No results found. Try adjusting the title or author.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectAudnexusResult = (result) => {
    // Show preview instead of applying immediately
    setPendingResult(result);
    setShowAudnexusResults(false);
    // Initialize all fields as selected (checked by default)
    // We'll compute the actual changes and select all of them
    const allFields = [
      'title', 'subtitle', 'author', 'narrator', 'series', 'series_position',
      'genre', 'tags', 'publisher', 'published_year', 'copyright_year',
      'isbn', 'asin', 'language', 'rating', 'description', 'abridged', 'cover'
    ];
    const initialSelected = {};
    allFields.forEach(key => { initialSelected[key] = true; });
    setSelectedFields(initialSelected);
  };

  const handleApplyPendingResult = () => {
    if (!pendingResult) return;

    // Count selected fields
    const selectedCount = Object.values(selectedFields).filter(Boolean).length;
    if (selectedCount === 0) {
      setError('Please select at least one field to apply');
      return;
    }

    // Apply only SELECTED metadata from the result
    // Use nullish coalescing for fields that should keep previous value only if new value is undefined
    // Use explicit checks for series fields to allow clearing them when new metadata doesn't have series
    setFormData(prev => ({
      ...prev,
      title: selectedFields.title ? (pendingResult.title || prev.title) : prev.title,
      subtitle: selectedFields.subtitle ? (pendingResult.subtitle ?? prev.subtitle) : prev.subtitle,
      author: selectedFields.author ? (pendingResult.author || prev.author) : prev.author,
      narrator: selectedFields.narrator ? (pendingResult.narrator ?? prev.narrator) : prev.narrator,
      description: selectedFields.description ? (pendingResult.description ?? prev.description) : prev.description,
      genre: selectedFields.genre ? (pendingResult.genre ?? prev.genre) : prev.genre,
      tags: selectedFields.tags ? (pendingResult.tags ?? prev.tags) : prev.tags,
      // Series fields: explicitly replace with new value (even if empty) to allow moving books between series
      series: selectedFields.series ? (pendingResult.series ?? '') : prev.series,
      series_position: selectedFields.series_position ? (pendingResult.series_position ?? '') : prev.series_position,
      published_year: selectedFields.published_year ? (pendingResult.published_year ?? prev.published_year) : prev.published_year,
      copyright_year: selectedFields.copyright_year ? (pendingResult.copyright_year ?? prev.copyright_year) : prev.copyright_year,
      publisher: selectedFields.publisher ? (pendingResult.publisher ?? prev.publisher) : prev.publisher,
      isbn: selectedFields.isbn ? (pendingResult.isbn ?? prev.isbn) : prev.isbn,
      asin: selectedFields.asin ? (pendingResult.asin ?? prev.asin) : prev.asin,
      language: selectedFields.language ? (pendingResult.language ?? prev.language) : prev.language,
      rating: selectedFields.rating ? (pendingResult.rating ?? prev.rating) : prev.rating,
      abridged: selectedFields.abridged ? (pendingResult.abridged !== undefined ? !!pendingResult.abridged : prev.abridged) : prev.abridged,
      cover_url: selectedFields.cover ? (pendingResult.image || prev.cover_url) : prev.cover_url,
    }));

    // Only fetch chapters if it's an Audible result with an ASIN and ASIN is selected
    if (pendingResult.hasChapters && pendingResult.asin && selectedFields.asin) {
      handleFetchChapters(pendingResult.asin, true); // Skip parent refresh to preserve form data
      setSuccess(`${selectedCount} field(s) applied! Fetching chapters...`);
    } else {
      setSuccess(`${selectedCount} field(s) applied!`);
    }
    setPendingResult(null);
    setSelectedFields({});
  };

  const handleCancelPendingResult = () => {
    setPendingResult(null);
    setSelectedFields({});
  };

  const handleToggleField = (fieldKey) => {
    setSelectedFields(prev => ({
      ...prev,
      [fieldKey]: !prev[fieldKey]
    }));
    setError(''); // Clear any "select at least one field" error
  };

  const handleSelectAllFields = (selectAll) => {
    const changes = getChanges();
    const newSelected = {};
    changes.forEach(change => {
      newSelected[change.key] = selectAll;
    });
    setSelectedFields(prev => ({ ...prev, ...newSelected }));
    setError(''); // Clear any "select at least one field" error
  };

  // Helper to get changes between current form and pending result
  const getChanges = () => {
    if (!pendingResult) return [];

    const fields = [
      { key: 'title', label: 'Title' },
      { key: 'subtitle', label: 'Subtitle' },
      { key: 'author', label: 'Author' },
      { key: 'narrator', label: 'Narrator' },
      { key: 'series', label: 'Series' },
      { key: 'series_position', label: 'Series #' },
      { key: 'genre', label: 'Genre' },
      { key: 'tags', label: 'Tags' },
      { key: 'publisher', label: 'Publisher' },
      { key: 'published_year', label: 'Year' },
      { key: 'copyright_year', label: 'Copyright' },
      { key: 'isbn', label: 'ISBN' },
      { key: 'asin', label: 'ASIN' },
      { key: 'language', label: 'Language' },
      { key: 'rating', label: 'Rating' },
      { key: 'description', label: 'Description' },
    ];

    // Language normalization map (handle "english" vs "en", etc.)
    const normalizeLanguage = (lang) => {
      if (!lang) return '';
      const lower = String(lang).toLowerCase().trim();
      const langMap = {
        'english': 'en', 'en': 'en',
        'spanish': 'es', 'es': 'es',
        'french': 'fr', 'fr': 'fr',
        'german': 'de', 'de': 'de',
        'italian': 'it', 'it': 'it',
        'portuguese': 'pt', 'pt': 'pt',
        'japanese': 'ja', 'ja': 'ja',
        'chinese': 'zh', 'zh': 'zh',
      };
      return langMap[lower] || lower;
    };

    const changes = [];
    for (const field of fields) {
      const newVal = pendingResult[field.key];
      const oldVal = formData[field.key];

      // Convert both to strings for comparison to handle type differences (number vs string)
      let newValStr = newVal != null ? String(newVal) : '';
      let oldValStr = oldVal != null ? String(oldVal) : '';

      // Normalize language values for comparison
      if (field.key === 'language') {
        newValStr = normalizeLanguage(newValStr);
        oldValStr = normalizeLanguage(oldValStr);
      }

      // For series fields, show changes even when clearing (old has value, new is empty)
      const isSeriesField = field.key === 'series' || field.key === 'series_position';
      const isClearing = isSeriesField && oldValStr && !newValStr;
      const isChanging = newValStr && newValStr !== oldValStr;

      if (isChanging || isClearing) {
        changes.push({
          key: field.key,
          label: field.label,
          oldValue: oldValStr || '(empty)',
          newValue: isClearing ? '(removed)' : (field.key === 'description' ? (newValStr.slice(0, 100) + (newValStr.length > 100 ? '...' : '')) : newValStr),
          isNew: !oldValStr,
          isRemoval: isClearing,
        });
      }
    }

    // Handle abridged separately (boolean) - convert both to boolean for comparison
    const pendingAbridged = !!pendingResult.abridged;
    if (pendingResult.abridged !== undefined && pendingAbridged !== formData.abridged) {
      changes.push({
        key: 'abridged',
        label: 'Abridged',
        oldValue: formData.abridged ? 'Yes' : 'No',
        newValue: pendingAbridged ? 'Yes' : 'No',
        isNew: false,
      });
    }

    // Handle cover image - check if pending result has an image URL
    if (pendingResult.image) {
      changes.push({
        key: 'cover',
        label: 'Cover',
        oldValue: formData.cover_url ? 'Has cover' : '(no cover)',
        newValue: 'New cover from search',
        isNew: !formData.cover_url,
      });
    }

    return changes;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title) {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError('');
    setStatusMessage(formData.cover_url ? 'Downloading cover and saving metadata...' : 'Saving metadata to database...');

    try {
      await updateAudiobook(audiobook.id, {
        ...formData,
        series_position: formData.series_position ? parseFloat(formData.series_position) : null,
        published_year: formData.published_year ? parseInt(formData.published_year) : null,
        copyright_year: formData.copyright_year ? parseInt(formData.copyright_year) : null,
        abridged: formData.abridged ? 1 : 0,
      });

      // Also save chapters if modified
      if (chaptersModified && chapters.length > 0) {
        setStatusMessage('Saving chapters...');
        await updateChapters(audiobook.id, chapters);
        setChaptersModified(false);
      }

      setStatusMessage('Done!');
      onSave();
      // Auto-close after short delay
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save changes');
      setStatusMessage('');
    } finally {
      setSaving(false);
    }
  };

  const handleEmbed = async () => {
    if (!formData.title) {
      setError('Title is required');
      return;
    }

    // First save to database, then embed
    setSaving(true);
    setEmbedding(true);
    setError('');
    setSuccess('');
    setStatusMessage('Saving metadata to database...');

    try {
      // Save to database first
      await updateAudiobook(audiobook.id, {
        ...formData,
        series_position: formData.series_position ? parseFloat(formData.series_position) : null,
        published_year: formData.published_year ? parseInt(formData.published_year) : null,
        copyright_year: formData.copyright_year ? parseInt(formData.copyright_year) : null,
        abridged: formData.abridged ? 1 : 0,
      });

      // Also save chapters if modified
      if (chaptersModified && chapters.length > 0) {
        setStatusMessage('Saving chapters...');
        await updateChapters(audiobook.id, chapters);
        setChaptersModified(false);
      }

      // Then embed into file
      setStatusMessage('Embedding metadata, chapters & cover into audio file...');
      await embedMetadata(audiobook.id);

      setStatusMessage('Done!');
      onSave();
      // Auto-close after short delay
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to embed metadata');
      setStatusMessage('');
    } finally {
      setSaving(false);
      setEmbedding(false);
    }
  };

  const handleConvertToM4B = async () => {
    if (!confirm('Convert this M4A file to M4B format? This will replace the original file.')) {
      return;
    }

    setConverting(true);
    setError('');
    setSuccess('');
    setStatusMessage('Converting to M4B format...');

    try {
      const response = await convertToM4B(audiobook.id);
      setStatusMessage('');
      setSuccess(`Converted to M4B successfully! File is now at: ${response.data.newPath?.split('/').pop() || 'new location'}`);
      onSave(); // Refresh parent to get updated file_path

      // Keep success message visible for a moment, then close
      setTimeout(() => {
        setConverting(false);
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to convert to M4B');
      setStatusMessage('');
      setConverting(false);
    }
  };

  const handleClose = () => {
    if (!saving && !embedding && !converting) {
      setAudnexusResults([]);
      setShowAudnexusResults(false);
      setPendingResult(null);
      setError('');
      setStatusMessage('');
      onClose();
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, saving, embedding, converting]);

  if (!isOpen || !audiobook) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} role="dialog" aria-modal="true" aria-label="Edit metadata">
      <div className="modal edit-metadata-modal" onClick={(e) => e.stopPropagation()}>
        {/* Loading Overlay */}
        {(saving || embedding || converting) && (
          <div className="saving-overlay">
            <div className="saving-content">
              <div className="saving-spinner"></div>
              <div className="saving-message">{statusMessage}</div>
            </div>
          </div>
        )}

        <div className="modal-header">
          <h2>Edit Metadata</h2>
          <button className="close-button" onClick={handleClose} disabled={saving} aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        {showAudnexusResults && audnexusResults.length > 0 ? (
          <div className="search-results">
            <div className="search-results-header">
              <h3>Search Results</h3>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setShowAudnexusResults(false)}
              >
                Back to Form
              </button>
            </div>
            <div className="results-list">
              {audnexusResults.map((result, index) => (
                <div
                  key={result.asin || `${result.source}-${index}`}
                  className="result-item"
                  onClick={() => handleSelectAudnexusResult(result)}
                >
                  {result.image && (
                    <img
                      src={result.image}
                      alt={result.title}
                      className="result-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="result-info">
                    <div className="result-title">
                      {result.title}
                      <span className={`result-source source-${result.source || 'audible'}`}>
                        {result.source === 'google' ? 'Google' : result.source === 'openlibrary' ? 'OpenLibrary' : 'Audible'}
                      </span>
                    </div>
                    {result.author && <div className="result-author">by {result.author}</div>}
                    {result.narrator && <div className="result-narrator">Narrated by {result.narrator}</div>}
                    {result.series && (
                      <div className="result-series">
                        {result.series}{result.series_position ? ` #${result.series_position}` : ''}
                      </div>
                    )}
                    {result.hasChapters && <div className="result-chapters">Has chapters</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : pendingResult ? (
          <div className="metadata-preview">
            <div className="preview-header">
              <h3>Apply Metadata{pendingResult.source ? ` from ${pendingResult.source === 'google' ? 'Google Books' : pendingResult.source === 'openlibrary' ? 'Open Library' : 'Audible'}` : ''}?</h3>
              <p className="preview-subtitle">Review changes before applying</p>
            </div>

            <div className="preview-book-info">
              {pendingResult.image && (
                <img src={pendingResult.image} alt={pendingResult.title} className="preview-cover" loading="lazy" />
              )}
              <div className="preview-book-details">
                <div className="preview-book-title">{pendingResult.title}</div>
                {pendingResult.author && <div className="preview-book-author">by {pendingResult.author}</div>}
                {pendingResult.narrator && <div className="preview-book-narrator">Narrated by {pendingResult.narrator}</div>}
              </div>
            </div>

            <div className="preview-changes">
              <div className="preview-changes-header">
                <h4>Select fields to update:</h4>
                {getChanges().length > 0 && (
                  <div className="select-all-controls">
                    <button
                      type="button"
                      className="select-link"
                      onClick={() => handleSelectAllFields(true)}
                    >
                      Select All
                    </button>
                    <span className="select-divider">|</span>
                    <button
                      type="button"
                      className="select-link"
                      onClick={() => handleSelectAllFields(false)}
                    >
                      Select None
                    </button>
                  </div>
                )}
              </div>
              {getChanges().length === 0 ? (
                <p className="no-changes">No changes to apply (all fields match)</p>
              ) : (
                <div className="changes-list">
                  {getChanges().map((change, idx) => (
                    <label
                      key={idx}
                      className={`change-item ${change.isNew ? 'is-new' : 'is-update'} ${!selectedFields[change.key] ? 'is-unchecked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFields[change.key] || false}
                        onChange={() => handleToggleField(change.key)}
                        className="change-checkbox"
                      />
                      <span className="change-label">{change.label}</span>
                      {change.isNew ? (
                        <span className="change-value new-value">{change.newValue}</span>
                      ) : (
                        <>
                          <span className="change-value old-value">{change.oldValue}</span>
                          <span className="change-arrow">→</span>
                          <span className="change-value new-value">{change.newValue}</span>
                        </>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {pendingResult.hasChapters && pendingResult.asin && (
                <p className="chapters-note">Chapters will also be fetched from Audible.</p>
              )}
            </div>

            <div className="preview-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancelPendingResult}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleApplyPendingResult}
              >
                Apply Changes
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="edit-form">
            {/* Search Audible Button - Prominent at top */}
            <div className="search-audible-section">
              <button
                type="button"
                className="btn btn-primary search-audible-btn"
                onClick={handleSearchAudnexus}
                disabled={saving || searching || (!formData.title && !formData.author)}
              >
                {searching ? 'Searching...' : 'Search for Metadata'}
              </button>
              <p className="search-hint">Searches Audible, Google Books, and Open Library</p>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="title">Title</label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="subtitle">Subtitle</label>
                <input
                  type="text"
                  id="subtitle"
                  name="subtitle"
                  value={formData.subtitle}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="author">Author</label>
                <input
                  type="text"
                  id="author"
                  name="author"
                  value={formData.author}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="narrator">Narrator</label>
                <input
                  type="text"
                  id="narrator"
                  name="narrator"
                  value={formData.narrator}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="series">Series</label>
                <input
                  type="text"
                  id="series"
                  name="series"
                  value={formData.series}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group" style={{ width: '100px' }}>
                <label htmlFor="series_position">#</label>
                <input
                  type="number"
                  id="series_position"
                  name="series_position"
                  value={formData.series_position}
                  onChange={handleChange}
                  disabled={saving}
                  step="0.1"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="genre">Genre</label>
                <input
                  type="text"
                  id="genre"
                  name="genre"
                  value={formData.genre}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="tags">Tags</label>
                <input
                  type="text"
                  id="tags"
                  name="tags"
                  value={formData.tags}
                  onChange={handleChange}
                  disabled={saving}
                  placeholder="Adventure, Dystopian, etc."
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="publisher">Publisher</label>
                <input
                  type="text"
                  id="publisher"
                  name="publisher"
                  value={formData.publisher}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group" style={{ width: '100px' }}>
                <label htmlFor="published_year">Year</label>
                <input
                  type="number"
                  id="published_year"
                  name="published_year"
                  value={formData.published_year}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="isbn">ISBN</label>
                <input
                  type="text"
                  id="isbn"
                  name="isbn"
                  value={formData.isbn}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="language">Language</label>
                <input
                  type="text"
                  id="language"
                  name="language"
                  value={formData.language}
                  onChange={handleChange}
                  disabled={saving}
                  placeholder="english"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ width: '100px' }}>
                <label htmlFor="rating">Rating</label>
                <input
                  type="text"
                  id="rating"
                  name="rating"
                  value={formData.rating}
                  onChange={handleChange}
                  disabled={saving}
                  placeholder="4.5"
                />
              </div>
              <div className="form-group" style={{ width: '120px' }}>
                <label htmlFor="copyright_year">Copyright</label>
                <input
                  type="number"
                  id="copyright_year"
                  name="copyright_year"
                  value={formData.copyright_year}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="abridged"
                    checked={formData.abridged}
                    onChange={(e) => setFormData(prev => ({ ...prev, abridged: e.target.checked }))}
                    disabled={saving}
                  />
                  Abridged
                </label>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                disabled={saving}
                rows={4}
              />
            </div>

            {/* ASIN and Chapter Fetching Section */}
            <div className="asin-section">
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="asin">Audible ASIN</label>
                  <input
                    type="text"
                    id="asin"
                    name="asin"
                    value={formData.asin}
                    onChange={handleChange}
                    disabled={saving}
                    placeholder="e.g., B00I2VWW5U (auto-filled when searching)"
                  />
                </div>
                <div className="form-group asin-buttons">
                  <label>&nbsp;</label>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => handleFetchChapters()}
                    disabled={saving || fetchingChapters || !formData.asin}
                    title="Fetch chapter data from Audible using ASIN"
                  >
                    {fetchingChapters ? 'Fetching...' : 'Get Chapters'}
                  </button>
                </div>
              </div>
            </div>

            {/* Chapters Section */}
            {chapters.length > 0 && (
              <div className="chapters-section">
                <div
                  className="chapters-header"
                  onClick={() => setShowChapters(!showChapters)}
                >
                  <span>
                    Chapters ({chapters.length})
                    {chaptersModified && <span className="modified-indicator"> *</span>}
                  </span>
                  <svg
                    className={`chevron ${showChapters ? 'open' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                {showChapters && (
                  <div className="chapters-content">
                    <div className="chapters-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={handleRefreshChapters}
                        disabled={refreshing || saving}
                      >
                        {refreshing ? 'Extracting...' : 'Re-extract from File'}
                      </button>
                    </div>
                    <div className="chapters-list-edit">
                      {chapters.map((chapter, index) => (
                        <div key={chapter.id || index} className="chapter-edit-row">
                          <span className="chapter-number">{index + 1}.</span>
                          <input
                            type="text"
                            value={chapter.title || ''}
                            onChange={(e) => handleChapterChange(index, e.target.value)}
                            disabled={saving}
                            placeholder={`Chapter ${index + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || embedding || converting}
              >
                {saving && !embedding ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleEmbed}
                disabled={saving || embedding || converting}
                title="Save changes and write metadata to file tags"
              >
                {embedding ? 'Embedding...' : 'Save & Embed'}
              </button>
              {audiobook?.file_path && !audiobook.file_path.toLowerCase().endsWith('.m4b') && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleConvertToM4B}
                  disabled={saving || embedding || converting}
                  title="Convert to M4B audiobook format (supports MP3, M4A, OGG, FLAC)"
                >
                  {converting ? 'Converting...' : 'Convert to M4B'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
