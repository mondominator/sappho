import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCoverUrl, getRecentlyAdded, getInProgress, getUpNext, getProgress } from '../api';
import './Home.css';

export default function Home({ onPlay }) {
  const navigate = useNavigate();
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [inProgress, setInProgress] = useState([]);
  const [upNext, setUpNext] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSpecialSections();
  }, []);

  const loadSpecialSections = async () => {
    try {
      // Load sections individually with error handling for each
      const recentResponse = await getRecentlyAdded(10).catch(err => {
        console.error('Error loading recently added:', err);
        return { data: [] };
      });

      const progressResponse = await getInProgress(10).catch(err => {
        console.error('Error loading in progress:', err);
        return { data: [] };
      });

      const upNextResponse = await getUpNext(10).catch(err => {
        console.error('Error loading up next:', err);
        return { data: [] };
      });

      setRecentlyAdded(recentResponse.data);
      setInProgress(progressResponse.data);
      setUpNext(upNextResponse.data);
    } catch (error) {
      console.error('Error loading special sections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async (book, e) => {
    e.stopPropagation();
    try {
      const progressResponse = await getProgress(book.id);
      const progress = progressResponse.data;
      onPlay(book, progress);
    } catch (error) {
      console.error('Error loading progress:', error);
      onPlay(book, null);
    }
  };

  const renderBookCard = (book) => (
    <div key={book.id} className="audiobook-card">
      <div className="audiobook-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
        {book.cover_image ? (
          <img src={getCoverUrl(book.id)} alt={book.title} onError={(e) => e.target.style.display = 'none'} />
        ) : (
          <div className="audiobook-cover-placeholder">
            <h3>{book.title}</h3>
          </div>
        )}
        {book.progress && book.progress.position > 0 && book.duration && (
          <div className="progress-bar-overlay">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round((book.progress.position / book.duration) * 100)}%` }}
            />
          </div>
        )}
        <div className="play-overlay">
          <button
            className="play-button"
            onClick={(e) => handlePlay(book, e)}
            aria-label={`Play ${book.title}`}
          />
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="home-page">
      {inProgress.length > 0 && (
        <div className="horizontal-section">
          <h2>Continue Listening</h2>
          <div className="horizontal-scroll">
            {inProgress.map(renderBookCard)}
          </div>
        </div>
      )}

      {recentlyAdded.length > 0 && (
        <div className="horizontal-section">
          <h2>Recently Added</h2>
          <div className="horizontal-scroll">
            {recentlyAdded.map(renderBookCard)}
          </div>
        </div>
      )}

      {inProgress.length === 0 && recentlyAdded.length === 0 && (
        <div className="empty-state">
          <p>No audiobooks found.</p>
          <p>Upload some audiobooks or drop them in the watch directory!</p>
        </div>
      )}
    </div>
  );
}
