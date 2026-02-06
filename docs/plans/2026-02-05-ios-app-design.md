# Sappho iOS App Design

Native Swift/SwiftUI iOS app for Sappho audiobook server, with feature parity to the existing Android app.

## Overview

| Attribute | Value |
|-----------|-------|
| Repository | `../sapphoios` (sibling to sappho, like sapphoapp) |
| Bundle ID | `com.sappho.audiobooks` |
| App Name | Sappho |
| Min iOS | 17.0 |
| Architecture | MVVM + Clean Architecture (matching Android) |

## Project Structure

```
sapphoios/
├── Sappho/
│   ├── App/
│   │   ├── SapphoApp.swift          # App entry point
│   │   └── AppDelegate.swift        # Background audio, Cast setup
│   │
│   ├── Data/
│   │   ├── Remote/
│   │   │   ├── SapphoAPI.swift      # API client (URLSession)
│   │   │   └── Models/              # API response models (Codable)
│   │   └── Repository/
│   │       ├── AuthRepository.swift  # Keychain token/URL storage
│   │       └── AudiobookRepository.swift
│   │
│   ├── Domain/
│   │   └── Model/                   # Domain models
│   │
│   ├── Presentation/
│   │   ├── Login/
│   │   ├── Home/
│   │   ├── Library/
│   │   ├── Detail/
│   │   ├── Player/
│   │   ├── Search/
│   │   ├── Profile/
│   │   ├── Settings/
│   │   └── Components/              # Shared UI components
│   │
│   ├── Service/
│   │   ├── AudioPlayerService.swift # AVFoundation playback
│   │   ├── DownloadManager.swift    # Offline downloads
│   │   └── SyncService.swift        # Progress sync
│   │
│   ├── Cast/
│   │   └── CastManager.swift        # Google Cast integration
│   │
│   └── Resources/
│       ├── Assets.xcassets
│       └── Info.plist
│
├── SapphoTests/
├── SapphoUITests/
└── Sappho.xcodeproj
```

## Technology Mapping (Android → iOS)

| Android | iOS |
|---------|-----|
| Kotlin + Jetpack Compose | Swift + SwiftUI |
| Hilt (DI) | Native Swift (@Observable, no framework needed) |
| Retrofit + OkHttp | URLSession + async/await |
| Media3/ExoPlayer | AVFoundation + AVPlayer |
| Coil | AsyncImage with authenticated URLSession |
| EncryptedSharedPreferences | Keychain |
| MediaSessionService | MPNowPlayingInfoCenter + MPRemoteCommandCenter |
| Android Auto | CarPlay (skipped for now) |
| Chromecast | Google Cast SDK + AirPlay |
| Room/SQLite | SwiftData or UserDefaults (for downloads tracking) |

## Networking & Authentication

### Dynamic Server URL

Matches Android pattern - server URL configured at login, stored in Keychain:

```swift
@Observable
class AuthRepository {
    private let keychain = KeychainService()

    var serverURL: URL? { keychain.get("serverURL").flatMap(URL.init) }
    var token: String? { keychain.get("authToken") }
    var isAuthenticated: Bool { token != nil }

    func store(serverURL: URL, token: String) { ... }
    func clear() { ... }
}
```

### API Client

All 80+ endpoints matching Android's `SapphoApi.kt`:

**Endpoint Groups:**
- Auth: login, register
- Library: audiobooks, recent, in-progress, finished, up-next, genres
- Playback: progress GET/POST/DELETE, chapters, stream
- Collections: CRUD, add/remove/reorder items
- Favorites: toggle, list
- Ratings: get/set/delete, average
- Profile: get/update, avatar, password, stats
- AI Recaps: series recap, audiobook recap ("Catch Me Up")
- Admin: users, settings, library scan, backups, maintenance, jobs, logs

**Snake Case Handling:**

```swift
struct Audiobook: Codable {
    let id: Int
    let title: String
    let author: String?
    let coverImage: String?
    let seriesPosition: Float?

    enum CodingKeys: String, CodingKey {
        case id, title, author
        case coverImage = "cover_image"
        case seriesPosition = "series_position"
    }
}
```

## Audio Playback Service

### Core Player

```swift
@Observable
class AudioPlayerService {
    // State
    var currentAudiobook: Audiobook?
    var currentChapter: Chapter?
    var isPlaying: Bool = false
    var position: TimeInterval = 0
    var duration: TimeInterval = 0
    var playbackSpeed: Float = 1.0
    var isBuffering: Bool = false

    // AVFoundation
    private var player: AVPlayer?
    private var timeObserver: Any?

    // Controls
    func play(audiobook: Audiobook, startPosition: TimeInterval?) async
    func pause()
    func seek(to position: TimeInterval)
    func skipForward(seconds: TimeInterval = 30)
    func skipBackward(seconds: TimeInterval = 15)
    func setPlaybackSpeed(_ speed: Float)
    func jumpToChapter(_ chapter: Chapter)

    // Sleep timer
    var sleepTimerRemaining: TimeInterval?
    func setSleepTimer(minutes: Int)
    func cancelSleepTimer()
}
```

### Background Audio

```swift
func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .spokenAudio)
    try session.setActive(true)
}
```

### Lock Screen / Now Playing

```swift
func updateNowPlayingInfo() {
    var info = [String: Any]()
    info[MPMediaItemPropertyTitle] = currentAudiobook?.title
    info[MPMediaItemPropertyArtist] = currentAudiobook?.author
    info[MPMediaItemPropertyPlaybackDuration] = duration
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
    info[MPMediaItemPropertyArtwork] = coverArtwork
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
}

func setupRemoteCommands() {
    let commandCenter = MPRemoteCommandCenter.shared()
    commandCenter.playCommand.addTarget { ... }
    commandCenter.pauseCommand.addTarget { ... }
    commandCenter.skipForwardCommand.addTarget { ... }
    commandCenter.skipBackwardCommand.addTarget { ... }
    commandCenter.changePlaybackPositionCommand.addTarget { ... }
}
```

### Progress Sync

Matches Android's 20-second threshold for server sync.

## Casting

### AirPlay

Built-in with AVPlayer:

```swift
player.allowsExternalPlayback = true
// AVRoutePickerView() for device selection UI
```

### Google Cast (Chromecast)

```swift
@Observable
class CastManager: NSObject {
    var isCastAvailable: Bool = false
    var isCasting: Bool = false
    var castDeviceName: String?

    func configure() {
        let options = GCKCastOptions(discoveryCriteria:
            GCKDiscoveryCriteria(applicationID: kGCKDefaultMediaReceiverApplicationID))
        GCKCastContext.setSharedInstanceWith(options)
    }

    func castAudiobook(_ audiobook: Audiobook, position: TimeInterval) { ... }
    func play() { ... }
    func pause() { ... }
    func seek(to position: TimeInterval) { ... }
}
```

## Offline Downloads

```swift
@Observable
class DownloadManager {
    var downloads: [Int: DownloadState] = [:]

    enum DownloadState {
        case notDownloaded
        case downloading(progress: Double)
        case downloaded(localURL: URL)
        case failed(Error)
    }

    // Background URLSession for downloads that continue when app backgrounded
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(
            withIdentifier: "com.sappho.audiobooks.download")
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func download(audiobook: Audiobook) async
    func cancelDownload(audiobookId: Int)
    func removeDownload(audiobookId: Int)
    func localURL(for audiobookId: Int) -> URL?
}
```

Storage: `~/Library/Application Support/com.sappho.audiobooks/Downloads/`

## UI & Navigation

### Tab Structure

```swift
TabView {
    HomeView()        // Continue Listening, Recently Added, Listen Again, Up Next
    LibraryView()     // All, Series, Authors, Genres, Collections
    SearchView()      // Search with filters
    ProfileView()     // Avatar, stats, settings
}
.overlay(alignment: .bottom) {
    MiniPlayerView()  // Persistent mini player
}
```

### Screens

| Screen | Description |
|--------|-------------|
| LoginView | Server URL + credentials |
| HomeView | Continue Listening, Recently Added, Listen Again, Up Next |
| LibraryView | Browse by All, Series, Authors, Genres + Collections |
| AudiobookDetailView | Cover, metadata, chapters, play button, ratings |
| PlayerView | Full-screen player with controls |
| SearchView | Search with filters |
| ProfileView | Avatar, stats, settings |
| SettingsView | Admin panel (if admin user) |
| CollectionView | Collection detail with books |
| SeriesRecapView | "Catch Me Up" AI recap |

### Theme

Matching Android/web dark theme:

```swift
extension Color {
    static let sapphoBackground = Color(hex: "0A0E1A")
    static let sapphoSurface = Color(hex: "1a1a1a")
    static let sapphoPrimary = Color(hex: "3B82F6")
    static let sapphoTextHigh = Color(hex: "E0E7F1")
    static let sapphoTextMuted = Color(hex: "9ca3af")
}
```

## Info.plist Configuration

```xml
<!-- Background audio -->
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>fetch</string>
</array>

<!-- Cleartext for local dev servers -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

## Dependencies

Minimal - mostly native frameworks:

| Package | Purpose |
|---------|---------|
| google-cast-sdk | Chromecast support |

**Native frameworks (no packages needed):**
- AVFoundation - Audio playback
- MediaPlayer - Now Playing, remote controls
- SwiftUI - UI
- URLSession - Networking, downloads
- Security (Keychain) - Token storage

## Features NOT Included (for now)

- CarPlay - Can add later if requested
- Widgets - Can add later
- Siri Shortcuts - Can add later

## Implementation Order

1. Project setup + Auth flow (login, keychain)
2. API client + models (all 80+ endpoints)
3. Home screen (continue listening, recently added)
4. Library browsing (all, series, authors, genres)
5. Audiobook detail screen
6. Audio player (streaming, background, lock screen)
7. Progress sync
8. Search
9. Profile + settings
10. Collections
11. Favorites + ratings
12. Offline downloads
13. Chromecast
14. Admin features
15. AI recaps ("Catch Me Up")
