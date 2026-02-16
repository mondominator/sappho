/**
 * Hook to compute field differences between pending search result
 * and current form data for the metadata preview UI.
 */
export function useMetadataChanges(pendingResult, formData) {
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

  return { getChanges };
}
