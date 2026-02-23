const crypto = require('crypto');
const https = require('https');
const http = require('http');

function trimTrailingSlashes(str) {
  let end = str.length;
  while (end > 0 && str[end - 1] === '/') end--;
  return str.slice(0, end);
}

function validateHttpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP(S) URLs are supported');
  }
  return parsed;
}

class OidcService {
  constructor() {
    this._discoveryCache = new Map();
    this._stateStore = new Map();
  }

  async discover(issuerUrl) {
    const cached = this._discoveryCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.doc;
    }
    const url = trimTrailingSlashes(issuerUrl) + '/.well-known/openid-configuration';
    const doc = await this._httpGet(url);
    this._discoveryCache.set(issuerUrl, { doc, expiresAt: Date.now() + 3600000 });
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

  decodeIdToken(idToken) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid ID token format');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload;
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

  storeState(state, data) {
    this._stateStore.set(state, { ...data, createdAt: Date.now() });
    for (const [key, val] of this._stateStore) {
      if (Date.now() - val.createdAt > 600000) this._stateStore.delete(key);
    }
  }

  consumeState(state) {
    const data = this._stateStore.get(state);
    if (!data) return null;
    this._stateStore.delete(state);
    if (Date.now() - data.createdAt > 600000) return null;
    return data;
  }

  _httpGet(url) {
    const parsed = validateHttpUrl(url);
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
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });
  }

  _httpPost(url, body, headers) {
    const parsed = new URL(url);
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
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = { OidcService };
