/**
 * Shared helpers for audiobook route modules
 */
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Rate limiters
const jobStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many job status requests, please try again later' },
});

const jobCancelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many cancel requests, please try again later' },
});

const batchDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many delete requests, please try again later' },
});

// Session ID management
function generateSessionId(userId, audiobookId) {
  const random = crypto.randomBytes(8).toString('hex');
  return `sappho-${userId}-${audiobookId}-${random}`;
}

const activeSessionIds = new Map();

function getOrCreateSessionId(userId, audiobookId) {
  const key = `${userId}-${audiobookId}`;
  if (!activeSessionIds.has(key)) {
    activeSessionIds.set(key, generateSessionId(userId, audiobookId));
  }
  return activeSessionIds.get(key);
}

function clearSessionId(userId, audiobookId) {
  const key = `${userId}-${audiobookId}`;
  activeSessionIds.delete(key);
}

/**
 * Strip HTML tags and decode HTML entities from text
 */
function sanitizeHtml(text) {
  if (!text) return text;
  // SECURITY: Produce clean plain text from HTML input
  // Step 1: Strip well-formed HTML tags, then remove any remaining angle brackets
  let cleaned = String(text).replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  // Step 2: Decode safe HTML entities to plain text (skip lt/gt to prevent re-creating tags)
  const entityMap = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
  cleaned = cleaned.replace(/&(nbsp|amp|quot|#39|apos);/gi, (match) => entityMap[match.toLowerCase()] || match);
  cleaned = cleaned.replace(/&lt;/gi, '').replace(/&gt;/gi, '');
  cleaned = cleaned.replace(/&#(\d+);/g, (_, num) => {
    const ch = Number(num);
    return (ch === 60 || ch === 62) ? '' : String.fromCharCode(ch);
  });
  cleaned = cleaned.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const ch = parseInt(hex, 16);
    return (ch === 0x3C || ch === 0x3E) ? '' : String.fromCharCode(ch);
  });
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Extract real client IP address from request
 */
function getClientIP(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }
  const xRealIP = req.headers['x-real-ip'];
  if (xRealIP) return xRealIP;
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) return cfConnectingIP;
  return req.ip || req.connection.remoteAddress || null;
}

/**
 * Get MIME type for audio file based on extension
 */
function getAudioMimeType(filePath) {
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.m4b': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

/**
 * Check if hostname is a private/local address
 */
function isPrivateHostname(hostname) {
  if (!hostname) return true;

  const lower = hostname.toLowerCase();

  // Loopback
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') {
    return true;
  }

  // Private TLDs and suffixes
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost')) {
    return true;
  }

  // 10.x.x.x
  if (lower.startsWith('10.')) return true;

  // 192.168.x.x
  if (lower.startsWith('192.168.')) return true;

  // 169.254.x.x (link-local / cloud metadata)
  if (lower.startsWith('169.254.')) return true;

  // 172.16.0.0 - 172.31.255.255 (check second octet 16-31)
  const match172 = lower.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  // IPv6 private ranges
  // fc00::/7 (unique local addresses: fc00:: and fd00::)
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  }
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  return false;
}

module.exports = {
  jobStatusLimiter,
  jobCancelLimiter,
  batchDeleteLimiter,
  generateSessionId,
  activeSessionIds,
  getOrCreateSessionId,
  clearSessionId,
  sanitizeHtml,
  getClientIP,
  getAudioMimeType,
  isPrivateHostname,
};
