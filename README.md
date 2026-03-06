# Facebook Album Downloader (Chrome Extension)

Download all photos from a Facebook album page in one batch.

This extension is designed around Facebook's photo viewer (lightbox) so it can capture full-resolution image URLs instead of only grid thumbnails.

## Features

- Scans album photos by stepping through the viewer from the currently open photo.
- Captures full-resolution Facebook CDN image URLs.
- Supports large albums (hundreds of photos).
- Continues scanning even if popup is closed (state kept in background service worker).
- Handles download progress with success/failure counts.
- Saves files into a custom folder under your Downloads directory.

## Current Workflow (Important)

Use this exact flow for best results:

1. Open the target Facebook album page.
2. Click the first photo in that album to open the photo viewer.
3. Click the extension icon.
4. Click `Scan for Photos`.
5. Wait until scan completes.
6. Click `Download All`.

Notes:

- The scanner starts from the currently open photo and advances with `Next`.
- Scan ends when the viewer loops to already-seen photos.
- Downloaded files are named like `photo_0001.jpg`, `photo_0002.jpg`, etc.

## Installation (Load Unpacked)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:
   - `D:\Coding\Misc\ExtPhot`
5. Pin the extension from the Chrome toolbar (optional but recommended).

## Permissions

Defined in `manifest.json`:

- `activeTab`: interact with the current Facebook tab.
- `downloads`: save photos to local Downloads.
- `scripting`: inject/execute scan logic on tab context.
- Host permissions:
  - `https://www.facebook.com/*`
  - `https://*.fbcdn.net/*`
  - `https://scontent*.fbcdn.net/*`
  - `https://scontent*.xx.fbcdn.net/*`

## Project Structure

- `manifest.json`: extension configuration (MV3).
- `popup.html`, `popup.css`, `popup.js`: popup UI and user actions.
- `content.js`: in-page scanner that iterates photo viewer and collects URLs.
- `background.js`: state relay + batch download manager.
- `icons/`: extension icons.

## How It Works

### Scan phase

- Triggered from popup (`startScan` message).
- Content script validates a photo viewer is open.
- It repeatedly:
  - detects current full-res image URL,
  - stores unique URLs,
  - triggers `Next`.
- Progress is sent to background (`scanProgress`) and relayed to popup.
- Final result (`scanResult`) stores URL list in background state.

### Download phase

- Popup sends URL list and folder name (`downloadAlbum`) to background.
- Background downloads files with limited concurrency.
- Progress events are emitted back to popup (`downloadProgress`).

## Known Limits and Behavior

- Facebook DOM can change at any time and may require selector updates.
- If Facebook blocks or rate-limits requests, some downloads may fail.
- Some photos may require account/session access context while downloading.
- If scan starts from the wrong photo, the collected sequence will follow that starting point.

## Troubleshooting

### "No photo viewer open"

- Open an album image first (full-screen/lightbox), then click `Scan for Photos`.

### Scan stalls or misses photos

- Keep the album tab open and logged in.
- Retry scan starting from the true first photo.
- Refresh Facebook page and extension popup, then retry.

### Download failures appear in progress

- Some links can expire or be access-restricted.
- Retry download after rescanning.

### Popup closes during scan

- This is okay. Reopen popup later; scan state is kept in background.

## Development Notes

- Extension format: Manifest V3.
- Background script: service worker (`background.js`).
- No build step required. Edit files directly and click `Reload` in `chrome://extensions/`.

## Disclaimer

Use responsibly and only for content you are authorized to access and download. Respect Facebook terms and applicable copyright/privacy laws.
