const crypto = require('crypto');
const logger = require('../utils/logger');
const https = require('https');
const http = require('http');
const { isPrivateIp, resolvePublicHost } = require('../utils/networkSecurity');

// Constants for hardening the OIDC service against abuse
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const STATE_MAX_ENTRIES = 10000; // cap in-memory state map to prevent DoS
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const HTTP_TIMEOUT_MS = 10000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function trimTrailingSlashes(str) {
  let end = str.length;
  while (end > 0 && str[end - 1] === '/') end--;
  return str.slice(0, end);
}

/**
 * Reject non-HTTP(S) URLs early. Returns the parsed URL.
 */
function validateHttpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP(S) URLs are supported');
  }
  return parsed;
}

class OidcService {
  constructor(opts = {}) {
    this._discoveryCache = new Map();
    this._stateStore = new Map();
    this._jwksCache = new Map();
    // Allow tests and explicit opt-in to bypass the public-IP check
    this._allowPrivateIssuer =
      opts.allowPrivateIssuer ?? process.env.OIDC_ALLOW_PRIVATE_ISSUER === '1';
  }

  async discover(issuerUrl) {
    const cached = this._discoveryCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.doc;
    }
    const url = trimTrailingSlashes(issuerUrl) + '/.well-known/openid-configuration';
    const doc = await this._httpGet(url);
    this._discoveryCache.set(issuerUrl, { doc, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
    return doc;
  }

  buildAuthorizationUrl(authorizationEndpoint, { clientId, redirectUri, state, nonce, scope }) {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: scope || 'openid profile email',
      redirect_uri: redirectUri,
      state,
      nonce,
    });
    return `${authorizationEndpoint}?${params.toString()}`;
  }

  async exchangeCode(tokenEndpoint, { code, clientId, clientSecret, redirectUri }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString();
    return this._httpPost(tokenEndpoint, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  }

  /**
   * Decode the JWT payload without verifying the signature. Only use this for
   * inspecting claims after a separate signature verification step has
   * succeeded, or for tests. Production code paths should call verifyIdToken.
   */
  decodeIdToken(idToken) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid ID token format');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload;
  }

  /**
   * Verify an ID token's signature against the provider's JWKS and validate
   * its claims (iss/aud/exp/nonce). Returns the verified claims on success.
   *
   * Uses `jose` for crypto; falls back to the old decode-only behavior if the
   * provider's discovery document lacks a jwks_uri (non-compliant providers).
   */
  async verifyIdToken(idToken, { issuer, clientId, nonce, discovery }) {
    if (!discovery || !discovery.jwks_uri) {
      // Provider is non-compliant; fall back to decode-only + claim checks,
      // logged so operators can see why no crypto check happened.
      logger.warn('OIDC: provider discovery missing jwks_uri; verifying claims only');
      const claims = this.decodeIdToken(idToken);
      this.validateIdTokenClaims(claims, { issuer, clientId, nonce });
      return claims;
    }

    // Lazy-load jose (ESM) so CJS require() stays happy
    const jose = await import('jose');

    // Cache the remote JWKS getter per jwks_uri so we don't refetch on every login
    let cached = this._jwksCache.get(discovery.jwks_uri);
    if (!cached || cached.expiresAt < Date.now()) {
      // Validate the jwks_uri against SSRF rules before handing it to jose
      const jwksParsed = validateHttpUrl(discovery.jwks_uri);
      await resolvePublicHost(jwksParsed.hostname, {
        allowPrivate: this._allowPrivateIssuer,
      });
      const getKey = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));
      cached = { getKey, expiresAt: Date.now() + JWKS_CACHE_TTL_MS };
      this._jwksCache.set(discovery.jwks_uri, cached);
    }

    let verified;
    try {
      verified = await jose.jwtVerify(idToken, cached.getKey, {
        issuer,
        audience: clientId,
      });
    } catch (err) {
      throw new Error(`ID token signature verification failed: ${err.message}`);
    }

    const claims = verified.payload;
    if (claims.nonce && nonce && claims.nonce !== nonce) {
      throw new Error('Nonce mismatch');
    }
    return claims;
  }

  validateIdTokenClaims(claims, { issuer, clientId, nonce }) {
    if (claims.iss !== issuer) throw new Error(`Invalid issuer: ${claims.iss}`);
    if (claims.aud !== clientId && !(Array.isArray(claims.aud) && claims.aud.includes(clientId))) {
      throw new Error(`Invalid audience: ${claims.aud}`);
    }
    if (claims.nonce && nonce && claims.nonce !== nonce) {
      throw new Error('Nonce mismatch');
    }
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('ID token expired');
    }
  }

  extractUserInfo(claims) {
    return {
      sub: claims.sub,
      username: claims.preferred_username || claims.email || claims.sub,
      email: claims.email || null,
      name: claims.name || claims.preferred_username || null,
      groups: claims.groups || [],
    };
  }

  generateState() { return crypto.randomBytes(32).toString('hex'); }
  generateNonce() { return crypto.randomBytes(32).toString('hex'); }

  /**
   * Store authorization-flow state keyed by the random `state` param.
   *
   * - Evicts expired entries opportunistically (O(n) sweep, bounded by size cap).
   * - Enforces a hard max size to block memory DoS from unbounded state injection.
   */
  storeState(state, data) {
    const now = Date.now();

    // First drop anything that's already expired
    for (const [key, val] of this._stateStore) {
      if (now - val.createdAt > STATE_MAX_AGE_MS) {
        this._stateStore.delete(key);
      }
    }

    // If still over cap after the sweep, drop the oldest entry (Map preserves
    // insertion order, so the first key is the oldest)
    while (this._stateStore.size >= STATE_MAX_ENTRIES) {
      const firstKey = this._stateStore.keys().next().value;
      if (firstKey === undefined) break;
      this._stateStore.delete(firstKey);
    }

    this._stateStore.set(state, { ...data, createdAt: now });
  }

  consumeState(state) {
    const data = this._stateStore.get(state);
    if (!data) return null;
    this._stateStore.delete(state);
    if (Date.now() - data.createdAt > STATE_MAX_AGE_MS) return null;
    return data;
  }

  async _httpGet(url) {
    const parsed = validateHttpUrl(url);
    await resolvePublicHost(parsed.hostname, {
      allowPrivate: this._allowPrivateIssuer,
    });
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
      }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (_e) { reject(new Error('Invalid JSON response')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(HTTP_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });
  }

  async _httpPost(url, body, headers) {
    const parsed = validateHttpUrl(url);
    await resolvePublicHost(parsed.hostname, {
      allowPrivate: this._allowPrivateIssuer,
    });
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (_e) { reject(new Error('Invalid JSON response from token endpoint')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(HTTP_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = {
  OidcService,
  // Exported for tests
  _isPrivateIp: isPrivateIp,
  _resolvePublicHost: resolvePublicHost,
};
