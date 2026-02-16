import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { updateAudiobook, embedMetadata, getChapters, updateChapters, refreshMetadata, fetchChaptersFromAudnexus, searchAudnexus } from '../api';
import { useMetadataChanges } from './metadata/useMetadataChanges';
import SearchResultsList from './metadata/SearchResultsList';
import MetadataPreview from './metadata/MetadataPreview';
import ChaptersEditor from './metadata/ChaptersEditor';
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

  const { getChanges } = useMetadataChanges(pendingResult, formData);

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
    setFormData(prev => ({
      ...prev,
      title: selectedFields.title ? (pendingResult.title || prev.title) : prev.title,
      subtitle: selectedFields.subtitle ? (pendingResult.subtitle ?? prev.subtitle) : prev.subtitle,
      author: selectedFields.author ? (pendingResult.author || prev.author) : prev.author,
      narrator: selectedFields.narrator ? (pendingResult.narrator ?? prev.narrator) : prev.narrator,
      description: selectedFields.description ? (pendingResult.description ?? prev.description) : prev.description,
      genre: selectedFields.genre ? (pendingResult.genre ?? prev.genre) : prev.genre,
      tags: selectedFields.tags ? (pendingResult.tags ?? prev.tags) : prev.tags,
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
      handleFetchChapters(pendingResult.asin, true);
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
    setError('');
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

    setSaving(true);
    setEmbedding(true);
    setError('');
    setSuccess('');
    setStatusMessage('Saving metadata to database...');

    try {
      await updateAudiobook(audiobook.id, {
        ...formData,
        series_position: formData.series_position ? parseFloat(formData.series_position) : null,
        published_year: formData.published_year ? parseInt(formData.published_year) : null,
        copyright_year: formData.copyright_year ? parseInt(formData.copyright_year) : null,
        abridged: formData.abridged ? 1 : 0,
      });

      if (chaptersModified && chapters.length > 0) {
        setStatusMessage('Saving chapters...');
        await updateChapters(audiobook.id, chapters);
        setChaptersModified(false);
      }

      setStatusMessage('Embedding metadata, chapters & cover into audio file...');
      await embedMetadata(audiobook.id);

      setStatusMessage('Done!');
      onSave();
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

  const handleClose = () => {
    if (!saving && !embedding) {
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
  }, [isOpen, saving, embedding]);

  if (!isOpen || !audiobook) return null;

  return createPortal(
    <div className="edit-metadata-modal-overlay" onClick={handleClose} role="dialog" aria-modal="true" aria-label="Edit metadata">
      <div className="edit-metadata-modal" onClick={(e) => e.stopPropagation()}>
        {/* Loading Overlay */}
        {(saving || embedding) && (
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
          <SearchResultsList
            results={audnexusResults}
            onSelect={handleSelectAudnexusResult}
            onBack={() => setShowAudnexusResults(false)}
          />
        ) : pendingResult ? (
          <MetadataPreview
            pendingResult={pendingResult}
            changes={getChanges()}
            selectedFields={selectedFields}
            onFieldToggle={handleToggleField}
            onSelectAll={handleSelectAllFields}
            onApply={handleApplyPendingResult}
            onCancel={handleCancelPendingResult}
            error={error}
          />
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

            <ChaptersEditor
              chapters={chapters}
              showChapters={showChapters}
              setShowChapters={setShowChapters}
              chaptersModified={chaptersModified}
              onChapterChange={handleChapterChange}
              onRefresh={handleRefreshChapters}
              refreshing={refreshing}
              saving={saving}
            />

            <div className="modal-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || embedding}
              >
                {saving && !embedding ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleEmbed}
                disabled={saving || embedding}
                title="Save changes and write metadata to file tags"
              >
                {embedding ? 'Embedding...' : 'Save & Embed'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
