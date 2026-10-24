<p align="center">
  <img src="banner.png?v=4" alt="Waev Pro - desktop music player and audio suite for YouTube Music, SoundCloud, and local files" width="100%">
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/windows8/windows8-original.svg" width="22" height="22" alt="Windows">&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apple/apple-original.svg" width="22" height="22" alt="macOS">&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/linux/linux-original.svg" width="22" height="22" alt="Linux">
</p>

<h1 align="center">
  <img src="assets/Weav%20(2).svg" width="48" height="48" align="absmiddle" alt="Waev Pro logo">&nbsp;Waev Pro
</h1>

<p align="center">
  <b>A free desktop music player for YouTube Music, SoundCloud, and local files.</b><br>
  Built with Material Design 3, no tracking, and no account needed.
</p>

<p align="center">
  <a href="#features">Features</a> &nbsp;·&nbsp;
  <a href="#built-in-audio-suite">Audio Suite</a> &nbsp;·&nbsp;
  <a href="#material-design-3-expressive-ui">Interface</a> &nbsp;·&nbsp;
  <a href="#build-from-source">Build</a> &nbsp;·&nbsp;
  <a href="#faq">FAQ</a>
</p>

## What is Waev Pro?

Waev Pro is an open-source, telemetry-free desktop music app and player for **Windows, Linux, and macOS**. It unifies playback across **YouTube Music**, **YouTube**, **SoundCloud**, and offline local media into a single high-performance interface without ads, subscriptions, or login constraints. Provides very fancy UI and layout.

Built with **Electron**, **Vanilla JavaScript**, and **WebGL**, Waev Pro provides responsive UI interactions and hardware-accelerated audio visualization without runtime framework overhead. The project is distributed under the **MIT license** and enforces strict privacy: all configuration, cached streams, and playback history remain strictly on the local machine.

## Features

- High quality streaming with **YouTube Music, YouTube, and SoundCloud** without third-party advertisements or account requirements
- **Offline lossless playback with full local library support** for high resolution formats including FLAC, WAV, MP3, OGG, and M4A.
- **Easy built-in audio editor**, downloading with effects or trimming 10-band & 3-band equalizer, and real-time DSP effects (speed, pitch, reverb, distortion).
- **1-Click multi-platform playlist migration**: Direct import and resolution of public playlists from Spotify, Apple Music, YouTube Music, and SoundCloud
- **Material Design 3 UI**: Dynamic color extraction from album artwork, deep UI theming, responsive layout presets, and an integrated CSS editor
- **Hardware-Accelerated Visuals**: Canvas and WebGL visualizers including real-time frequency analyzers, an interactive squiggly progress scrubber, and synchronized karaoke lyrics.
- **Discord Rich Presence**: Real-time playback status reporting track metadata, artist info, and elapsed time to Discord.
- **Zero Telemetry**: No tracking identifiers, analytics pings, or background data collection.
- **Fullscreen mode** with fancy lyrics animation.
- **Albums** - see all of your favorite artist albums.
- **Customization** - built in theme editor, configure everything, and a CSS editor, with animated backgrounds and interface opacity sliders.
- **Plugins** - built-in plugin feature where you can add a plugin to edit how Waev Pro works with something or add a new function.
## Built-in Audio Suite

Waev Pro includes an integrated audio engineering toolkit accessible directly within the player interface:

### Visual Audio Editor
- **Lossless Audio Trimming**: Define start and end boundaries to trim tracks without transcoding loss.
- **Region Extraction**: Select and isolate specific audio segments to save as standalone files.
- **Non-Destructive Processing**: Edit operations produce independent files while preserving original source media untouched.

### 10-Band Parametric Equalizer
- Dedicated frequency sliders covering 32 Hz through 16 kHz with pre-configured acoustic profiles (Bass Boost, Vocal Clarity, Electronic, Flat, Rock).
- Per-channel gain adjustments with real-time Web Audio API signal processing.

### Real-Time DSP Effects Chain
- **Tempo Control**: Dynamically speed up or slow down playback rate without altering pitch.
- **Pitch Shifting**: Independent semitone pitch adjustment for rehearsal and tuning.
- **Reverb & Spatial Effects**: Algorithmic convolution and room size simulation for spatial enhancement.
- **Distortion / Overdrive**: Adjustable wave-shaping saturation and drive harmonics.

### Offline Library & Download Pipeline
- Download streams from YouTube Music, YouTube, and SoundCloud directly into local disk storage (MP3, FLAC, Opus, WAV).
- Automatic ID3 and metadata tagging, including high-resolution cover art embedding.
- Complete offline availability with full playlist compilation and search indexing.

## Material Design 3 Expressive UI

Waev Pro implements the Material Design 3 (M3 Expressive) specification:

- **Dynamic Color Extraction**: Generates responsive UI tonal palettes on the fly based on the dominant and secondary hues of active album art.
- **Deep UI Customization**: Configurable banner backdrops, mesh gradients, blur filters, and typography controls.
- **Integrated CSS Editor**: Built-in developer console allowing direct CSS overrides and custom style injection to personalize every aspect of the interface.
- **Optimized Layout Modes**: Compact mini-player layout, expanded desktop view, and fullscreen TV / Karaoke mode with synchronized lyrics rendering.

## Multi-Platform Playlist Migration

Migrate existing music libraries between platforms in a single operation:

- Import public playlist URLs from **Spotify** (including playlists with 100+ tracks via automated pagination).
- Import public playlists and albums from **Apple Music**, **SoundCloud**, and **YouTube / YouTube Music**.
- Platform-aware search resolution: matches imported track metadata against the selected audio provider to construct immediate local playlists.

## Synchronized Lyrics Engine

- Automatic multi-provider lyrics lookup matching artist and title metadata.
- Native support for synchronized LRC files, plain text lyrics, and dynamic online timestamp alignment.
- Inline time-offset adjustments to manually synchronize lyrics with live streams.
- Multi-language translation support directly inside the lyrics panel.

## Build from source

Requires Node.js 18 or newer and npm.

```bash
npm install
npm start        # run the dev version
npm run dist     # make a production build
```

The exact build output depends on the current project configuration.

### macOS notes

1. Because the binary is unsigned, right-click `Waev Pro.app` in `Applications`, select **Open**, and confirm the prompt.
2. If macOS flags the bundle as damaged, execute the following command in Terminal:
   ```bash
   xattr -cr "/Applications/Waev Pro.app"
   ```
3. Install the required runtime binaries via Homebrew (Waev Pro detects Homebrew paths automatically):
   ```bash
   brew install yt-dlp ffmpeg
   ```

macOS application data and local indexes are stored in `~/Library/Application Support/Waev Pro`.

## Memory usage

Waev Pro (single Electron renderer and server process) typically utilizes approximately **180 MB of RAM** during steady-state playback. Actual footprint varies based on active visualizer modes, library size, and OS window compositing.

### Memory usage is only classified as a leak when sustained footprint exceeds 600 MB.

## FAQ

**Is Waev Pro free?**
Yes. Waev Pro is free software published under the permissive MIT license. There are no subscriptions, paywalls, or premium tiers.

**Does Waev Pro display advertisements?**
No. Streams from YouTube Music, YouTube, and SoundCloud are resolved directly and play without advertisements.

**Is an account or sign-in required?**
No. Waev Pro requires no account creation, credentials, or authentication. Telemetry and analytic tracking are strictly omitted.

**Which operating systems are supported?**
Windows 10/11, modern Linux distributions, and macOS (experimental).

**Can Waev Pro function as an offline local music player?**
Yes. Waev Pro natively indexes local audio files (including lossless FLAC, WAV, MP3, and OGG), reads standard metadata tags and embedded artwork, and manages playlists without altering underlying disk files.

**Can I use Waev Pro entirely offline?**
Yes. Downloaded tracks, saved audio segments, and indexed local libraries function without an internet connection.

**How does playlist migration work?**
Paste any public Spotify, Apple Music, YouTube Music, or SoundCloud playlist link. Waev Pro extracts track titles and artists, batches requests to resolve streams on your active platform, and saves the result as an editable local playlist.

**Does Waev Pro support synchronized lyrics?**
Yes. Waev Pro supports online synchronized lyrics, local LRC files, manual timing adjustments, and real-time synchronized karaoke display.

**Does Waev Pro integrate with Discord?**
Yes. Native Discord Rich Presence displays the currently playing track title, artist, elapsed time, and platform indicator.

**Are there official mobile builds?**
No official mobile releases exist.

## Disclaimer

Waev Pro is developed for educational purposes and personal media management. Users are responsible for adhering to the terms of service of third-party platforms and applicable local copyright regulations.

## License

[MIT](LICENSE)

---

<sub>Keywords: free music player, YouTube Music desktop app, SoundCloud desktop player, ad-free music player, Material Design 3, M3 Expressive, visual audio editor, lossless audio trimmer, 10-band equalizer, DSP effects, tempo changer, pitch shift, FLAC player, WAV playback, Spotify playlist import, Apple Music playlist migration, Electron music player, Vanilla JS, WebGL audio visualizer, Discord Rich Presence, open source music player, MIT license, telemetry-free desktop player.</sub>
