/**
 * Network security helpers used across SSRF-sensitive code paths
 * (cover downloads, OIDC discovery, any outbound fetch with user-supplied
 * URLs).
 *
 * Consolidated here so the three previous copies — one in
 * routes/audiobooks/helpers.js, one in services/coverDownloader.js, and
 * one in services/oidcService.js — can't drift out of sync. Adding or
 * removing a private range in one place used to silently leave the
 * others vulnerable.
 */

const net = require('net');
const dns = require('dns').promises;

/**
 * Return true if `ip` is an RFC1918 private IPv4, IPv4 loopback/link-local,
 * CGNAT, or any IPv6 loopback/unique-local/link-local address. Unknown
 * strings (not a valid IP literal) are treated as unsafe.
 *
 * IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) recurse into the IPv4 check.
 */
function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local, incl. 169.254.169.254 cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (CGNAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // fc00::/7 (unique local) — matches fc__: and fd__: prefixes.
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
    // fe80::/10 (link-local) — matches fe8_:, fe9_:, fea_:, feb_: prefixes.
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice(7);
      if (net.isIPv4(v4)) return isPrivateIp(v4);
    }
    return false;
  }
  return true; // not a valid IP → treat as unsafe
}

/**
 * Return true if `hostname` is something we should refuse to fetch from
 * BEFORE resolving DNS. Handles IP literals and common private TLDs
 * (.local, .internal, .localhost) plus the `localhost` label itself.
 *
 * This is a *pre-resolution* screen; follow it up with resolvePublicHost
 * to defeat DNS-based tricks (round-robin mix of public + private, etc.).
 */
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();

  if (lower === 'localhost' || lower === '0.0.0.0') return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost')) {
    return true;
  }
  // If it's an IP literal, defer to the IP check.
  if (net.isIP(lower)) return isPrivateIp(lower);
  return false;
}

/**
 * Resolve a hostname and reject any result that lists a private address.
 * Returns the first public IPv4/IPv6 address so callers can pin the
 * outbound request to it, defeating DNS rebinding (the attacker can't
 * swap the address between our validation lookup and Node's own lookup).
 *
 * Pass `{ allowPrivate: true }` to bypass the check — used in tests and
 * for operators who explicitly need to fetch from a LAN issuer.
 */
async function resolvePublicHost(hostname, { allowPrivate = false } = {}) {
  if (allowPrivate) {
    if (net.isIP(hostname)) return [hostname];
    const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
    return addrs.map((a) => a.address);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Refusing to connect to private/loopback IP: ${hostname}`);
    }
    return [hostname];
  }

  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS lookup failed for ${hostname}: ${err.message}`);
  }
  if (!addrs || addrs.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}`);
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(`Refusing to connect to ${hostname}: resolves to private IP ${address}`);
    }
  }
  return addrs.map((a) => a.address);
}

module.exports = {
  isPrivateIp,
  isPrivateHostname,
  resolvePublicHost,
};
