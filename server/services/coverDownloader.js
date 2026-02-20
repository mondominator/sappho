/**
 * Cover Downloader Utility
 *
 * Downloads cover images from external URLs with SSRF protection.
 */

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { isPrivateHostname } = require('../routes/audiobooks/helpers');

const MAX_REDIRECTS = 5;

/**
 * Check if a resolved IP address is private/internal
 */
function isPrivateIP(ip) {
  if (!ip) return true;

  // IPv4 private ranges
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;

  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  // IPv6 private
  if (ip === '::1') return true;
  const lower = ip.toLowerCase();
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  return false;
}

/**
 * Resolve hostname and validate the resolved IP is not private (DNS rebinding protection)
 */
function resolveAndValidate(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) {
        reject(new Error(`DNS resolution failed for ${hostname}: ${err.message}`));
        return;
      }
      if (isPrivateIP(address)) {
        reject(new Error('Hostname resolves to a private/internal IP address'));
        return;
      }
      resolve(address);
    });
  });
}

/**
 * Download cover image from URL to local covers directory.
 * Includes SSRF protection via hostname check, DNS rebinding protection, and redirect limits.
 */
async function downloadCover(url, audiobookId, redirectCount = 0) {
  try {
    const https = require('https');
    const http = require('http');

    // SECURITY: Redirect depth limit
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error('Too many redirects');
    }

    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const coversDir = path.join(dataDir, 'covers');
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }

    // Determine extension from URL or default to jpg
    const parsedUrl = new URL(url);

    // SECURITY: SSRF protection - block private/internal hostnames
    if (isPrivateHostname(parsedUrl.hostname)) {
      throw new Error('Private or internal URLs are not allowed');
    }

    // SECURITY: DNS rebinding protection - resolve and validate IP before connecting
    await resolveAndValidate(parsedUrl.hostname);

    let ext = path.extname(parsedUrl.pathname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      ext = '.jpg';
    }

    const coverPath = path.join(coversDir, `audiobook_${audiobookId}${ext}`);

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      // Build request options with headers (required for Amazon CDN and other image servers)
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sappho/1.0; +https://github.com/mondominator/sappho)',
          'Accept': 'image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      };
      const request = protocol.get(requestOptions, (response) => {
        // Handle redirects with depth tracking
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          downloadCover(response.headers.location, audiobookId, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download cover: HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(coverPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`Downloaded cover to: ${coverPath}`);
          resolve(coverPath);
        });
        fileStream.on('error', (err) => {
          fs.unlink(coverPath, () => {}); // Clean up partial file
          reject(err);
        });
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Cover download timeout'));
      });
    });
  } catch (error) {
    console.error('Error downloading cover:', error);
    return null;
  }
}

module.exports = { downloadCover, isPrivateIP };
