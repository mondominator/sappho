# Sappho Feature Wishlist

This document contains prioritized feature ideas for Sappho development. Features are organized by priority and category.

## 🔥 High Priority - Next Release (v0.2.x)

### Essential Playback Features

**Sleep Timer** ⭐⭐⭐
- Auto-pause playback after X minutes
- Countdown display in player
- Quick presets: 15min, 30min, 45min, 1hr, end of chapter
- Fade out audio before stopping
- Notification when timer expires

**Playback Queue/Up Next** ⭐⭐⭐
- Queue multiple audiobooks to play sequentially
- Drag-to-reorder queue items
- "Play Next" and "Add to Queue" options
- Auto-play next book when current finishes
- Queue persistence across sessions

**Bookmarks with Notes** ⭐⭐
- Save specific timestamps with text notes
- List all bookmarks for an audiobook
- Jump directly to bookmarked position
- Export bookmarks
- Share bookmark timestamp with other users

### Discovery & Organization

**Advanced Filtering** ⭐⭐⭐
- Filter by genre (multi-select)
- Filter by narrator (multi-select)
- Filter by duration (ranges: <3hr, 3-6hr, 6-12hr, 12hr+)
- Filter by publication year
- Filter by rating (once ratings implemented)
- Combined filters (e.g., "Sci-Fi by narrator X under 10 hours")

**Smart Collections** ⭐⭐
- Create custom playlists/collections
- Auto-collections based on rules (e.g., "All Sci-Fi added this month")
- "Continue Series" collection showing next unread books in started series
- "Recommended" collection based on listening patterns
- Share collections with other users

**Recently Added View** ⭐⭐
- Dedicated page for newest audiobooks
- Sort by date added (newest first)
- Highlight new additions in last 7/30 days
- RSS feed for new additions

### User Experience

**Listening Statistics Dashboard** ⭐⭐⭐
- Total listening time (this week/month/year/all-time)
- Books completed count with charts
- Average listening speed
- Most listened authors/narrators/genres
- Listening streaks (consecutive days)
- Progress graphs and trends
- Personal "Year in Review" summary

**Improved Mobile Controls** ⭐⭐
- Volume control slider in player
- Configurable skip intervals (not just 15s)
- Lock screen media controls (MediaSession API)
- Background audio support (keep playing when screen off)
- Picture-in-Picture mode

**Batch Operations** ⭐
- Multi-select audiobooks in library
- Bulk mark as finished
- Bulk delete
- Bulk metadata edit
- Bulk add to collection

## 💎 Medium Priority (v0.3.x - v0.4.x)

### Content Management

**Metadata Editing** ⭐⭐⭐
- Edit title, author, narrator, series in UI
- Update cover art
- Edit chapter titles
- Write changes back to file tags (optional)
- Bulk metadata operations

**Advanced Library Management** ⭐⭐
- Merge duplicate entries
- Split/combine multi-file audiobooks
- Manual chapter marker creation
- Library cleanup tools (find orphaned files, missing covers, etc.)
- Export/import library database

**Import from External Sources** ⭐⭐
- Import from Audible library (via CSV or API)
- Import from Plex audiobook library
- Import from Booksonic library
- Goodreads integration (import ratings/reviews)

### Social & Discovery

**Ratings & Reviews** ⭐⭐
- 5-star rating system
- Written reviews
- Rating-based recommendations
- Filter/sort by rating
- Share ratings with family (same server)

**Smart Recommendations** ⭐⭐⭐
- "Because you listened to X" suggestions
- "Similar audiobooks" on detail pages
- "Complete this series" prompts
- Trending/popular in your library
- Machine learning based on listening patterns

**Reading/Listening Goals** ⭐
- Set yearly book goals
- Track progress toward goals
- Monthly challenges
- Badges and achievements
- Share progress with family members

### Technical Improvements

**Enhanced Audio Processing** ⭐⭐
- Volume normalization (ReplayGain)
- Configurable equalizer presets
- Voice boost (enhance narrator clarity)
- Background noise reduction
- Audio output device selection

**Podcast Support** ⭐⭐
- Add podcast RSS feeds
- Auto-download new episodes
- Episode management
- Separate podcast library view
- Podcast-specific features (mark episodes, auto-delete old)

**Performance Optimizations** ⭐⭐⭐
- Virtual scrolling for large libraries (10,000+ books)
- Lazy loading of cover images
- Database indexing improvements
- Faster metadata extraction
- Background sync for progress updates

### Mobile & Cross-Platform

**Native Mobile Apps** ⭐⭐⭐
- React Native iOS app
- React Native Android app
- App store distribution
- Offline download support
- Push notifications for new books

**Casting Support** ⭐⭐
- Chromecast integration
- Google Cast support
- AirPlay support (iOS)
- Control playback from mobile while casting

## 🎯 Lower Priority / Future Enhancements (v1.0+)

### AI & Automation

**AI-Powered Features** ⭐⭐
- Automatic chapter detection (for files without chapters)
- AI-generated summaries
- Smart genre tagging
- Voice-to-text for reviews
- Content warnings detection

**Smart File Organization** ⭐
- Auto-rename files based on metadata
- Auto-organize into folder structure
- Duplicate detection (same book, different files)
- Quality detection (suggest better quality versions)

### Advanced Integration

**Third-Party Integrations** ⭐⭐
- Goodreads API (ratings, reviews, recommendations)
- Audible integration (purchase links, sample previews)
- OpenLibrary metadata enrichment
- Last.fm style "scrobbling" for audiobooks
- IFTTT/Zapier webhooks

**Plugin System** ⭐
- Plugin architecture for extensibility
- Community plugins marketplace
- Custom metadata providers
- Custom import/export formats
- Theme plugins

### Collaboration & Sharing

**Social Features** ⭐
- Friend system (within server)
- Share reading lists
- Book club features (group discussions)
- Shared listening sessions (listen together)
- Gift recommendations

**Multi-Server Features** ⭐
- Federated servers (share libraries across instances)
- Remote library access
- Sync progress across multiple servers
- Distributed storage

### Accessibility & Customization

**Accessibility Improvements** ⭐⭐
- Screen reader optimization
- High contrast themes
- Font size customization
- Keyboard shortcuts (configurable)
- Voice control integration

**Themes & Customization** ⭐
- Multiple color themes (light, dark, custom)
- Accent color customization
- Layout preferences
- Custom CSS support
- Per-user theme settings

### Admin & Enterprise

**Advanced Admin Tools** ⭐
- User management dashboard
- Storage usage analytics
- Listening activity logs
- Automated backups
- Database optimization tools
- System health monitoring

**Enterprise Features** ⭐
- LDAP/Active Directory authentication
- Single Sign-On (SSO) support
- Role-based access control (admin, user, guest)
- Audit logging
- Multi-tenancy support

## 🔧 Quality of Life Improvements

### Small but Useful

**Quick Wins** ⭐⭐⭐
- Remember playback speed per audiobook
- Resume from last device (sync last-played device)
- "Mark as unplayed" option
- Configurable card view (grid size, info displayed)
- Export library to CSV/JSON
- Keyboard shortcuts cheat sheet
- Dark/light mode toggle
- Recently played history
- "Up next in series" indicator on cards
- Estimated time remaining (at current speed)

**Nice to Have** ⭐⭐
- Library backup/restore from UI
- Change username without losing data
- Two-factor authentication (2FA)
- Email notifications (new books added, etc.)
- Custom audiobook categories/tags
- Favorite/starred books
- Hide books from library
- Reading challenges/lists
- Import from CSV
- Export as M3U playlist

## 📊 Priority Legend

- ⭐⭐⭐ - Critical feature, high user value
- ⭐⭐ - Important feature, good user value
- ⭐ - Nice to have, moderate user value

## 🎬 Feature Categories Summary

**Immediate Value (Ship in v0.2.x)**
1. Sleep Timer
2. Playback Queue
3. Advanced Filtering
4. Listening Statistics Dashboard
5. Bookmarks

**High Impact (Target v0.3.x)**
1. Smart Recommendations
2. Metadata Editing
3. Native Mobile Apps
4. Ratings & Reviews
5. Performance Optimizations

**Long-term Vision (v1.0+)**
1. AI Features
2. Plugin System
3. Social Features
4. Podcast Support
5. Enterprise Features

---

**How to Use This Document:**
- Review and adjust priorities based on user feedback
- Move features between priority levels as needed
- Add new ideas as they come up
- Check off completed features
- Use as roadmap for development sprints

**Last Updated**: 2024-11-18
