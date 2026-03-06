// Content script — runs on facebook.com pages.
// Assumes the user has already opened the first photo in the lightbox.
// Iterates through photos using Next, collecting full-res URLs.
//
// IMPORTANT: All detection uses DOM structure and natural image dimensions,
// NOT getBoundingClientRect or visual layout, so it works when Chrome is
// minimized or the tab is in the background.

(() => {
  let scanning = false;
  let stopRequested = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ alive: true });
      return true;
    }

    if (msg.action === "getPageInfo") {
      sendResponse({
        title: document.title || "Facebook Album",
        url: window.location.href
      });
      return true;
    }

    if (msg.action === "startScan") {
      if (scanning) {
        sendResponse({ started: false, reason: "Scan already running" });
        return true;
      }

      const currentImg = findLightboxImageUrl();
      if (!currentImg) {
        sendResponse({
          started: false,
          reason: "No photo viewer open. Please click on the first photo of the album first, then try again."
        });
        return true;
      }

      scanning = true;
      stopRequested = false;
      sendResponse({ started: true });
      runLightboxScan();
      return true;
    }

    if (msg.action === "stopScan") {
      stopRequested = true;
      sendResponse({ stopped: true });
      return true;
    }
  });

  async function runLightboxScan() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const collectedUrls = [];
    const seenUrls = new Set();

    try {
      let consecutiveDupes = 0;
      const maxPhotos = 2000;
      let lastUrl = null;

      for (let i = 0; i < maxPhotos; i++) {
        if (stopRequested) break;

        const fullResUrl = await waitForNewImage(lastUrl, 8000);

        if (fullResUrl) {
          if (seenUrls.has(fullResUrl)) {
            consecutiveDupes++;
            if (consecutiveDupes >= 3) break;
          } else {
            consecutiveDupes = 0;
            seenUrls.add(fullResUrl);
            collectedUrls.push(fullResUrl);
            lastUrl = fullResUrl;

            chrome.runtime.sendMessage({
              action: "scanProgress",
              count: collectedUrls.length
            }).catch(() => {});
          }
        } else {
          // Could not detect a new image — try one more advance in case it was slow
          goToNextPhoto();
          await wait(2000);
          const retryUrl = findLightboxImageUrl();
          if (retryUrl && retryUrl !== lastUrl && !seenUrls.has(retryUrl)) {
            seenUrls.add(retryUrl);
            collectedUrls.push(retryUrl);
            lastUrl = retryUrl;
            chrome.runtime.sendMessage({
              action: "scanProgress",
              count: collectedUrls.length
            }).catch(() => {});
            continue;
          }
          break; // truly stuck — end of album
        }

        goToNextPhoto();
        await wait(1000);
      }

      chrome.runtime.sendMessage({
        action: "scanResult",
        urls: collectedUrls,
        count: collectedUrls.length
      });

    } catch (err) {
      chrome.runtime.sendMessage({
        action: "scanResult",
        error: err.message || "Unknown scan error"
      });
    }

    scanning = false;
  }

  async function waitForNewImage(previousUrl, timeoutMs) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const url = findLightboxImageUrl();
      if (url && url !== previousUrl) return url;
      await wait(300);
    }
    return null;
  }

  /**
   * Find the full-res image URL in the photo viewer.
   * Uses DOM structure + naturalWidth/naturalHeight — works when minimized.
   */
  function findLightboxImageUrl() {
    // Strategy 1: Images inside known lightbox containers
    const containers = document.querySelectorAll(
      '[role="dialog"], [data-pagelet*="MediaViewer"], [data-pagelet*="Photo"]'
    );

    for (const container of containers) {
      const url = findBestImage(container);
      if (url) return url;
    }

    // Strategy 2: Fallback — largest fbcdn image in the entire document
    // (by natural pixel dimensions, not rendered size)
    let bestUrl = null;
    let bestArea = 0;

    for (const img of document.querySelectorAll("img")) {
      const src = img.src || img.currentSrc || "";
      if (!isFbCdn(src)) continue;

      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const area = w * h;

      if (area > bestArea && w > 300 && h > 200) {
        bestArea = area;
        bestUrl = src;
      }
    }

    return bestUrl;
  }

  /**
   * Find the best (largest by natural dimensions) fbcdn image in a container.
   */
  function findBestImage(container) {
    let bestUrl = null;
    let bestArea = 0;

    for (const img of container.querySelectorAll("img")) {
      const src = img.src || img.currentSrc || "";
      if (!isFbCdn(src)) continue;

      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const area = w * h;

      if (area > bestArea) {
        bestArea = area;
        bestUrl = src;
      }
    }

    return bestUrl;
  }

  function isFbCdn(url) {
    if (!url) return false;
    if (!url.includes("fbcdn.net") && !url.includes("fbcdn")) return false;
    if (url.includes("emoji") || url.includes("rsrc.php") || url.includes("/static/")) return false;
    return true;
  }

  /**
   * Advance to the next photo. Uses multiple strategies that all work
   * when the window is minimized (no dependence on visual layout).
   */
  function goToNextPhoto() {
    // Strategy 1: aria-label based — most reliable
    for (const label of ["Next photo", "Next", "next photo", "next",
                          "Foto berikutnya", "Photo suivante", "Nächstes Foto",
                          "Siguiente foto", "Foto successiva"]) {
      const btn = document.querySelector(`[aria-label="${label}"]`);
      if (btn) {
        btn.click();
        return true;
      }
    }

    // Strategy 2: Find the next-arrow link by checking for SVG path patterns
    // Facebook's next arrow contains an SVG with a right-pointing chevron
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      // Look for links/buttons containing SVG arrows
      const buttons = dialog.querySelectorAll('div[role="button"], a[role="button"], button');
      for (const btn of buttons) {
        const svg = btn.querySelector("svg");
        if (!svg) continue;
        // Check if the SVG path data contains a right-arrow pattern
        const paths = svg.querySelectorAll("path");
        for (const path of paths) {
          const d = path.getAttribute("d") || "";
          // Right-pointing chevron paths typically move right then back
          // This is a heuristic — FB's arrow SVG has specific path directions
          if (d && (d.includes("l8") || d.includes("L") && d.length < 100)) {
            // Disambiguate left vs right: check sibling order or data attrs
            // The next button typically comes after the prev button in DOM order
            const allArrowBtns = Array.from(dialog.querySelectorAll('div[role="button"], a[role="button"], button'))
              .filter(b => b.querySelector("svg"));
            if (allArrowBtns.length >= 2) {
              // Last arrow button is typically "next"
              allArrowBtns[allArrowBtns.length - 1].click();
              return true;
            }
          }
        }
      }
    }

    // Strategy 3: Keyboard right arrow — simulate on the focused element and body
    const targets = [
      document.activeElement,
      document.querySelector('[role="dialog"]'),
      document.body
    ];

    for (const target of targets) {
      if (!target) continue;
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight", code: "ArrowRight", keyCode: 39, which: 39,
        bubbles: true, cancelable: true
      }));
    }

    return true; // keyboard fallback — assume it worked
  }
})();
