import { useDownload } from '../contexts/DownloadContext';
import './OfflineBadge.css';

/**
 * OfflineBadge Component
 *
 * A small badge indicator that shows on book cards when the book
 * is downloaded for offline playback. Displays a cloud-with-checkmark icon.
 *
 * @param {Object} props
 * @param {string|number} props.audiobookId - The audiobook ID to check
 */
export default function OfflineBadge({ audiobookId }) {
  const { isDownloaded } = useDownload();

  // Only show badge if the book is downloaded
  if (!isDownloaded(audiobookId)) {
    return null;
  }

  return (
    <div className="offline-badge" title="Available offline">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Cloud shape */}
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        {/* Checkmark inside cloud */}
        <polyline points="9 14 11.5 16.5 15 12" />
      </svg>
    </div>
  );
}
