/**
 * Cover Downloader Utility
 *
 * Downloads cover images from external URLs with SSRF protection.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const {
  isPrivateIp,
  isPrivateHostname,
  resolvePublicHost,
} = require('../utils/networkSecurity');

const MAX_REDIRECTS = 5;

/**
 * Resolve hostname and return the first safe IP to connect to. Delegates
 * to the shared `resolvePublicHost` helper in utils/networkSecurity so
 * coverDownloader, oidcService, etc. all share the exact same allowlist.
 */
async function resolveAndValidate(hostname) {
  const addresses = await resolvePublicHost(hostname);
  return addresses[0];
}

// Backwards-compat alias — older callers/tests imported `isPrivateIP`
// from this module, so re-export it here while we migrate.
const isPrivateIP = isPrivateIp;

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

    // Determine extension from URL or default to jpg.
    // `new URL(url)` throws on invalid input (including relative URLs from a
    // malformed redirect header); we catch it below rather than crashing.
    const parsedUrl = new URL(url);

    // SECURITY: only http/https schemes — reject data:, file:, gopher:, etc.
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme: ${parsedUrl.protocol}`);
    }

    // SECURITY: SSRF protection - block private/internal hostnames
    if (isPrivateHostname(parsedUrl.hostname)) {
      throw new Error('Private or internal URLs are not allowed');
    }

    // SECURITY: DNS rebinding protection - resolve and validate every address,
    // then pin the request to the validated IP. We can't trust Node's http
    // client to re-use the IP we validated; we override `host` explicitly.
    const resolvedIp = await resolveAndValidate(parsedUrl.hostname);

    let ext = path.extname(parsedUrl.pathname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      ext = '.jpg';
    }

    const coverPath = path.join(coversDir, `audiobook_${audiobookId}${ext}`);

    // Remove any existing cover files for this audiobook (may have different extension)
    const existingCovers = fs.readdirSync(coversDir)
      .filter(f => f.startsWith(`audiobook_${audiobookId}.`));
    for (const old of existingCovers) {
      const oldPath = path.join(coversDir, old);
      if (oldPath !== coverPath) {
        fs.unlinkSync(oldPath);
      }
    }

    return new Promise((resolve, reject) => {
      const isHttps = parsedUrl.protocol === 'https:';
      const protocol = isHttps ? https : http;
      // Pin the connection to the IP we validated, but keep the Host header
      // and (for TLS) servername as the original hostname so certificate
      // validation + virtual hosting still work.
      const requestOptions = {
        host: resolvedIp,
        hostname: resolvedIp,
        servername: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          Host: parsedUrl.host,
          'User-Agent': 'Mozilla/5.0 (compatible; Sappho/1.0; +https://github.com/mondominator/sappho)',
          'Accept': 'image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      };
      const request = protocol.get(requestOptions, (response) => {
        // Handle redirects with depth tracking. Redirect targets may be
        // relative paths — resolve against the current URL so we don't
        // crash on `new URL('/foo')` in the recursive call.
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let nextUrl;
          try {
            nextUrl = new URL(response.headers.location, url).toString();
          } catch (err) {
            reject(new Error(`Invalid redirect target: ${err.message}`));
            return;
          }
          downloadCover(nextUrl, audiobookId, redirectCount + 1).then(resolve).catch(reject);
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
          logger.info(`Downloaded cover to: ${coverPath}`);
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
    logger.error('Error downloading cover:', error);
    return null;
  }
}

module.exports = { downloadCover, isPrivateIP };
