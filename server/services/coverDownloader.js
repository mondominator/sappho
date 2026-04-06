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
 * Resolve hostname and validate every returned address is public.
 *
 * Returns the first safe IP to connect to. We pin the connection to this
 * exact IP to defeat DNS rebinding: the attacker can't swap in a private
 * address for the second lookup that Node's http client would otherwise
 * perform at request time.
 *
 * Using `all: true` is important — a naive one-shot lookup can miss the
 * case where the hostname has multiple A records, one public and one
 * private, and Node happens to pick the public one during validation
 * but the private one during the actual connection.
 */
function resolveAndValidate(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        reject(new Error(`DNS resolution failed for ${hostname}: ${err.message}`));
        return;
      }
      if (!addresses || addresses.length === 0) {
        reject(new Error(`DNS resolution returned no addresses for ${hostname}`));
        return;
      }
      for (const { address } of addresses) {
        if (isPrivateIP(address)) {
          reject(new Error(`Hostname ${hostname} resolves to private IP ${address}`));
          return;
        }
      }
      resolve(addresses[0].address);
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
