import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSeries, getCoverUrl } from '../api';
import './SeriesList.css';

export default function SeriesList() {
  const navigate = useNavigate();
  const [seriesList, setSeriesList] = useState([]);
  const [filteredSeries, setFilteredSeries] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeries();
  }, []);

  useEffect(() => {
    if (search.trim()) {
      setFilteredSeries(
        seriesList.filter(series =>
          series.series.toLowerCase().includes(search.toLowerCase())
        )
      );
    } else {
      setFilteredSeries(seriesList);
    }
  }, [search, seriesList]);

  const loadSeries = async () => {
    try {
      const response = await getSeries();
      setSeriesList(response.data);
      setFilteredSeries(response.data);
    } catch (error) {
      console.error('Error loading series:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading series...</div>;
  }

  return (
    <div className="series-list-page container">
      {filteredSeries.length === 0 ? (
        <div className="empty-state">
          <p>No series found.</p>
        </div>
      ) : (
        <>
          <div className="series-list-header">
            <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
            <h2 className="series-list-count">{filteredSeries.length} {filteredSeries.length === 1 ? 'Series' : 'Series'}</h2>
          </div>
          <div className="series-grid">
            {filteredSeries.map((series) => (
            <div
              key={series.series}
              className="series-card"
              onClick={() => navigate(`/series/${encodeURIComponent(series.series)}`)}
            >
              <div className="series-covers">
                <div className="series-book-count">{series.book_count}</div>
                {series.cover_ids && series.cover_ids.length > 0 ? (
                  <div className={`cover-grid cover-grid-${Math.min(series.cover_ids.length, 4)}`}>
                    {series.cover_ids.slice(0, 4).map((coverId, index) => (
                      <div key={index} className="cover-thumbnail">
                        <img
                          src={getCoverUrl(coverId)}
                          alt={`${series.series} cover ${index + 1}`}
                          onError={(e) => e.target.src = '/placeholder-cover.png'}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="series-placeholder">
                    <span>{series.series.charAt(0)}</span>
                  </div>
                )}
              </div>
              <div className="series-card-content">
                <h3 className="series-title">{series.series}</h3>
                <div className="series-stats">
                  {series.average_rating && (
                    <span className="series-rating">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {series.average_rating}
                    </span>
                  )}
                  {series.completed_count > 0 && (
                    <span className="completion-badge">
                      {series.completed_count}/{series.book_count} read
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
