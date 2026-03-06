document.addEventListener("DOMContentLoaded", async () => {
  const notFacebook = document.getElementById("not-facebook");
  const albumPanel = document.getElementById("album-panel");
  const albumNameEl = document.getElementById("album-name");
  const photoCountEl = document.getElementById("photo-count");
  const folderInput = document.getElementById("folder-name");
  const scanBtn = document.getElementById("scan-btn");
  const downloadBtn = document.getElementById("download-btn");
  const progressSection = document.getElementById("progress-section");
  const progressFill = document.getElementById("progress-fill");
  const progressText = document.getElementById("progress-text");
  const statusEl = document.getElementById("status");

  let collectedUrls = [];

  function setStatus(msg, type = "info") {
    statusEl.textContent = msg;
    statusEl.className = "status " + type;
  }

  function showProgress(current, total, label) {
    progressSection.classList.remove("hidden");
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = pct + "%";
    progressText.textContent = label || `${current} / ${total}`;
  }

  // Check if current tab is Facebook
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("facebook.com")) {
    notFacebook.classList.remove("hidden");
    return;
  }

  albumPanel.classList.remove("hidden");

  // Extract page/album name from URL
  try {
    const url = new URL(tab.url);
    const parts = url.pathname.split("/").filter(Boolean);
    let name = "FB_Album";
    if (parts.length > 0 && parts[0] !== "media") {
      name = parts[0];
    }
    if (parts.includes("photos") || parts.includes("media")) {
      albumNameEl.textContent = `Page: ${decodeURIComponent(name)}`;
    } else {
      albumNameEl.textContent = "Navigate to a photos/album page";
    }
    folderInput.value = sanitizeFolderName(name + "_album");
  } catch {
    folderInput.value = "FB_Album";
  }

  // Check if there's an ongoing/completed scan stored in background
  chrome.runtime.sendMessage({ action: "getScanState" }, (state) => {
    if (state && state.urls && state.urls.length > 0) {
      collectedUrls = state.urls;
      photoCountEl.textContent = `${collectedUrls.length} photo(s) found`;
      downloadBtn.disabled = false;
      setStatus(`Previous scan: ${collectedUrls.length} photos ready.`, "success");
    }
    if (state && state.scanning) {
      scanBtn.textContent = "Scanning...";
      scanBtn.disabled = true;
      setStatus(`Scan in progress: ${state.count || 0} photos found so far...`, "info");
      progressSection.classList.remove("hidden");
      progressText.textContent = `${state.count || 0} photos scanned...`;
      progressFill.style.width = "0%"; // indeterminate
    }
  });

  // Listen for scan progress & result messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "scanProgress") {
      photoCountEl.textContent = `${msg.count} photo(s) found so far...`;
      progressSection.classList.remove("hidden");
      progressText.textContent = `${msg.count} photos scanned...`;
      setStatus(`Scanning album... ${msg.count} photos collected`, "info");
    }

    if (msg.action === "scanResult") {
      scanBtn.textContent = "Scan for Photos";
      scanBtn.disabled = false;

      if (msg.error) {
        setStatus("Scan error: " + msg.error, "error");
      } else if (msg.urls && msg.urls.length > 0) {
        collectedUrls = msg.urls;
        photoCountEl.textContent = `${collectedUrls.length} photo(s) found`;
        downloadBtn.disabled = false;
        setStatus(`Found ${collectedUrls.length} photos. Ready to download.`, "success");
        progressText.textContent = `${collectedUrls.length} photos ready`;
        progressFill.style.width = "100%";
      } else {
        setStatus("No photos found.", "error");
      }
    }

    if (msg.action === "downloadProgress") {
      const { completed, failed, total } = msg;
      showProgress(completed, total, `${completed} / ${total}${failed ? ` (${failed} failed)` : ""}`);
      if (completed === total) {
        const folder = folderInput.value || "FB_Album";
        setStatus(`Done! ${total - failed} photos saved to "${folder}/"`, "success");
        downloadBtn.disabled = false;
        scanBtn.disabled = false;
      }
    }
  });

  // Scan button — tell content script to start lightbox scan
  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning...";
    downloadBtn.disabled = true;
    collectedUrls = [];
    progressSection.classList.remove("hidden");
    progressText.textContent = "Starting from current photo...";
    progressFill.style.width = "0%";
    setStatus("Scanning: advancing through photos in the viewer...", "info");

    try {
      chrome.tabs.sendMessage(tab.id, { action: "startScan" }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus("Could not reach page. Try refreshing the Facebook tab.", "error");
          scanBtn.disabled = false;
          scanBtn.textContent = "Scan for Photos";
          return;
        }
        if (response && !response.started) {
          setStatus(response.reason || "Scan could not start", "error");
          scanBtn.disabled = false;
          scanBtn.textContent = "Scan for Photos";
        }
      });
    } catch (err) {
      setStatus("Scan failed: " + err.message, "error");
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan for Photos";
    }
  });

  // Download button
  downloadBtn.addEventListener("click", async () => {
    if (collectedUrls.length === 0) return;

    downloadBtn.disabled = true;
    scanBtn.disabled = true;
    const folder = sanitizeFolderName(folderInput.value || "FB_Album");
    const total = collectedUrls.length;

    showProgress(0, total, `0 / ${total}`);
    setStatus("Downloading...", "info");

    chrome.runtime.sendMessage({
      action: "downloadAlbum",
      urls: collectedUrls,
      folder: folder,
    });
  });
});

function sanitizeFolderName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, "_").substring(0, 100);
}
