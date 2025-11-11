import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSeries, getCoverUrl } from '../api';
import './SeriesList.css';

export default function SeriesList() {
  const navigate = useNavigate();
  const [seriesList, setSeriesList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeries();
  }, []);

  const loadSeries = async () => {
    try {
      const response = await getSeries();
      setSeriesList(response.data);
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
      {seriesList.length === 0 ? (
        <div className="empty-state">
          <p>No series found.</p>
        </div>
      ) : (
        <>
          <div className="series-list-header">
            <h2 className="series-list-count">{seriesList.length} {seriesList.length === 1 ? 'Series' : 'Series'}</h2>
          </div>
          <div className="series-grid">
            {seriesList.map((series) => (
            <div
              key={series.series}
              className="series-card"
              onClick={() => navigate(`/series/${encodeURIComponent(series.series)}`)}
            >
              <div className="series-covers">
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
                  <p className="series-count">{series.book_count} book{series.book_count !== 1 ? 's' : ''}</p>
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
