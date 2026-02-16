/**
 * Search results list for metadata search (Audible, Google Books, Open Library)
 */
export default function SearchResultsList({ results, onSelect, onBack }) {
  return (
    <div className="search-results">
      <div className="search-results-header">
        <h3>Search Results</h3>
        <button
          className="btn btn-secondary btn-small"
          onClick={onBack}
        >
          Back to Form
        </button>
      </div>
      <div className="results-list">
        {results.map((result, index) => (
          <div
            key={result.asin || `${result.source}-${index}`}
            className="result-item"
            onClick={() => onSelect(result)}
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
  );
}
