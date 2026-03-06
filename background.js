// Background service worker — handles:
// 1. Relaying scan progress/results between content script and popup
// 2. Batch downloading collected photo URLs

let scanState = { scanning: false, urls: [], count: 0 };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Relay scan progress from content script to popup
  if (msg.action === "scanProgress") {
    scanState.scanning = true;
    scanState.count = msg.count;
    // Forward to popup (may be closed, that's fine)
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Relay scan results from content script to popup & store
  if (msg.action === "scanResult") {
    scanState.scanning = false;
    if (msg.urls) {
      scanState.urls = msg.urls;
      scanState.count = msg.urls.length;
    }
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Popup asks for current scan state (when reopened)
  if (msg.action === "getScanState") {
    sendResponse(scanState);
    return true;
  }

  // Download album
  if (msg.action === "downloadAlbum") {
    handleAlbumDownload(msg.urls, msg.folder);
    sendResponse({ started: true });
    return true;
  }
});

async function handleAlbumDownload(urls, folder) {
  const total = urls.length;
  let completed = 0;
  let failed = 0;

  // Download with concurrency limit to avoid overwhelming the browser
  const concurrency = 3;
  const queue = [...urls];
  let index = 0;

  async function downloadNext() {
    while (index < queue.length) {
      const i = index++;
      const thumbnailUrl = queue[i];
      const fullResUrl = upgradeToFullRes(thumbnailUrl);
      const ext = guessExtension(fullResUrl);
      const filename = `${folder}/photo_${String(i + 1).padStart(4, "0")}${ext}`;

      try {
        await downloadFile(fullResUrl, filename);
      } catch {
        // If full-res URL fails, fall back to original thumbnail URL
        try {
          await downloadFile(thumbnailUrl, filename);
        } catch {
          failed++;
        }
      }

      completed++;
      // Notify popup of progress
      broadcastProgress(completed, failed, total);
    }
  }

  // Launch concurrent downloaders
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, total); w++) {
    workers.push(downloadNext());
  }
  await Promise.all(workers);
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Monitor download completion
        function onChanged(delta) {
          if (delta.id !== downloadId) return;

          if (delta.state) {
            if (delta.state.current === "complete") {
              chrome.downloads.onChanged.removeListener(onChanged);
              resolve();
            } else if (delta.state.current === "interrupted") {
              chrome.downloads.onChanged.removeListener(onChanged);
              reject(new Error("Download interrupted"));
            }
          }
        }

        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}

function broadcastProgress(completed, failed, total) {
  chrome.runtime.sendMessage({
    action: "downloadProgress",
    completed,
    failed,
    total,
  }).catch(() => {
    // Popup may have closed; ignore
  });
}

function guessExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpe?g|png|gif|webp|bmp|heic)/i);
    if (match) return "." + match[1].toLowerCase();
  } catch {
    // ignore
  }
  return ".jpg"; // default for Facebook photos
}

/**
 * Upgrade a Facebook CDN thumbnail URL to the full-resolution version.
 *
 * Facebook CDN URLs embed size constraints as path segments:
 *   /s600x600/   — square crop at 600px
 *   /p960x960/   — proportional resize to 960px
 *   /c0.45.526.526a/  — crop rectangle
 *   /s720x720/   — album grid size
 *   /w800/       — width-only constraint
 *
 * Removing these segments returns the original full-resolution image
 * (the auth token in the query string remains valid).
 */
function upgradeToFullRes(url) {
  try {
    const parsed = new URL(url);

    // Remove size-constraint path segments
    // Pattern: /sWxH/ or /pWxH/ or /cX.X.X.Xa/ or /wN/ or /cp0 .../ etc.
    parsed.pathname = parsed.pathname
      .replace(/\/[sp]\d+x\d+\/?/g, "/")      // /s600x600/ or /p960x960/
      .replace(/\/c[\d.]+\.[\d.]+\.[\d.]+\.[\d.]+a?\/?/g, "/") // /c0.45.526.526a/
      .replace(/\/w\d+\/?/g, "/")              // /w800/
      .replace(/\/cp0\s[^/]*\/?/g, "/")        // /cp0 .../
      .replace(/\/\/+/g, "/");                 // collapse double slashes

    // Remove size-related query params (some CDN versions use these)
    parsed.searchParams.delete("_nc_aid");
    // Keep all auth params (oh, oe, _nc_cat, etc.)

    return parsed.toString();
  } catch {
    return url;
  }
}
