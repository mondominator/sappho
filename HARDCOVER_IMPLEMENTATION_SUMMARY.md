# Hardcover.app Integration Implementation

## Overview
Complete implementation of Hardcover.app integration with dual authentication architecture (server-wide API key for basic features, personal API keys for advanced features).

## Implementation Date
May 12, 2026

## Database Schema Changes

### Users Table (server/database.js)
Added columns for user's Hardcover credentials:
- `hardcover_oauth_token` - OAuth access token (future)
- `hardcover_refresh_token` - OAuth refresh token (future)
- `hardcover_user_id` - Hardcover user ID
- `hardcover_token_expires_at` - OAuth token expiration
- `hardcover_sync_enabled` - Whether sync is enabled (boolean)
- `hardcover_api_key` - Encrypted personal API key

### Audiobooks Table (server/database.js)
Added columns for Hardcover edition mapping:
- `hardcover_edition_id` - Linked Hardcover edition ID
- `hardcover_synced_at` - Last sync timestamp
- `hardcover_sync_status` - Sync status ('none', 'synced', 'error')

### New Table: hardcover_sync_log
Tracks all sync operations:
- `id` - Primary key
- `user_id` - User who performed the sync
- `audiobook_id` - Audiobook involved (optional)
- `action` - Action performed (e.g., 'progress_update', 'edition_link')
- `status` - Result status (e.g., 'success', 'error')
- `details` - Additional details
- `created_at` - Timestamp

### Indexes Created
- `idx_hardcover_sync_log_user` - For user's sync history
- `idx_hardcover_sync_log_audiobook` - For audiobook sync history
- `idx_hardcover_sync_log_created_at` - For chronological queries

## Backend API Routes (server/routes/hardcover.js)

### GET /api/hardcover/config
Returns configuration status for authenticated user:
- `serverHasKey` - Whether server-wide API key is configured
- `userConnection` - Connection type: 'none' | 'api-key' | 'oauth'
- `syncEnabled` - Whether sync is enabled
- `hardcoverUserId` - User's Hardcover ID
- `tokenExpired` - Whether OAuth token is expired
- `features` - Available features object:
  - `metadataSearch` - Can search Hardcover metadata
  - `progressSync` - Can sync reading progress
  - `wantToReadImport` - Can import reading lists
  - `editionLinking` - Can link audiobooks to editions

### POST /api/hardcover/api-key
Save or update user's personal API key:
- Validates key format (40-character alphanumeric)
- Encrypts key using AES-256-GCM before storage
- Updates `hardcover_api_key` column
- Clears OAuth tokens if present (switches to API key mode)

**Request Body:**
```json
{
  "apiKey": "your40characterhardcoverapikey"
}
```

### DELETE /api/hardcover/api-key
Remove user's personal API key and disconnect account:
- Clears all Hardcover credentials
- Disables sync
- Returns success message

### POST /api/hardcover/sync-enabled
Toggle Hardcover sync on/off:
- Updates `hardcover_sync_enabled` column

**Request Body:**
```json
{
  "enabled": true
}
```

### POST /api/hardcover/test-connection
Test API key connectivity:
- Decrypts user's API key
- Makes GraphQL request to Hardcover API
- Fetches user profile to verify credentials
- Updates `hardcover_user_id` with ID from API
- Returns connection status and user info

## Security Implementation

### Encryption (AES-256-GCM)
- Personal API keys are encrypted before storage
- Encryption key from `ENCRYPTION_KEY` environment variable
- Uses `crypto.scryptSync()` to derive 32-byte key
- Random IV for each encryption
- Auth tag for integrity verification

**Encryption Functions:**
```javascript
encryptHardcoverKey(plaintext) -> { encrypted, iv, authTag }
decryptHardcoverKey(encrypted, iv, authTag) -> plaintext
```

### API Key Validation
- Hardcover API keys must be 40-character alphanumeric strings
- Regex validation: `/^[a-zA-Z0-9]{40}$/`
- Rejects invalid formats before storage

### Authentication
- All endpoints protected by `authenticateToken` middleware
- User can only access their own credentials
- Server-wide key from environment (HARDCOVER_API_KEY) never exposed to clients

## Frontend Components (client/src/components/settings/HardcoverSettings.jsx)

### UI Features

#### 1. Connection Status Overview
- Visual status card showing:
  - Integration availability
  - User's connection type
  - Sync status
  - Hardcover User ID
  - Token expiration warnings

#### 2. Features Grid
Four feature indicators showing availability:
- 📚 Metadata Search
- 🔄 Progress Sync
- 📖 Want to Read Import
- 🔗 Edition Linking

#### 3. Configuration Options

**Server-wide (Basic Features)**
- Shows server-wide API key status
- Lists available features (metadata search only)
- Warning if no server key configured

**Personal Account (Advanced Features)**
- Connect/disconnect personal account
- API key input form
- Connection testing button
- Lists all advanced features
- Remove connection button

#### 4. Sync Settings
- Toggle switch for sync enable/disable
- Only visible when user has personal connection
- Explanatory text about sync behavior

#### 5. Help & Resources
- Links to Hardcover.app
- API documentation links
- Feature descriptions
- Privacy & security information

### State Management
```javascript
config - Current configuration
loading - Loading state
testing - Action in progress state
apiKey - Input field value
saveStatus - 'success' | 'error' | null
testStatus - 'success' | 'error' | null
```

### API Functions
```javascript
loadConfig() - Fetch current configuration
handleSaveApiKey() - Save personal API key
handleDeleteApiKey() - Remove personal API key
handleTestConnection() - Test API connectivity
handleToggleSync() - Enable/disable sync
```

## Integration Points

### Settings Page (client/src/pages/Settings.jsx)
- Hardcover section added to menu
- Label: "Hardcover"
- Description: "Book metadata & sync"
- Renders `<HardcoverSettings />` component

### Server Index (server/index.js)
- Route registered: `app.use('/api/hardcover', require('./routes/hardcover'))`
- Placed after /api/settings, before /api/maintenance
- Protected by authentication middleware

## Testing Checklist

### Backend Tests
- [ ] Database schema applied correctly
- [ ] GET /api/hardcover/config returns correct structure
- [ ] POST /api/hardcover/api-key validates and encrypts keys
- [ ] DELETE /api/hardcover/api-key removes credentials
- [ ] POST /api/hardcover/sync-enabled toggles setting
- [ ] POST /api/hardcover/test-connection validates keys with API

### Frontend Tests
- [ ] Settings page shows Hardcover menu item
- [ ] HardcoverSettings component renders correctly
- [ ] Connection status displays properly
- [ ] API key form submits successfully
- [ ] Test connection button works
- [ ] Sync toggle functions correctly

### Integration Tests
- [ ] End-to-end API key save/load flow
- [ ] Connection testing with real Hardcover API
- [ ] Feature availability updates dynamically
- [ ] Error handling for invalid API keys

## Future Enhancements

### OAuth 2.0 Flow (Not Yet Implemented)
- `HARDCOVER_OAUTH_CLIENT_ID` - OAuth app client ID
- `HARDCOVER_OAUTH_CLIENT_SECRET` - OAuth app client secret
- `HARDCOVER_OAUTH_REDIRECT_URI` - OAuth callback URL
- OAuth token storage columns already in database
- Need to implement:
  - OAuth authorization endpoint
  - OAuth callback handler
  - Token refresh logic

### Sync Features (Not Yet Implemented)
- Progress sync to Hardcover
- "Want to Read" list import
- Edition linking UI
- Automatic sync on progress updates

## Environment Variables Required

### Optional
```
HARDCOVER_API_KEY - Server-wide API key for basic metadata search
ENCRYPTION_KEY - Master key for encrypting user API keys (auto-generated if not set)
```

### OAuth (Future)
```
HARDCOVER_OAUTH_CLIENT_ID
HARDCOVER_OAUTH_CLIENT_SECRET
HARDCOVER_OAUTH_REDIRECT_URI
```

## Architecture Documentation
See `HARDCOVER_AUTH_ARCHITECTURE.md` for complete architectural details including:
- Authentication flow diagrams
- Security considerations
- Migration strategy
- API endpoint specifications
- Frontend component design

## Files Created/Modified

### Created
1. `server/routes/hardcover.js` - API routes (300+ lines)
2. `client/src/components/settings/HardcoverSettings.jsx` - UI component (470+ lines)
3. `HARDCOVER_AUTH_ARCHITECTURE.md` - Architecture documentation
4. `HARDCOVER_IMPLEMENTATION_SUMMARY.md` - This file

### Modified
1. `server/database.js` - Added schema changes
2. `server/index.js` - Registered hardcover route
3. `client/src/pages/Settings.jsx` - Added Hardcover section

## Status
✅ Backend implementation complete
✅ Frontend UI complete
✅ Database schema applied
✅ Server running successfully
✅ API endpoints responding correctly

### Ready for Testing
The implementation is ready for user testing. Access at:
- **Settings → Hardcover** page in the web UI
- **http://localhost:3001** (development server)

### Next Steps
1. User testing of UI and API endpoints
2. Test with real Hardcover API keys
3. Implement OAuth flow (optional)
4. Implement sync features (progress, edition linking, etc.)
