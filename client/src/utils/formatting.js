/**
 * Shared formatting utilities
 */

/**
 * Format duration as "Xh Ym" or "Ym" if under an hour.
 * Returns empty string for falsy values.
 */
export const formatDuration = (seconds) => {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

/**
 * Format duration as { hours, minutes } parts.
 * Used by Library.jsx for custom rendering.
 */
export const formatDurationParts = (seconds) => {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
};

/**
 * Format duration as compact hours-only string: "Xh".
 * Used by SeriesDetail for book cards.
 */
export const formatDurationCompact = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  return `${hours}h`;
};

/**
 * Format duration with days support and "0h" fallback.
 * Used by statistics and user admin displays.
 */
export const formatDurationStat = (seconds) => {
  if (!seconds || seconds === 0) return '0h';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/**
 * Format file size in human-readable form.
 * Returns "Unknown" for falsy values.
 */
export const formatFileSize = (bytes) => {
  if (bytes == null || bytes === false) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * Format time with seconds precision: "Xh Ym Zs" or "Ym Zs".
 * Used by audio player for playback position display.
 */
export const formatTime = (seconds) => {
  if (isNaN(seconds)) return '0m 0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  return `${minutes}m ${secs}s`;
};

/**
 * Strip chapter markers and track numbers from description text.
 */
export const cleanDescription = (description) => {
  if (!description) return '';
  let cleaned = description;
  cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
  cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');
  cleaned = cleaned.replace(/^(\s*Chapter\s+([A-Z][a-z]+(-[A-Z][a-z]+)*)\s*)+/i, '');
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');
  cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');
  cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');
  cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');
  cleaned = cleaned.replace(/^(\s*-\d+-?\s*)+/, '');
  cleaned = cleaned.replace(/^(\s*\d+[.)]\s*)+/, '');
  cleaned = cleaned.replace(/^(\s*(Track\s+)?\d+(\s*-\s*|\s+))+/i, '');
  return cleaned.trim();
};
