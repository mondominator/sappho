# Hardcover.app Authentication Architecture

## Overview

This document describes the dual authentication system for integrating with Hardcover.app, supporting both server-wide metadata search and per-user personalized features.

## Authentication Methods

### 1. Server-Wide API Key (Basic Features)
**Purpose:** Public metadata search available to all users
**Authentication:** Single API key stored in environment variable
**Use Cases:**
- Metadata search (title, author, ISBN lookup)
- Book information retrieval
- No personal data access

**Configuration:**
```env
HARDCOVER_API_KEY=your_server_api_key_here
```

**Security Considerations:**
- ✅ Read-only public data access
- ✅ No personal user information exposed
- ⚠️ Rate limited to 60 req/minute
- ⚠️ Tokens expire annually (reset Jan 1st)

### 2. Per-User OAuth Tokens (Advanced Features)
**Purpose:** Personalized features with user's own Hardcover account
**Authentication:** OAuth 2.0 flow (recommended by Hardcover as of April 2026)
**Use Cases:**
- Sync reading progress to/from Hardcover
- Import "want to read" list
- Link Sappho audiobooks to Hardcover editions
- Sync reviews and ratings
- Access user's private data

**OAuth Flow:**
1. User initiates OAuth from Sappho settings page
2. Redirect to Hardcover.app authorization URL
3. User grants permissions
4. Hardcover redirects back with authorization code
5. Sappho exchanges code for access token
6. Store encrypted token in database

**Security Considerations:**
- ✅ Each user has their own token
- ✅ Revocable by user
- ✅ Limited scope permissions
- ✅ Encrypted storage in database
- ✅ Tokens can be invalidated

## Architecture Components

### Database Schema

```sql
-- User OAuth tokens (encrypted)
ALTER TABLE users ADD COLUMN hardcover_oauth_token TEXT;
ALTER TABLE users ADD COLUMN hardcover_refresh_token TEXT;
ALTER TABLE users ADD COLUMN hardcover_user_id TEXT;
ALTER TABLE users ADD COLUMN hardcover_token_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN hardcover_sync_enabled INTEGER DEFAULT 0;

-- Alternative: API key storage (if user prefers over OAuth)
ALTER TABLE users ADD COLUMN hardcover_api_key TEXT;

-- Audiobook to Hardcover edition mapping
ALTER TABLE audiobooks ADD COLUMN hardcover_edition_id TEXT;
ALTER TABLE audiobooks ADD COLUMN hardcover_synced_at TIMESTAMP;
ALTER TABLE audiobooks ADD COLUMN hardcover_sync_status TEXT DEFAULT 'none'; -- 'none', 'linked', 'synced', 'failed'

-- Sync log
CREATE TABLE hardcover_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  audiobook_id INTEGER,
  sync_type TEXT NOT NULL, -- 'progress_to_hardcover', 'progress_from_hardcover', 'link_edition', 'import_want_to_read'
  sync_direction TEXT NOT NULL, -- 'to_hardcover', 'from_hardcover', 'bidirectional'
  status TEXT NOT NULL, -- 'success', 'failed', 'pending'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id)
);

CREATE INDEX idx_hardcover_sync_user ON hardcover_sync_log(user_id);
CREATE INDEX idx_hardcover_sync_audiobook ON hardcover_sync_log(audiobook_id);
```

### API Endpoints

#### Authentication Management
```javascript
// OAuth flow
GET  /api/hardcover/oauth/authorize          // Start OAuth flow
GET  /api/hardcover/oauth/callback           // OAuth callback
POST /api/hardcover/oauth/token              // Exchange code for token
DELETE /api/hardcover/oauth/token            // Revoke token

// API key management (alternative to OAuth)
POST /api/profile/hardcover-api-key          // Save API key
GET  /api/profile/hardcover-api-key          // Check if key exists
DELETE /api/profile/hardcover-api-key        // Delete API key
```

#### Sync Features
```javascript
POST /api/hardcover/link-edition             // Link audiobook to edition
GET  /api/hardcover/edition/:isbn            // Get edition info by ISBN
POST /api/hardcover/sync-progress            // Sync progress to Hardcover
GET  /api/hardcover/sync-status/:audiobookId // Get sync status
POST /api/hardcover/import/want-to-read      // Import reading list
GET  /api/hardcover/want-to-read             // Get imported list
```

### Service Layer

```javascript
// server/services/hardcoverAuth.js
class HardcoverAuthService {
  // Generate OAuth authorization URL
  getAuthorizationUrl(state, redirectUri)

  // Exchange authorization code for access token
  exchangeCodeForToken(code, redirectUri)

  // Refresh access token
  refreshAccessToken(refreshToken)

  // Revoke access token
  revokeAccessToken(accessToken)

  // Store encrypted token in database
  saveUserToken(userId, tokenData)

  // Get user's token (decrypt if needed)
  getUserToken(userId)
}

// server/services/hardcoverSync.js
class HardcoverSyncService {
  // Sync reading progress to Hardcover
  syncProgressToHardcover(userId, audiobookId, progress)

  // Import reading status from Hardcover
  importProgressFromHardcover(userId)

  // Link audiobook to Hardcover edition
  linkAudiobookToEdition(audiobookId, editionId)

  // Import "want to read" list
  importWantToReadList(userId)

  // Background sync job
  runScheduledSync()
}

// server/services/hardcoverSearch.js (enhanced)
class HardcoverSearchService {
  // Search using server-wide API key (public metadata)
  searchPublicMetadata(title, author)

  // Search using user's OAuth token (personalized results)
  searchUserMetadata(title, author, userId)

  // Get user's reading status
  getUserReadingStatus(userId, isbn)
}
```

## Authentication Flow Decision Tree

```
User Action → Determine Required Access
             │
             ├─ Public metadata search?
             │   └─ Use server-wide HARDCOVER_API_KEY
             │
             ├─ Personal data access?
             │   └─ Require user OAuth token or API key
             │
             └─ Sync reading progress?
                 └─ Require user OAuth token (write access)
```

## Security Implementation

### Token Encryption
```javascript
const crypto = require('crypto');

function encryptToken(token) {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decryptToken(encryptedData, iv, authTag) {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

### API Key Validation
```javascript
function validateHardcoverToken(token, context) {
  // Server-wide key: used for public metadata only
  if (context === 'server-wide') {
    return {
      valid: true,
      scope: ['metadata:read'],
      rateLimit: 60 // per minute
    };
  }

  // User OAuth token: broader permissions
  if (context === 'user-oauth') {
    return {
      valid: true,
      scope: [
        'metadata:read',
        'readingstatus:read',
        'readingstatus:write',
        'lists:read',
        'reviews:read'
      ],
      rateLimit: 60 // per minute per user
    };
  }

  return { valid: false };
}
```

## OAuth Configuration

### Environment Variables
```env
# Hardcover OAuth (recommended)
HARDCOVER_OAUTH_CLIENT_ID=your_client_id
HARDCOVER_OAUTH_CLIENT_SECRET=your_client_secret
HARDCOVER_OAUTH_REDIRECT_URI=http://localhost:3003/api/hardcover/oauth/callback
HARDCOVER_OAUTH_SCOPES=read,write

# Fallback: Server-wide API key (metadata only)
HARDCOVER_API_KEY=your_server_api_key

# Token encryption
ENCRYPTION_KEY=generate_with_openssl_rand_32_bytes
```

### OAuth Callback URL
For local development: `http://localhost:3003/api/hardcover/oauth/callback`
For production: `https://your-domain.com/api/hardcover/oauth/callback`

## Migration Strategy

### Phase 1: Server-Wide API Key ✅ (Already Done)
- Public metadata search implemented
- Environment variable `HARDCOVER_API_KEY`
- Used by all users for basic metadata lookup

### Phase 2: Database Schema (Current)
- Add OAuth token storage columns
- Create sync log table
- Add edition mapping to audiobooks

### Phase 3: OAuth Implementation
- Implement OAuth flow
- Create settings UI for OAuth connection
- Add token management endpoints

### Phase 4: Sync Features
- Link audiobooks to editions
- Sync reading progress
- Import "want to read" list

### Phase 5: Advanced Features
- Two-way sync
- Conflict resolution
- Reviews/ratings sync

## User Experience

### Settings Page Structure

```
Settings → Hardcover Integration

┌─────────────────────────────────────────┐
│ Hardcover Integration                   │
├─────────────────────────────────────────┤
│                                         │
│ ○ Server-wide (Basic)                   │
│   Using shared API key for metadata     │
│   ✅ Metadata search                    │
│   ❌ Reading sync                       │
│   ❌ Personal lists                     │
│                                         │
│ ○ Personal Account (Advanced)           │
│   Connect your Hardcover account        │
│   ✅ All basic features                 │
│   ✅ Sync reading progress              │
│   ✅ Import "want to read" list         │
│   ✅ Link audiobooks to editions        │
│                                         │
│   [Connect with Hardcover]              │
│                                         │
│ Current Status: Not connected           │
│ Last sync: Never                        │
│                                         │
└─────────────────────────────────────────┘
```

## Rate Limiting Strategy

### Server-Wide API Key
- **Limit:** 60 requests/minute
- **Shared by:** All users
- **Strategy:** Queue requests, implement backoff
- **Fallback:** Cache results to reduce API calls

### Per-User OAuth Tokens
- **Limit:** 60 requests/minute per user
- **Isolated:** Each user has own quota
- **Strategy:** Background sync with batching
- **Priority:** Manual sync > Background sync

## Error Handling

```javascript
const HardcoverErrors = {
  TOKEN_EXPIRED: {
    code: 'TOKEN_EXPIRED',
    message: 'Hardcover token expired',
    action: 'refresh_token'
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Rate limit exceeded',
    action: 'retry_with_backoff'
  },
  INVALID_TOKEN: {
    code: 'INVALID_TOKEN',
    message: 'Invalid or revoked token',
    action: 'reauthenticate'
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    message: 'Failed to connect to Hardcover API',
    action: 'retry_later'
  }
};
```

## Monitoring and Logging

```javascript
// Track sync success rate
hardcover_sync_success_rate = success_count / total_sync_count

// Monitor token expiry
hardcover_tokens_expiring_soon = COUNT(*) FROM users
WHERE hardcover_token_expires_at < NOW() + INTERVAL 7 DAY

// API usage metrics
hardcover_api_calls_per_minute = COUNT(*) FROM hardcover_sync_log
WHERE created_at > NOW() - INTERVAL 1 MINUTE
```

## References

- [Hardcover API Documentation](https://docs.hardcover.app/api/getting-started/)
- [Hardcover OAuth Guide](https://hardcover.app/blog/hardcover-report-for-april-2026)
- [Emma Goto's Hardcover API Guide](https://www.emgoto.com/hardcover-book-api/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
